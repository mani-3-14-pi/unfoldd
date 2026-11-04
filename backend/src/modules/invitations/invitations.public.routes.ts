import { Router } from 'express'
import { z } from 'zod'
import { logActivity } from '../../lib/activity.ts'
import { transition } from '../../lib/concurrency.ts'
import { notify } from '../../lib/notify.ts'
import { DUMMY_HASH, hashPassword, verifyPassword } from '../../lib/password.ts'
import { startChallenge, userNeedsMfa } from '../../lib/mfa.ts'
import { createSession, readSession } from '../../lib/session.ts'
import { presignDownload, storageConfigured } from '../../lib/storage.ts'
import { idempotent, tokenScope } from '../../middleware/idempotency.ts'
import { authLimiter } from '../../middleware/rateLimit.ts'
import { AppError } from '../../utils/AppError.ts'
import { AgencyModel } from '../agencies/agency.model.ts'
import { ClientModel } from '../clients/client.model.ts'
import { FileModel } from '../files/file.model.ts'
import { UserModel } from '../users/user.model.ts'
import { INVITATION_TRANSITIONS, InvitationModel } from './invitation.model.ts'
import { acceptInvitation, effectiveStatus, findByToken, inviteWatchers } from './invitation.service.ts'

/** The invite link (F01). Public: the token is the credential for reading it, the password for accepting it. */
export const invitationsPublicRouter = Router()

async function logoUrl(id: unknown) {
  if (!id || !storageConfigured()) return null
  const file = await FileModel.findOne({ _id: id, status: 'ready', deletedAt: null }).lean()
  return file ? (await presignDownload(file.key, file, { inline: true })).url : null
}

/** Writes `expired` down the first time someone opens an out-of-date link. */
async function settleExpiry(inv: Parameters<typeof effectiveStatus>[0] & { _id: unknown }) {
  if (effectiveStatus(inv) === 'expired' && inv.status === 'pending') {
    await InvitationModel.updateOne({ _id: inv._id, status: 'pending' }, { $set: { status: 'expired' } })
  }
}

invitationsPublicRouter.get('/:token', async (req, res) => {
  const inv = await findByToken(String(req.params.token))
  await settleExpiry(inv)
  const [agency, client, account, session] = await Promise.all([
    AgencyModel.findById(inv.agency, { name: 1, logo: 1 }).lean(),
    inv.client ? ClientModel.findById(inv.client, { name: 1, brandName: 1, logo: 1 }).lean() : null,
    UserModel.exists({ email: inv.email }),
    readSession(req, 'agency'),
  ])
  // Lets the screen say "You're signed in as x@y — switch account" (D49).
  const signedIn = session ? await UserModel.findById(session.subject, { email: 1 }).lean() : null

  res.json({
    status: effectiveStatus(inv),
    kind: inv.kind,
    email: inv.email,
    role: inv.role,
    message: inv.message,
    invitedBy: inv.invitedBy?.name ?? null,
    invitedAt: inv.createdAt,
    expiresAt: inv.expiresAt,
    reinviteRequested: !!inv.reinviteRequestedAt,
    agency: agency ? { name: agency.name, logoUrl: await logoUrl(agency.logo) } : null,
    client: client ? { name: client.name, brandName: client.brandName, logoUrl: await logoUrl(client.logo) } : null,
    accountExists: !!account,
    signedInAs: signedIn?.email ?? null,
  })
})

const acceptSchema = z.object({
  password: z.string().min(1, 'Enter your password').max(200),
  /** Only for a new account. */
  name: z.string().trim().min(2, 'Enter your full name').max(100).optional(),
})

