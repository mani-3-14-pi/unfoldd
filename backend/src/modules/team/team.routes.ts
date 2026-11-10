import { Router, type Request } from 'express'
import mongoose, { type PipelineStage, type Types } from 'mongoose'
import { z } from 'zod'
import { diff, logActivity } from '../../lib/activity.ts'
import { objectId } from '../../lib/ids.ts'
import { notify } from '../../lib/notify.ts'
import { csvEnum, escapeRegex, pageQuery, paginateAggregate } from '../../lib/pagination.ts'
import { loadClient } from '../../lib/scope.ts'
import { revokeMemberSessions } from '../../lib/session.ts'
import { requireRole } from '../../middleware/auth.ts'
import { idempotent } from '../../middleware/idempotency.ts'
import { AppError, forbidden, notFound } from '../../utils/AppError.ts'
import { AgencyModel } from '../agencies/agency.model.ts'
import { AgencyAccessModel } from '../clients/agencyAccess.model.ts'
import { ClientModel } from '../clients/client.model.ts'
import { INVITATION_STATUSES, InvitationModel } from '../invitations/invitation.model.ts'
import { createInvitation, presentInvitation, resendInvitation, revokeInvitation } from '../invitations/invitation.service.ts'
import { DEFAULT_CAPACITY, MEMBER_ROLES, MEMBER_STATUSES, MembershipModel } from '../users/membership.model.ts'
import { UserModel } from '../users/user.model.ts'

/** Team members (P130–P135) and agency invitations. Everyone can see the team; Owner/Admin manage it. */
export const teamRouter = Router()

/** Roles that can be given by invite or role change. Ownership moves only by transfer. */
const ASSIGNABLE_ROLES = ['admin', 'manager', 'member'] as const

/**
 * Only the Owner can change, disable or remove an Admin. Nobody changes the Owner (transfer ownership instead)
 * or their own membership.
 */
async function managedMember(req: Request, userParam: unknown) {
  const auth = req.agencyAuth!
  const user = objectId(userParam, 'Team member not found.')
  const member = await MembershipModel.findOne({ agency: auth.agency._id, user })
  if (!member) throw notFound('Team member not found.')
  if (String(user) === String(auth.user._id)) throw forbidden('You can’t change your own membership here.')
  if (member.role === 'owner') throw forbidden('The owner can’t be changed. Transfer ownership first.')
  if (member.role === 'admin' && auth.role !== 'owner') throw forbidden('Only the owner can change an admin.')
  return member
}

const memberLookup: PipelineStage[] = [
  { $lookup: { from: 'users', localField: 'user', foreignField: '_id', as: 'user', pipeline: [{ $project: { name: 1, email: 1, lastLoginAt: 1 } }] } },
  { $set: { user: { $first: '$user' } } },
  {
    $lookup: {
      from: 'agencyaccesses',
      let: { u: '$user._id', a: '$agency' },
      pipeline: [{ $match: { $expr: { $and: [{ $eq: ['$user', '$$u'] }, { $eq: ['$agency', '$$a'] }] } } }, { $count: 'n' }],
      as: 'access',
    },
  },
  { $set: { clientCount: { $ifNull: [{ $first: '$access.n' }, 0] } } },
  { $unset: 'access' },
  // Memberships stored before these fields existed have none; aggregations skip schema defaults.
  { $set: { titles: { $ifNull: ['$titles', []] }, departments: { $ifNull: ['$departments', []] }, capacity: { $ifNull: ['$capacity', DEFAULT_CAPACITY] } } },
]

const SORTS = { name: { 'user.name': 1 }, newest: { createdAt: -1 }, oldest: { createdAt: 1 }, role: { role: 1 } } as const

const listSchema = z.object({
  ...pageQuery,
  role: csvEnum(MEMBER_ROLES),
  status: csvEnum(MEMBER_STATUSES),
  department: z.string().trim().max(60).optional(),
  sort: z.enum(Object.keys(SORTS) as [keyof typeof SORTS]).default('name'),
})

teamRouter.get('/members', async (req, res) => {
  const f = listSchema.parse(req.query)
  const match: Record<string, unknown> = { agency: req.agencyAuth!.agency._id }
  if (f.role.length) match.role = { $in: f.role }
  if (f.status.length) match.status = { $in: f.status }
  if (f.department) match.departments = f.department
  const pipeline: PipelineStage[] = [{ $match: match }, ...memberLookup]
  if (f.q) {
    const rx = new RegExp(escapeRegex(f.q), 'i')
    pipeline.push({ $match: { $or: [{ 'user.name': rx }, { 'user.email': rx }, { titles: rx }] } })
  }
  res.json(await paginateAggregate(MembershipModel, pipeline, { page: f.page, pageSize: f.pageSize, sort: SORTS[f.sort] }))
})

