import { Router } from 'express'
import { z } from 'zod'
import { logActivity } from '../../lib/activity.ts'
import { startChallenge, userNeedsMfa } from '../../lib/mfa.ts'
import { DUMMY_HASH, hashPassword, verifyPassword } from '../../lib/password.ts'
import { createSession, destroySession, readSession } from '../../lib/session.ts'
import { requireUser } from '../../middleware/auth.ts'
import { authLimiter } from '../../middleware/rateLimit.ts'
import { AppError, notFound } from '../../utils/AppError.ts'
import { TEAM_SIZES } from '../agencies/agency.constants.ts'
import { AgencyModel } from '../agencies/agency.model.ts'
import { transitionAgency, uniqueSlug } from '../agencies/agency.service.ts'
import { PlatformAdminModel } from '../platform-admins/platformAdmin.model.ts'
import { getSettings } from '../settings/settings.model.ts'
import { MembershipModel } from '../users/membership.model.ts'
import { UserModel } from '../users/user.model.ts'
import { listContexts, type ClientContext } from './contexts.ts'
import { mfaRouter } from './mfa.routes.ts'

/** Sign-in for agency people (the tenants' own portal). */
export const agencyAuthRouter = Router()
agencyAuthRouter.use('/2fa', mfaRouter)

const blocked: Record<string, { code: string; message: string }> = {
  pending: {
    code: 'agency_pending',
    message: 'Your agency is waiting for approval. You’ll be able to log in as soon as it’s approved.',
  },
  rejected: { code: 'agency_rejected', message: 'Your agency’s signup wasn’t approved.' },
  suspended: { code: 'agency_suspended', message: 'Your agency’s account is suspended. Contact Unfoldd support.' },
}

agencyAuthRouter.get('/signup-config', async (_req, res) => {
  const settings = await getSettings()
  res.json({ enabled: settings.signups.enabled })
})

const signupSchema = z.object({
  name: z.string().trim().min(2, 'Enter your full name').max(100),
  email: z.email('Enter a valid email').trim().toLowerCase(),
  password: z.string().min(8, 'Use at least 8 characters').max(200),
  agencyName: z.string().trim().min(2, 'Enter your agency name').max(100),
  phone: z.string().trim().max(30).optional().default(''),
  website: z.string().trim().max(200).optional().default(''),
  country: z.string().trim().max(60).optional().default(''),
  teamSize: z.enum([...TEAM_SIZES, '']).optional().default(''),
})

agencyAuthRouter.post('/signup', authLimiter, async (req, res) => {
  const input = signupSchema.parse(req.body)
  const settings = await getSettings()
  if (!settings.signups.enabled) throw new AppError(403, 'signups_closed', 'New agency signups are closed right now.')
  if (await UserModel.exists({ email: input.email })) {
    throw new AppError(409, 'email_taken', 'Some fields are invalid.', { email: ['An account with this email already exists'] })
  }

  const user = await UserModel.create({ name: input.name, email: input.email, passwordHash: await hashPassword(input.password) })
  const agency = await AgencyModel.create({
    name: input.agencyName,
    slug: await uniqueSlug(input.agencyName),
    email: input.email,
    phone: input.phone,
    website: input.website,
    country: input.country,
    teamSize: input.teamSize,
    owner: user._id,
  }).catch(async (err: unknown) => {
    await UserModel.deleteOne({ _id: user._id })
    throw err
  })
  await MembershipModel.create({ agency: agency._id, user: user._id, role: 'owner' })

  const actor = { type: 'agency_user' as const, id: user._id, name: user.name }
  const target = { type: 'agency', id: agency._id, label: agency.name }
  await logActivity(req, { action: 'agency.signup', message: `${agency.name} signed up`, agency: agency._id, target, actor })

  if (settings.signups.autoApprove) {
    await transitionAgency(agency._id, 'approve')
    await logActivity(req, {
      action: 'agency.approved',
      message: `${agency.name} was approved automatically`,
      agency: agency._id,
      target,
      actor: { type: 'system', name: 'Auto-approve' },
    })
    // The new owner sets up 2FA before the first session (when 2FA is switched on).
    if (await userNeedsMfa(user._id)) {
      res.status(201).json({ status: 'active', ...(await startChallenge('user', user, { agency: agency._id })) })
      return
    }
    await createSession(req, res, { kind: 'agency', subject: user._id, agency: agency._id, client: null })
    user.lastLoginAt = new Date()
    await user.save()
    res.status(201).json({ status: 'active', ok: true, context: 'agency' })
    return
  }
  res.status(201).json({ status: 'pending' })
})

const loginSchema = z.object({
  email: z.email('Enter a valid email').trim().toLowerCase(),
  password: z.string().min(1, 'Enter your password').max(200),
})

