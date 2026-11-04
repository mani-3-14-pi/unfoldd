import { Router } from 'express'
import { z } from 'zod'
import { logActivity } from '../../lib/activity.ts'
import { sendEmail } from '../../lib/mailer.ts'
import { hashPassword, verifyPassword } from '../../lib/password.ts'
import { currentUser } from '../../lib/scope.ts'
import { timezoneSchema } from '../../lib/time.ts'
import { AppError, invalid, notFound } from '../../utils/AppError.ts'
import { objectId } from '../../lib/ids.ts'
import { SessionModel } from '../sessions/session.model.ts'
import { UserModel } from './user.model.ts'

/** The signed-in person's own account (F70, P156), for agency and client people alike. Mounted at /me. */
export const accountRouter = Router()

const sessionId = (req: Parameters<typeof currentUser>[0]) => (req.agencyAuth ?? req.clientAuth)!.sessionId

accountRouter.get('/profile', async (req, res) => {
  const user = await UserModel.findById(currentUser(req)._id, { name: 1, email: 1, timezone: 1, lastLoginAt: 1, 'twoFactor.enabledAt': 1, createdAt: 1 }).lean()
  res.json({ profile: { ...user, twoFactorEnabled: !!user?.twoFactor?.enabledAt } })
})

const profileSchema = z.object({ name: z.string().trim().min(2).max(100).optional(), timezone: z.union([timezoneSchema, z.literal('')]).optional() })

/** Name and timezone. Email changes aren't self-service: they'd need re-authentication and verification. */
accountRouter.patch('/profile', async (req, res) => {
  const input = profileSchema.parse(req.body)
  const user = await UserModel.findByIdAndUpdate(currentUser(req)._id, { $set: input }, { returnDocument: 'after', projection: { name: 1, email: 1, timezone: 1 } }).lean()
  res.json({ profile: user })
})

const passwordSchema = z.object({ currentPassword: z.string().min(1, 'Enter your current password'), newPassword: z.string().min(8, 'Use at least 8 characters').max(200) })

/** Changing the password signs out every other browser, and emails a security notice. */
accountRouter.post('/password', async (req, res) => {
  const { currentPassword, newPassword } = passwordSchema.parse(req.body)
  const user = await UserModel.findById(currentUser(req)._id).select('+passwordHash')
  if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) throw invalid('currentPassword', 'That’s not your current password')
  if (currentPassword === newPassword) throw invalid('newPassword', 'Pick a different password')
  user.passwordHash = await hashPassword(newPassword)
  await user.save()
  await SessionModel.deleteMany({ kind: 'agency', subject: user._id, _id: { $ne: sessionId(req) } })
  await logActivity(req, { action: 'user.password_changed', message: `${user.name} changed their password`, agency: req.agencyAuth?.agency._id ?? req.clientAuth?.agency._id })
  await sendEmail({ to: user.email, subject: 'Your Unfoldd password was changed', text: 'Your password was just changed and your other devices were signed out. If this wasn’t you, reset your password and contact your agency.', kind: 'security' })
  res.status(204).end()
})

/** Where this login is signed in (P156). */
accountRouter.get('/sessions', async (req, res) => {
  const me = currentUser(req)._id
  const rows = await SessionModel.find({ kind: 'agency', subject: me, expiresAt: { $gt: new Date() }, impersonator: null }, { ip: 1, userAgent: 1, createdAt: 1, expiresAt: 1, agency: 1, client: 1 }).sort({ createdAt: -1 }).lean()
  res.json({ items: rows.map((s) => ({ ...s, current: String(s._id) === String(sessionId(req)) })) })
})

accountRouter.delete('/sessions/:id', async (req, res) => {
  const id = objectId(req.params.id, 'Session not found.')
  if (String(id) === String(sessionId(req))) throw new AppError(400, 'invalid_input', 'Use log out to end this session.')
  const done = await SessionModel.deleteOne({ _id: id, kind: 'agency', subject: currentUser(req)._id })
  if (!done.deletedCount) throw notFound('Session not found.')
  res.status(204).end()
})

accountRouter.post('/sessions/revoke-others', async (req, res) => {
  const { deletedCount } = await SessionModel.deleteMany({ kind: 'agency', subject: currentUser(req)._id, _id: { $ne: sessionId(req) }, impersonator: null })
  res.json({ revoked: deletedCount })
})
