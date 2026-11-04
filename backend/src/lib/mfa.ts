import { randomBytes } from 'node:crypto'
import type { Model, Types } from 'mongoose'
import { env } from '../config/env.ts'
import { MfaChallengeModel } from '../modules/sessions/mfaChallenge.model.ts'
import { MembershipModel } from '../modules/users/membership.model.ts'
import { AppError } from '../utils/AppError.ts'
import { decrypt, encrypt, randomToken, sha256 } from './crypto.ts'
import { newTotpSecret, otpauthUrl, verifyTotp } from './totp.ts'

/*
 * Mandatory 2FA for platform admins and agency owners (nobody else). After the password, the login answers
 * `{ mfa: 'verify' | 'setup', challenge }` instead of a session; the session is created only once a code
 * from the authenticator app (or a backup code) checks out. Sessions created this way carry `mfaAt`.
 */

const CHALLENGE_TTL_MS = 10 * 60_000
const MAX_ATTEMPTS = 5
const BACKUP_CODES = 10

type Kind = 'platform_admin' | 'user'

/** Whether 2FA is switched on at all (`MFA_REQUIRED`). When off, nobody is asked for a code. */
export const mfaRequired = () => env.MFA_REQUIRED

/** Agency owners must use 2FA. Owning any active agency counts, whichever context they sign in to. */
export const userNeedsMfa = async (user: Types.ObjectId) =>
  mfaRequired() && !!(await MembershipModel.exists({ user, role: 'owner', status: 'active' }))

export async function startChallenge(kind: Kind, subject: { _id: Types.ObjectId; twoFactor?: { enabledAt?: Date | null } | null }, target: { agency?: Types.ObjectId; client?: Types.ObjectId | null } = {}) {
  const token = randomToken()
  const purpose = subject.twoFactor?.enabledAt ? 'verify' : 'setup'
  await MfaChallengeModel.create({
    tokenHash: sha256(token),
    subjectKind: kind,
    subject: subject._id,
    purpose,
    target: { agency: target.agency, client: target.client ?? undefined },
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
  })
  return { mfa: purpose, challenge: token }
}

const challengeGone = () => new AppError(401, 'mfa_challenge_expired', 'Your sign-in timed out. Enter your password again.')

async function loadChallenge(kind: Kind, token: string) {
  const ch = await MfaChallengeModel.findOne({ tokenHash: sha256(token), subjectKind: kind })
  if (!ch || ch.expiresAt.getTime() <= Date.now() || ch.attempts >= MAX_ATTEMPTS) throw challengeGone()
  return ch
}

/** First-time setup: makes the secret the authenticator app should store. */
export async function beginSetup(kind: Kind, token: string, account: string) {
  const ch = await loadChallenge(kind, token)
  if (ch.purpose !== 'setup') throw new AppError(409, 'mfa_already_enabled', 'Two-factor sign-in is already set up. Enter a code instead.')
  const secret = newTotpSecret()
  ch.pendingSecret = encrypt(secret)
  await ch.save()
  return { secret, otpauthUrl: otpauthUrl(secret, account) }
}

const newBackupCodes = () => Array.from({ length: BACKUP_CODES }, () => randomBytes(5).toString('hex').match(/.{5}/g)!.join('-'))

/**
 * Checks the code for a challenge. For setup it confirms and stores the new secret and returns one-time backup
 * codes. Returns the challenge's target so the caller can create the session.
 */
export async function completeChallenge(kind: Kind, model: Model<any, any, any, any, any, any>, token: string, input: { code?: string; backupCode?: string }) {
  const ch = await loadChallenge(kind, token)
  const subject = await model.findById(ch.subject).select('+twoFactor.secret +twoFactor.backupCodes')
  if (!subject) throw challengeGone()
  const wrong = async () => {
    await MfaChallengeModel.updateOne({ _id: ch._id }, { $inc: { attempts: 1 } })
    return new AppError(401, 'invalid_code', 'That code isn’t right. Try the latest one from your app.')
  }

  let backupCodes: string[] | undefined
  if (ch.purpose === 'setup') {
    if (!ch.pendingSecret || !input.code) throw new AppError(400, 'invalid_input', 'Scan the code with your authenticator app, then enter the 6-digit code.')
    const secret = decrypt(ch.pendingSecret)
    const step = verifyTotp(secret, input.code)
    if (step == null) throw await wrong()
    backupCodes = newBackupCodes()
    subject.set('twoFactor', { secret: encrypt(secret), enabledAt: new Date(), backupCodes: backupCodes.map((c) => sha256(c)), lastStep: step })
    await subject.save()
  } else if (input.backupCode) {
    const hash = sha256(input.backupCode.trim().toLowerCase())
    const used = await model.updateOne({ _id: subject._id, 'twoFactor.backupCodes': hash }, { $pull: { 'twoFactor.backupCodes': hash } })
    if (!used.modifiedCount) throw await wrong()
  } else {
    const secret = decrypt(subject.twoFactor.secret)
    const step = verifyTotp(secret, input.code ?? '', { notAfterStep: subject.twoFactor.lastStep })
    if (step == null) throw await wrong()
    // Conditional, so two parallel requests with the same code can't both pass.
    const claimed = await model.updateOne(
      { _id: subject._id, $or: [{ 'twoFactor.lastStep': null }, { 'twoFactor.lastStep': { $lt: step } }] },
      { $set: { 'twoFactor.lastStep': step } },
    )
    if (!claimed.modifiedCount) throw await wrong()
  }
  await MfaChallengeModel.deleteOne({ _id: ch._id })
  return { subject, target: ch.target, backupCodes, setup: ch.purpose === 'setup' }
}

/** New backup codes for someone already signed in with 2FA, after a fresh code. */
export async function regenerateBackupCodes(model: Model<any, any, any, any, any, any>, id: Types.ObjectId, code: string) {
  const subject = await model.findById(id).select('+twoFactor.secret')
  if (!subject?.twoFactor?.enabledAt) throw new AppError(409, 'mfa_not_enabled', 'Two-factor sign-in isn’t set up.')
  const step = verifyTotp(decrypt(subject.twoFactor.secret), code, { notAfterStep: subject.twoFactor.lastStep })
  if (step == null) throw new AppError(401, 'invalid_code', 'That code isn’t right.')
  const codes = newBackupCodes()
  await model.updateOne({ _id: id }, { $set: { 'twoFactor.backupCodes': codes.map((c) => sha256(c)), 'twoFactor.lastStep': step } })
  return codes
}