invitationsPublicRouter.post('/:token/accept', authLimiter, idempotent(tokenScope('token')), async (req, res) => {
  const input = acceptSchema.parse(req.body)
  const inv = await findByToken(String(req.params.token))
  await settleExpiry(inv)
  const status = effectiveStatus(inv)
  if (status === 'expired') throw new AppError(410, 'invitation_expired', 'This invitation has expired.')
  if (status !== 'pending') throw new AppError(409, 'invalid_state', `This invitation was already ${status}.`, { status })

  // The token is bound to the invited email: we only ever sign in that account.
  let user = await UserModel.findOne({ email: inv.email }).select('+passwordHash')
  if (user) {
    const ok = await verifyPassword(input.password, user.passwordHash)
    if (!ok) throw new AppError(401, 'invalid_credentials', 'That password doesn’t match your account.')
  } else {
    await verifyPassword(input.password, DUMMY_HASH)
    if (!input.name) throw new AppError(400, 'invalid_input', 'Some fields are invalid.', { name: ['Enter your full name'] })
    if (input.password.length < 8) throw new AppError(400, 'invalid_input', 'Some fields are invalid.', { password: ['Use at least 8 characters'] })
    user = await UserModel.create({ name: input.name, email: inv.email, passwordHash: await hashPassword(input.password) })
  }

  await acceptInvitation(inv, user._id)
  const client = inv.kind === 'client' ? inv.client : null
  // Someone who owns an agency signs in only through 2FA, even from an invite.
  const challenge = (await userNeedsMfa(user._id)) ? await startChallenge('user', user, { agency: inv.agency, client }) : null
  if (!challenge) {
    await createSession(req, res, { kind: 'agency', subject: user._id, agency: inv.agency, client })
    user.lastLoginAt = new Date()
    await user.save()
  }

  const actor = { type: inv.kind === 'client' ? ('client_user' as const) : ('agency_user' as const), id: user._id, name: user.name }
  const event = await logActivity(req, {
    action: 'invitation.accepted',
    message: `${user.name} accepted the invitation and joined as ${inv.role}`,
    agency: inv.agency,
    client: inv.client ?? undefined,
    visibility: inv.kind === 'client' ? 'client' : 'internal',
    target: { type: 'user', id: user._id, label: user.name },
    actor,
  })
  const watchers = await inviteWatchers(inv)
  await notify({
    recipients: watchers.users,
    audience: watchers.audience,
    agency: inv.agency,
    client: inv.client ?? undefined,
    category: inv.kind === 'client' ? 'clients' : 'team',
    event: 'invitation.accepted',
    title: `${user.name} accepted your invitation`,
    entity: { type: 'user', id: user._id },
    link: inv.kind === 'client' ? `/app/clients/${inv.client}/members` : '/app/team',
    activity: event?._id,
  })
  res.json({ ok: true, context: inv.kind, clientId: inv.client ?? null, ...challenge })
})

invitationsPublicRouter.post('/:token/decline', authLimiter, async (req, res) => {
  const inv = await findByToken(String(req.params.token))
  await settleExpiry(inv)
  await transition(InvitationModel, { _id: inv._id }, INVITATION_TRANSITIONS.decline, { label: 'invitation', set: { respondedAt: new Date() } })
  const event = await logActivity(req, {
    action: 'invitation.declined',
    message: `${inv.email} declined the invitation`,
    agency: inv.agency,
    client: inv.client ?? undefined,
    visibility: inv.kind === 'client' ? 'client' : 'internal',
    target: { type: 'invitation', id: inv._id, label: inv.email },
  })
  const watchers = await inviteWatchers(inv)
  await notify({
    recipients: watchers.users,
    audience: watchers.audience,
    agency: inv.agency,
    client: inv.client ?? undefined,
    category: 'invites',
    event: 'invitation.declined',
    title: `${inv.email} declined your invitation`,
    entity: { type: 'invitation', id: inv._id },
    activity: event?._id,
  })
  res.status(204).end()
})

/** D74: an expired link asks the inviter to resend. Nothing is reissued automatically. */
invitationsPublicRouter.post('/:token/request-new', authLimiter, async (req, res) => {
  const inv = await findByToken(String(req.params.token))
  await settleExpiry(inv)
  if (effectiveStatus(inv) !== 'expired') throw new AppError(409, 'invalid_state', 'Only an expired invitation can ask for a new one.')
  // Once per day, so the inviter isn't spammed.
  const updated = await InvitationModel.findOneAndUpdate(
    {
      _id: inv._id,
      $or: [{ reinviteRequestedAt: null }, { reinviteRequestedAt: { $lt: new Date(Date.now() - 86_400_000) } }],
    },
    { $set: { reinviteRequestedAt: new Date() } },
  )
  if (updated) {
    const watchers = await inviteWatchers(inv)
    await notify({
      recipients: watchers.users,
      audience: watchers.audience,
      agency: inv.agency,
      client: inv.client ?? undefined,
      category: 'invites',
      event: 'invitation.reinvite_requested',
      title: `${inv.email} asked for a new invitation`,
      body: 'Their invitation expired. Resend it to give them a new link.',
      entity: { type: 'invitation', id: inv._id },
      link: inv.kind === 'client' ? `/app/clients/${inv.client}/members` : '/app/team',
      urgent: true,
    })
  }
  res.status(204).end()
})