const updateSchema = z.object({
  role: z.enum(ASSIGNABLE_ROLES).optional(),
  canPublish: z.boolean().optional(),
  titles: z.array(z.string().trim().min(1).max(60)).max(10).optional(),
  departments: z.array(z.string().trim().min(1).max(60)).max(10).optional(),
  capacity: z.number().int().min(1).max(100).optional(),
})

teamRouter.patch('/members/:userId', requireRole('owner', 'admin'), async (req, res) => {
  const input = updateSchema.parse(req.body)
  const member = await managedMember(req, req.params.userId)
  if (input.role === 'admin' && req.agencyAuth!.role !== 'owner') throw forbidden('Only the owner can make someone an admin.')
  const before = member.toObject()
  member.set(Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)))
  await member.save()
  const changes = diff(before, member.toObject(), ['role', 'canPublish', 'titles', 'departments', 'capacity'])
  if (changes) {
    const user = await UserModel.findById(member.user, { name: 1 }).lean()
    await logActivity(req, {
      action: changes.after.role ? 'member.role_changed' : 'member.updated',
      message: changes.after.role
        ? `${req.agencyAuth!.user.name} changed ${user?.name}’s role to ${member.role}`
        : `${req.agencyAuth!.user.name} updated ${user?.name}’s details`,
      agency: member.agency,
      target: { type: 'user', id: member.user, label: user?.name },
      ...changes,
    })
  }
  res.json({ member })
})

/** Clients this person manages as account manager: they need a new one when the person leaves (rule §12.11). */
const needsReassignment = (agency: Types.ObjectId, user: Types.ObjectId) =>
  ClientModel.find({ agency, accountManager: user, deletedAt: null, status: { $ne: 'archived' } }, { name: 1, brandName: 1 }).lean()

async function flagReassignment(req: Request, agency: Types.ObjectId, user: Types.ObjectId, name: string) {
  const clients = await needsReassignment(agency, user)
  if (!clients.length) return clients
  const admins = await MembershipModel.find({ agency, role: { $in: ['owner', 'admin'] }, status: 'active' }, { user: 1 }).lean()
  await notify({
    recipients: admins.map((a) => a.user),
    audience: 'agency',
    agency,
    category: 'team',
    event: 'member.needs_reassignment',
    title: `${clients.length} client${clients.length === 1 ? '' : 's'} need a new account manager`,
    body: `${name} no longer has access: ${clients.map((c) => c.brandName).join(', ')}.`,
    link: '/app/clients',
    except: req.agencyAuth!.user._id,
  })
  return clients
}

teamRouter.post('/members/:userId/disable', requireRole('owner', 'admin'), async (req, res) => {
  const member = await managedMember(req, req.params.userId)
  const updated = await MembershipModel.findOneAndUpdate(
    { _id: member._id, status: 'active' },
    { $set: { status: 'disabled', disabledAt: new Date() } },
    { returnDocument: 'after' },
  )
  if (!updated) throw new AppError(409, 'invalid_state', 'This person is already disabled.', { status: member.status })
  await revokeMemberSessions(member.user, member.agency)
  const user = await UserModel.findById(member.user, { name: 1 }).lean()
  await logActivity(req, {
    action: 'member.disabled',
    message: `${req.agencyAuth!.user.name} disabled ${user?.name}`,
    agency: member.agency,
    target: { type: 'user', id: member.user, label: user?.name },
  })
  const reassign = await flagReassignment(req, member.agency, member.user, user?.name ?? 'A team member')
  res.json({ member: updated, needsReassignment: reassign })
})

teamRouter.post('/members/:userId/enable', requireRole('owner', 'admin'), async (req, res) => {
  const member = await managedMember(req, req.params.userId)
  const updated = await MembershipModel.findOneAndUpdate(
    { _id: member._id, status: 'disabled' },
    { $set: { status: 'active' }, $unset: { disabledAt: 1 } },
    { returnDocument: 'after' },
  )
  if (!updated) throw new AppError(409, 'invalid_state', 'This person is already active.', { status: member.status })
  const user = await UserModel.findById(member.user, { name: 1 }).lean()
  await logActivity(req, {
    action: 'member.enabled',
    message: `${req.agencyAuth!.user.name} re-enabled ${user?.name}`,
    agency: member.agency,
    target: { type: 'user', id: member.user, label: user?.name },
  })
  res.json({ member: updated })
})

/** Removes the person from the agency: membership and client access go, and their sessions end at once. */
teamRouter.delete('/members/:userId', requireRole('owner', 'admin'), async (req, res) => {
  const member = await managedMember(req, req.params.userId)
  await mongoose.connection.transaction(async (session) => {
    await MembershipModel.deleteOne({ _id: member._id }, { session })
    await AgencyAccessModel.deleteMany({ agency: member.agency, user: member.user }, { session })
  })
  await revokeMemberSessions(member.user, member.agency)
  const user = await UserModel.findById(member.user, { name: 1 }).lean()
  await logActivity(req, {
    action: 'member.removed',
    message: `${req.agencyAuth!.user.name} removed ${user?.name} from the team`,
    agency: member.agency,
    target: { type: 'user', id: member.user, label: user?.name },
    before: { role: member.role, status: member.status },
  })
  const reassign = await flagReassignment(req, member.agency, member.user, user?.name ?? 'A team member')
  res.json({ ok: true, needsReassignment: reassign })
})