agencyAuthRouter.post('/login', authLimiter, async (req, res) => {
  const { email, password } = loginSchema.parse(req.body)
  const user = await UserModel.findOne({ email }).select('+passwordHash')
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH)
  if (!user || !ok) throw new AppError(401, 'invalid_credentials', 'That email and password don’t match.')

  // Open the first agency, else the first client space. The switcher moves between them.
  const contexts = await listContexts(user._id)
  const target = contexts.agencies[0] ?? contexts.clients[0]
  const actor = { type: 'agency_user' as const, id: user._id, name: user.name }
  if (!target) {
    // Say why, if the person's agency exists but can't be used right now.
    const membership = await MembershipModel.findOne({ user: user._id, status: 'active' }).sort({ createdAt: 1 }).lean()
    const agency = membership && (await AgencyModel.findById(membership.agency).lean())
    if (!agency || agency.status === 'active') throw new AppError(403, 'no_access', 'Your account isn’t part of an agency or client space.')
    await logActivity(req, {
      action: 'user.login_blocked',
      message: `${user.name} couldn’t log in: ${agency.name} is ${agency.status}`,
      agency: agency._id,
      actor,
    })
    const { code, message } = blocked[agency.status]
    throw new AppError(403, code, message, agency.statusReason ? { reason: agency.statusReason } : undefined)
  }

  const client = 'clientId' in target ? (target as ClientContext).clientId : null
  if (await userNeedsMfa(user._id)) {
    res.json(await startChallenge('user', user, { agency: target.agencyId, client }))
    return
  }
  await createSession(req, res, { kind: 'agency', subject: user._id, agency: target.agencyId, client })
  user.lastLoginAt = new Date()
  await user.save()
  await logActivity(req, {
    action: 'user.login',
    message: `${user.name} logged in`,
    agency: target.agencyId,
    client: client ?? undefined,
    actor: client ? { ...actor, type: 'client_user' } : actor,
  })
  res.json({ ok: true, context: client ? 'client' : 'agency', clientId: client })
})

agencyAuthRouter.post('/logout', async (req, res) => {
  const session = await readSession(req, 'agency')
  if (session?.impersonator) {
    const admin = await PlatformAdminModel.findById(session.impersonator).lean()
    const agency = await AgencyModel.findById(session.agency).lean()
    await logActivity(req, {
      action: 'agency.impersonation_ended',
      message: `${admin?.name ?? 'A platform admin'} left the support view of ${agency?.name ?? 'an agency'}`,
      agency: session.agency ?? undefined,
      target: agency ? { type: 'agency', id: agency._id, label: agency.name } : undefined,
      actor: { type: 'platform_admin', id: session.impersonator, name: admin?.name },
    })
  }
  await destroySession(req, res, 'agency')
  res.status(204).end()
})

agencyAuthRouter.get('/me', requireUser, async (req, res) => {
  const contexts = await listContexts((req.agencyAuth ?? req.clientAuth)!.user._id)
  if (req.clientAuth) {
    const { user, agency, client, role } = req.clientAuth
    res.json({
      context: 'client',
      user: { id: user._id, name: user.name, email: user.email },
      agency: { id: agency._id, name: agency.name },
      client: { id: client._id, name: client.name, brandName: client.brandName, status: client.status, timezone: client.timezone },
      role,
      contexts,
    })
    return
  }
  const { user, agency, role, canPublish, impersonator, expiresAt } = req.agencyAuth!
  res.json({
    context: 'agency',
    user: { id: user._id, name: user.name, email: user.email },
    agency: { id: agency._id, name: agency.name, slug: agency.slug, status: agency.status, timezone: agency.timezone },
    role,
    canPublish,
    support: impersonator ? { by: impersonator.name, expiresAt } : null,
    // A support session stays in the agency it was opened for.
    contexts: impersonator ? { agencies: [], clients: [] } : contexts,
  })
})

/** Every agency and client space this login can open: the agency switcher and the brand switcher (D43). */
agencyAuthRouter.get('/contexts', requireUser, async (req, res) => {
  res.json(await listContexts((req.agencyAuth ?? req.clientAuth)!.user._id))
})

const switchSchema = z.union([z.object({ agencyId: z.string() }), z.object({ clientId: z.string() })])

/** Moves the session to another agency or client space. A new session replaces the old one. */
agencyAuthRouter.post('/switch', requireUser, async (req, res) => {
  if (req.agencyAuth?.impersonator) throw new AppError(403, 'forbidden', 'A support session can’t switch agency.')
  const input = switchSchema.parse(req.body)
  const user = (req.agencyAuth ?? req.clientAuth)!.user
  const contexts = await listContexts(user._id)
  const target =
    'agencyId' in input
      ? contexts.agencies.find((a) => String(a.agencyId) === input.agencyId)
      : contexts.clients.find((c) => String(c.clientId) === input.clientId)
  if (!target) throw notFound('You don’t have access to that.')

  const client = 'clientId' in target ? (target as ClientContext).clientId : null
  // The new session keeps this sign-in's 2FA.
  const current = await readSession(req, 'agency')
  await destroySession(req, res, 'agency')
  await createSession(req, res, { kind: 'agency', subject: user._id, agency: target.agencyId, client, mfaAt: current?.mfaAt ?? null })
  res.json({ ok: true, context: client ? 'client' : 'agency', clientId: client })
})
