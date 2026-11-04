import { Router } from 'express'
import { z } from 'zod'
import { logActivity } from '../../lib/activity.ts'
import { DUMMY_HASH, hashPassword, verifyPassword } from '../../lib/password.ts'
import { sha256 } from '../../lib/crypto.ts'
import { beginSetup, completeChallenge, mfaRequired, regenerateBackupCodes, startChallenge } from '../../lib/mfa.ts'
import { createSession, destroySession } from '../../lib/session.ts'
import { requirePlatformAdmin } from '../../middleware/auth.ts'
import { authLimiter } from '../../middleware/rateLimit.ts'
import { AppError } from '../../utils/AppError.ts'
import { PlatformAdminModel } from '../platform-admins/platformAdmin.model.ts'
import { MfaChallengeModel } from '../sessions/mfaChallenge.model.ts'
import { SessionModel } from '../sessions/session.model.ts'

export const adminAuthRouter = Router()

const loginSchema = z.object({
  username: z.string().trim().toLowerCase().min(1, 'Enter your username').max(64),
  password: z.string().min(1, 'Enter your password').max(200),
})

adminAuthRouter.post('/login', authLimiter, async (req, res) => {
  const { username, password } = loginSchema.parse(req.body)
  const admin = await PlatformAdminModel.findOne({ username }).select('+passwordHash')
  const ok = await verifyPassword(password, admin?.passwordHash ?? DUMMY_HASH)

  if (!admin || !ok || admin.status !== 'active') {
    await logActivity(req, {
      action: 'platform.login_failed',
      message: `Failed platform admin login for “${username}”`,
      meta: { username },
    })
    throw new AppError(401, 'invalid_credentials', 'That username and password don’t match.')
  }

  // With 2FA on, the password only opens a challenge.
  if (mfaRequired()) {
    res.json(await startChallenge('platform_admin', admin))
    return
  }
  await createSession(req, res, { kind: 'platform', subject: admin._id })
  admin.lastLoginAt = new Date()
  await admin.save()
  await logActivity(req, {
    action: 'platform.login',
    message: `${admin.name} logged in to the platform admin`,
    actor: { type: 'platform_admin', id: admin._id, name: admin.name },
  })
  res.json({ admin: { id: admin._id, username: admin.username, name: admin.name } })
})

const challengeSchema = z.object({ challenge: z.string().min(10) })
const verifySchema = challengeSchema.extend({ code: z.string().trim().max(10).optional(), backupCode: z.string().trim().max(20).optional() })

/** First sign-in: the secret to add to an authenticator app. */
adminAuthRouter.post('/2fa/setup', authLimiter, async (req, res) => {
  const { challenge } = challengeSchema.parse(req.body)
  const ch = await MfaChallengeModel.findOne({ tokenHash: sha256(challenge) }, { subject: 1 }).lean()
  const admin = ch && (await PlatformAdminModel.findById(ch.subject, { username: 1 }).lean())
  res.json(await beginSetup('platform_admin', challenge, admin?.username ?? 'admin'))
})

adminAuthRouter.post('/2fa/verify', authLimiter, async (req, res) => {
  const input = verifySchema.parse(req.body)
  const { subject: admin, backupCodes, setup } = await completeChallenge('platform_admin', PlatformAdminModel, input.challenge, input)
  if (admin.status !== 'active') throw new AppError(401, 'invalid_credentials', 'That username and password don’t match.')
  await createSession(req, res, { kind: 'platform', subject: admin._id, mfaAt: new Date() })
  admin.lastLoginAt = new Date()
  await admin.save()
  await logActivity(req, {
    action: setup ? 'platform.2fa_enabled' : 'platform.login',
    message: setup ? `${admin.name} set up two-factor sign-in and logged in` : `${admin.name} logged in to the platform admin`,
    actor: { type: 'platform_admin', id: admin._id, name: admin.name },
    meta: input.backupCode ? { usedBackupCode: true } : undefined,
  })
  res.json({ admin: { id: admin._id, username: admin.username, name: admin.name }, backupCodes })
})

adminAuthRouter.post('/2fa/backup-codes', requirePlatformAdmin, async (req, res) => {
  const { code } = z.object({ code: z.string().trim() }).parse(req.body)
  res.json({ backupCodes: await regenerateBackupCodes(PlatformAdminModel, req.admin!._id, code) })
})

adminAuthRouter.post('/logout', async (req, res) => {
  await destroySession(req, res, 'platform')
  res.status(204).end()
})

adminAuthRouter.get('/me', requirePlatformAdmin, (req, res) => {
  const { _id, username, name } = req.admin!
  res.json({ admin: { id: _id, username, name } })
})

const passwordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password'),
  newPassword: z.string().min(10, 'Use at least 10 characters').max(200),
})

adminAuthRouter.post('/password', requirePlatformAdmin, async (req, res) => {
  const { currentPassword, newPassword } = passwordSchema.parse(req.body)
  const admin = await PlatformAdminModel.findById(req.admin!._id).select('+passwordHash')
  if (!admin || !(await verifyPassword(currentPassword, admin.passwordHash))) {
    throw new AppError(400, 'invalid_input', 'Some fields are invalid.', { currentPassword: ['That’s not your current password'] })
  }
  admin.passwordHash = await hashPassword(newPassword)
  await admin.save()
  // Sign out this admin's other browsers.
  await SessionModel.deleteMany({ kind: 'platform', subject: admin._id, _id: { $ne: req.admin!.sessionId } })
  await logActivity(req, { action: 'platform.password_changed', message: `${admin.name} changed their password` })
  res.status(204).end()
})