const transferSchema = z.object({ userId: z.string() })

/** The owner hands ownership to an active admin, and becomes an admin themselves. */
teamRouter.post('/transfer-ownership', requireRole('owner'), async (req, res) => {
  const auth = req.agencyAuth!
  if (auth.impersonator) throw forbidden('Ownership can’t be transferred from a support session.')
  const to = objectId(transferSchema.parse(req.body).userId, 'Team member not found.')
  if (String(to) === String(auth.user._id)) throw forbidden('You are already the owner.')
  await mongoose.connection.transaction(async (session) => {
    const next = await MembershipModel.findOneAndUpdate(
      { agency: auth.agency._id, user: to, role: 'admin', status: 'active' },
      { $set: { role: 'owner' } },
      { session },
    )
    if (!next) throw new AppError(409, 'invalid_state', 'Ownership can only go to an active admin.')
    await MembershipModel.updateOne({ agency: auth.agency._id, user: auth.user._id, role: 'owner' }, { $set: { role: 'admin' } }, { session })
    await AgencyModel.updateOne({ _id: auth.agency._id }, { $set: { owner: to } }, { session })
  })
  const user = await UserModel.findById(to, { name: 1 }).lean()
  await logActivity(req, {
    action: 'agency.ownership_transferred',
    message: `${auth.user.name} transferred ownership of ${auth.agency.name} to ${user?.name}`,
    agency: auth.agency._id,
    target: { type: 'user', id: to, label: user?.name },
    before: { owner: auth.user._id },
    after: { owner: to },
  })
  await notify({
    recipients: [to],
    audience: 'agency',
    agency: auth.agency._id,
    category: 'security',
    event: 'agency.ownership_transferred',
    title: `You are now the owner of ${auth.agency.name}`,
    link: '/app/settings',
    urgent: true,
  })
  res.json({ ok: true })
})

// ── Invitations ──────────────────────────────────────────────────────────────

const inviteListSchema = z.object({
  ...pageQuery,
  status: csvEnum(INVITATION_STATUSES),
})

/** Agency team invitations. Client invitations are listed per client, under /clients/:id/invitations. */
teamRouter.get('/invitations', requireRole('owner', 'admin'), async (req, res) => {
  const f = inviteListSchema.parse(req.query)
  const match: Record<string, unknown> = { agency: req.agencyAuth!.agency._id, kind: 'agency' }
  // Default: the ones still worth showing (pending and expired), not revoked or accepted history.
  match.status = { $in: f.status.length ? f.status : ['pending', 'expired'] }
  if (f.q) match.email = new RegExp(escapeRegex(f.q), 'i')
  const page = await paginateAggregate<any>(InvitationModel, [{ $match: match }], { page: f.page, pageSize: f.pageSize, sort: { createdAt: -1 } })
  res.json({ ...page, items: page.items.map(presentInvitation) })
})

const inviteSchema = z.object({
  email: z.email('Enter a valid email').trim().toLowerCase(),
  role: z.enum(ASSIGNABLE_ROLES),
  message: z.string().trim().max(500).optional(),
})

teamRouter.post('/invitations', requireRole('owner', 'admin'), idempotent(), async (req, res) => {
  const input = inviteSchema.parse(req.body)
  if (input.role === 'admin' && req.agencyAuth!.role !== 'owner') throw forbidden('Only the owner can invite an admin.')
  const inv = await createInvitation(req, { kind: 'agency', agency: req.agencyAuth!.agency._id, ...input })
  res.status(201).json({ invitation: presentInvitation(inv.toObject()) })
})

/** Agency invitations need Owner/Admin; client invitations need Manager+ with access to that client. */
async function manageableInvitation(req: Request, id: unknown) {
  const auth = req.agencyAuth!
  const inv = await InvitationModel.findOne({ _id: objectId(id, 'Invitation not found.'), agency: auth.agency._id }).lean()
  if (!inv) throw notFound('Invitation not found.')
  if (inv.kind === 'agency') {
    if (auth.role !== 'owner' && auth.role !== 'admin') throw notFound('Invitation not found.')
  } else {
    await loadClient(req, inv.client!, 'manage')
  }
  return inv as any
}

teamRouter.post('/invitations/:id/resend', idempotent(), async (req, res) => {
  const inv = await resendInvitation(req, await manageableInvitation(req, req.params.id))
  res.status(201).json({ invitation: presentInvitation(inv.toObject()) })
})

teamRouter.post('/invitations/:id/revoke', async (req, res) => {
  const inv = await revokeInvitation(req, await manageableInvitation(req, req.params.id))
  res.json({ invitation: presentInvitation(inv.toObject() as any) })
})

