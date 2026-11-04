import { Router } from 'express'
import { z } from 'zod'
import { logActivity } from '../../lib/activity.ts'
import { sha256 } from '../../lib/crypto.ts'
import { beginSetup, completeChallenge, regenerateBackupCodes } from '../../lib/mfa.ts'
import { createSession } from '../../lib/session.ts'
import { requireAgencyUser } from '../../middleware/auth.ts'
import { authLimiter } from '../../middleware/rateLimit.ts'
import { MfaChallengeModel } from '../sessions/mfaChallenge.model.ts'
import { UserModel } from '../users/user.model.ts'

/** Agency owners' 2FA steps, mounted at /auth/2fa. Login, signup and invite-accept hand out the challenge. */
export const mfaRouter = Router()

const challengeSchema = z.object({ challenge: z.string().min(10) })
const verifySchema = challengeSchema.extend({ code: z.string().trim().max(10).optional(), backupCode: z.string().trim().max(20).optional() })

mfaRouter.post('/setup', authLimiter, async (req, res) => {
  const { challenge } = challengeSchema.parse(req.body)
  const ch = await MfaChallengeModel.findOne({ tokenHash: sha256(challenge) }, { subject: 1 }).lean()
  const user = ch && (await UserModel.findById(ch.subject, { email: 1 }).lean())
  res.json(await beginSetup('user', challenge, user?.email ?? 'account'))
})

/** The code (or a backup code) checks out: the session opens where the login was going. */
mfaRouter.post('/verify', authLimiter, async (req, res) => {
  const input = verifySchema.parse(req.body)
  const { subject: user, target, backupCodes, setup } = await completeChallenge('user', UserModel, input.challenge, input)
  await createSession(req, res, { kind: 'agency', subject: user._id, agency: target?.agency ?? undefined, client: target?.client ?? null, mfaAt: new Date() })
  user.lastLoginAt = new Date()
  await user.save()
  await logActivity(req, {
    action: setup ? 'user.2fa_enabled' : 'user.login',
    message: setup ? `${user.name} set up two-factor sign-in and logged in` : `${user.name} logged in`,
    agency: target?.agency ?? undefined,
    actor: { type: 'agency_user', id: user._id, name: user.name },
    meta: input.backupCode ? { usedBackupCode: true } : undefined,
  })
  res.json({ ok: true, context: target?.client ? 'client' : 'agency', backupCodes })
})

mfaRouter.post('/backup-codes', requireAgencyUser, async (req, res) => {
  const { code } = z.object({ code: z.string().trim() }).parse(req.body)
  res.json({ backupCodes: await regenerateBackupCodes(UserModel, req.agencyAuth!.user._id, code) })
})
