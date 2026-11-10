import { Router, type Request } from 'express'
import type { PipelineStage, Types } from 'mongoose'
import { z } from 'zod'
import { diff, logActivity } from '../../lib/activity.ts'
import { transition, updateWithRev } from '../../lib/concurrency.ts'
import { objectId } from '../../lib/ids.ts'
import { notify } from '../../lib/notify.ts'
import { csvEnum, escapeRegex, pageQuery, paginateAggregate } from '../../lib/pagination.ts'
import { isManagerPlus, loadClient, scopeFilter } from '../../lib/scope.ts'
import { revokeClientMemberSessions } from '../../lib/session.ts'
import { presignDownload, storageConfigured } from '../../lib/storage.ts'
import { dateOnlySchema, timezoneSchema } from '../../lib/time.ts'
import { requireRole } from '../../middleware/auth.ts'
import { idempotent } from '../../middleware/idempotency.ts'
import { invalid, notFound } from '../../utils/AppError.ts'
import { AgencyModel } from '../agencies/agency.model.ts'
import { FileModel } from '../files/file.model.ts'
import { INVITATION_STATUSES, InvitationModel } from '../invitations/invitation.model.ts'
import { createInvitation, grantAccess, presentInvitation } from '../invitations/invitation.service.ts'
import { MembershipModel } from '../users/membership.model.ts'
import { clientHealth } from '../dashboard/insights.ts'
import { AgencyAccessModel } from './agencyAccess.model.ts'
import { CLIENT_ROLES, ClientMemberModel } from './clientMember.model.ts'
import { assertAdminWillExist, changeClientMember, clientMembersPipeline } from './clientMember.service.ts'
import { CLIENT_STATUSES, CLIENT_TRANSITIONS, ClientModel, type ClientAction } from './client.model.ts'

/** Agency-side client management (P13–P20, Flow 2). Managers and Members see only clients they're assigned to. */
export const clientsRouter = Router()

const EDITABLE = ['name', 'brandName', 'logo', 'contact', 'services', 'accountManager', 'startDate', 'notes', 'timezone', 'contract', 'showAnalytics'] as const

async function present(req: Request, client: Record<string, any>) {
  let logoUrl: string | null = null
  if (client.logo && storageConfigured()) {
    const file = await FileModel.findOne({ _id: client.logo, status: 'ready', deletedAt: null }).lean()
    if (file) logoUrl = (await presignDownload(file.key, file, { inline: true })).url
  }
  const { memberRev: _m, deletedAt: _d, deletedBy: _db, ...rest } = client
  return { ...rest, logoUrl, canManage: isManagerPlus(req.agencyAuth!.role) && client.status !== 'archived' }
}

/** A team member who can be account manager or be given access: active in this agency. */
async function activeTeamMember(agency: Types.ObjectId, user: string, field: string) {
  const id = objectId(user)
  if (!(await MembershipModel.exists({ agency, user: id, status: 'active' }))) throw invalid(field, 'Pick someone on your team')
  return id
}

/** A logo uploaded for this client, or before it existed (no client yet). */
async function logoFile(agency: Types.ObjectId, client: Types.ObjectId | null, logo: string) {
  const file = await FileModel.findOne({ _id: objectId(logo), agency, client: { $in: [client, null] }, purpose: 'logo', status: 'ready', deletedAt: null }).lean()
  if (!file) throw invalid('logo', 'Upload the logo first')
  return file._id
}

// ── Directory ────────────────────────────────────────────────────────────────

const SORTS = { newest: { createdAt: -1 }, oldest: { createdAt: 1 }, name: { brandName: 1 }, name_desc: { brandName: -1 } } as const

const listSchema = z.object({
  ...pageQuery,
  status: csvEnum(CLIENT_STATUSES),
  accountManager: z.string().optional(),
  /** `mine` = only clients I'm assigned to, even for Owner/Admin. */
  mine: z.stringbool().optional(),
  sort: z.enum(Object.keys(SORTS) as [keyof typeof SORTS]).default('name'),
})

clientsRouter.get('/', async (req, res) => {
  const f = listSchema.parse(req.query)
  const base: Record<string, unknown> = await scopeFilter(req, { clientField: '_id', softDelete: true, agencyLevel: false })
  if (f.mine && !base._id) {
    const mine = await AgencyAccessModel.find({ agency: req.agencyAuth!.agency._id, user: req.agencyAuth!.user._id }, { client: 1 }).lean()
    base._id = { $in: mine.map((m) => m.client) }
  }
  if (f.accountManager) base.accountManager = objectId(f.accountManager)
  if (f.q) {
    const rx = new RegExp(escapeRegex(f.q), 'i')
    base.$or = [{ name: rx }, { brandName: rx }, { 'contact.name': rx }, { 'contact.email': rx }]
  }
  const lookups: PipelineStage[] = [
    {
      $lookup: { from: 'users', localField: 'accountManager', foreignField: '_id', as: 'accountManager', pipeline: [{ $project: { name: 1, email: 1 } }] },
    },
    { $set: { accountManager: { $first: '$accountManager' } } },
    { $project: { memberRev: 0, deletedAt: 0, deletedBy: 0 } },
  ]
  // Archived clients are hidden unless asked for.
  const status = f.status.length ? { status: { $in: f.status } } : { status: { $ne: 'archived' } }
  const [page, statusCounts] = await Promise.all([
    paginateAggregate(ClientModel, [{ $match: { ...base, ...status } }, ...lookups], { page: f.page, pageSize: f.pageSize, sort: SORTS[f.sort] }),
    ClientModel.aggregate<{ _id: string; n: number }>([{ $match: base }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
  ])
  const counts = Object.fromEntries(CLIENT_STATUSES.map((s) => [s, 0])) as Record<string, number>
  for (const { _id, n } of statusCounts) counts[_id] = n
  // D69: health is derived live for the clients on this page.
  const health = await clientHealth(req.agencyAuth!.agency._id, page.items.map((c: any) => c._id))
  res.json({ ...page, items: page.items.map((c: any) => ({ ...c, health: health.get(String(c._id)) ?? { health: 'on_track', reasons: [] } })), counts })
})

const contractSchema = z.object({
  revisionsIncluded: z.number().int().min(0).max(50),
  approvalLeadHours: z.number().int().min(0).max(24 * 30),
  internalReview: z.boolean(),
})

const fieldsSchema = z.object({
  name: z.string().trim().min(1, 'Enter the company name').max(120),
  brandName: z.string().trim().min(1, 'Enter the brand name').max(120),
  logo: z.string().nullable().optional(),
  contact: z
    .object({
      name: z.string().trim().max(100).default(''),
      email: z.union([z.email('Enter a valid email').trim().toLowerCase(), z.literal('')]).default(''),
      phone: z.string().trim().max(30).default(''),
    })
    .optional(),
  services: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  accountManager: z.string().nullable().optional(),
  startDate: z.union([dateOnlySchema, z.literal('')]).optional(),
  notes: z.string().trim().max(5000).optional(),
  timezone: timezoneSchema.optional(),
  contract: contractSchema.partial().optional(),
  showAnalytics: z.boolean().optional(),
})

clientsRouter.post('/', requireRole('owner', 'admin', 'manager'), idempotent(), async (req, res) => {
  const input = fieldsSchema.parse(req.body)
  const auth = req.agencyAuth!
  const agency = await AgencyModel.findById(auth.agency._id, { timezone: 1, clientDefaults: 1 }).lean()
  const accountManager = input.accountManager ? await activeTeamMember(auth.agency._id, input.accountManager, 'accountManager') : auth.user._id

  const client = await ClientModel.create({
    agency: auth.agency._id,
    name: input.name,
    brandName: input.brandName,
    contact: input.contact,
    services: input.services,
    accountManager,
    startDate: input.startDate ?? '',
    notes: input.notes ?? '',
    timezone: input.timezone ?? agency?.timezone ?? 'UTC',
    // Contract defaults come from the agency's workspace settings (Flow 1, step 2).
    contract: { ...agency?.clientDefaults, ...input.contract },
    showAnalytics: input.showAnalytics ?? false,
    createdBy: auth.user._id,
    statusChangedAt: new Date(),
    updatedBy: { id: auth.user._id, name: auth.user.name },
  })
  if (input.logo) {
    client.logo = await logoFile(auth.agency._id, null, input.logo)
    await client.save()
  }
  // The creator and the account manager can always see the client (Flow 2, step 1).
  await grantAccess(auth.agency._id, client._id, auth.user._id, auth.user._id)
  if (String(accountManager) !== String(auth.user._id)) await grantAccess(auth.agency._id, client._id, accountManager, auth.user._id)

  await logActivity(req, {
    action: 'client.created',
    message: `${auth.user.name} added the client ${client.brandName}`,
    agency: auth.agency._id,
    client: client._id,
    target: { type: 'client', id: client._id, label: client.brandName },
  })
  res.status(201).json({ client: await present(req, client.toObject()) })
})

clientsRouter.get('/:id', async (req, res) => {
  const client = await loadClient(req, objectId(req.params.id, 'Client not found.'))
  await client.populate('accountManager', 'name email')
  const health = await clientHealth(client.agency, [client._id])
  res.json({ client: { ...(await present(req, client.toObject())), health: health.get(String(client._id)) } })
})

const patchSchema = fieldsSchema.partial().extend({ rev: z.number().int().min(1) })

clientsRouter.patch('/:id', async (req, res) => {
  const { rev, logo, accountManager, contract, ...rest } = patchSchema.parse(req.body)
  const auth = req.agencyAuth!
  const client = await loadClient(req, objectId(req.params.id, 'Client not found.'), 'manage')
  const set: Record<string, unknown> = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined))
  if (logo !== undefined) set.logo = logo === null ? null : await logoFile(auth.agency._id, client._id, logo)
  if (accountManager !== undefined) {
    set.accountManager = accountManager === null ? null : await activeTeamMember(auth.agency._id, accountManager, 'accountManager')
  }
  if (contract) for (const [k, v] of Object.entries(contract)) if (v !== undefined) set[`contract.${k}`] = v

  const before = client.toObject()
  const updated = await updateWithRev(ClientModel, { _id: client._id, agency: auth.agency._id }, rev, set, auth.user)
  if (set.accountManager) await grantAccess(auth.agency._id, client._id, set.accountManager as Types.ObjectId, auth.user._id)

  const changes = diff(before, updated.toObject(), [...EDITABLE])
  if (changes) {
    await logActivity(req, {
      action: 'client.updated',
      message: `${auth.user.name} updated ${updated.brandName}’s details`,
      agency: auth.agency._id,
      client: client._id,
      target: { type: 'client', id: client._id, label: updated.brandName },
      ...changes,
    })
  }
  res.json({ client: await present(req, updated.toObject()) })
})

const ACTIONS = ['activate', 'pause', 'complete', 'archive', 'restore'] as const satisfies readonly ClientAction[]
const PAST: Record<ClientAction, string> = { activate: 'activated', pause: 'paused', complete: 'completed', archive: 'archived', restore: 'restored' }

clientsRouter.post('/:id/:action', async (req, res, next) => {
  const action = req.params.action as ClientAction
  if (!(ACTIONS as readonly string[]).includes(action)) return next()
  const auth = req.agencyAuth!
  const current = await loadClient(req, objectId(req.params.id, 'Client not found.'), 'read')
  if (!isManagerPlus(auth.role)) throw notFound('Client not found.')
  const filter = { _id: current._id, agency: auth.agency._id }
  const now = new Date()

  const client =
    action === 'restore'
      ? await transition(ClientModel, filter, { from: ['archived'], to: current.statusBeforeArchive ?? 'active' }, {
          label: 'client',
          set: { statusBeforeArchive: null, statusChangedAt: now },
        })
      : await transition(ClientModel, filter, CLIENT_TRANSITIONS[action], {
          label: 'client',
          set: { statusChangedAt: now, ...(action === 'archive' ? { statusBeforeArchive: current.status } : {}) },
        })

  await logActivity(req, {
    action: `client.${PAST[action]}`,
    message: `${auth.user.name} ${PAST[action]} ${client.brandName}`,
    agency: auth.agency._id,
    client: client._id,
    target: { type: 'client', id: client._id, label: client.brandName },
    before: { status: current.status },
    after: { status: client.status },
  })
  res.json({ client: await present(req, client.toObject()) })
})

/** Soft delete (D61). Owner/Admin only; the client's people lose access at once and pending invite links stop working. */
clientsRouter.delete('/:id', requireRole('owner', 'admin'), async (req, res) => {
  const auth = req.agencyAuth!
  const client = await loadClient(req, objectId(req.params.id, 'Client not found.'))
  await ClientModel.updateOne({ _id: client._id, agency: auth.agency._id }, { $set: { deletedAt: new Date(), deletedBy: auth.user._id } })
  await InvitationModel.updateMany({ client: client._id, status: 'pending' }, { $set: { status: 'revoked' } })
  const members = await ClientMemberModel.find({ client: client._id }, { user: 1 }).lean()
  await Promise.all(members.map((m) => revokeClientMemberSessions(m.user, client._id)))
  await logActivity(req, {
    action: 'client.deleted',
    message: `${auth.user.name} deleted the client ${client.brandName}`,
    agency: auth.agency._id,
    client: client._id,
    target: { type: 'client', id: client._id, label: client.brandName },
  })
  res.status(204).end()
})

// ── Agency access: who on the team works on this client ───────────────────────

clientsRouter.get('/:id/access', async (req, res) => {
  const client = await loadClient(req, objectId(req.params.id, 'Client not found.'))
  const rows = await AgencyAccessModel.aggregate([
    { $match: { client: client._id } },
    { $lookup: { from: 'users', localField: 'user', foreignField: '_id', as: 'user', pipeline: [{ $project: { name: 1, email: 1 } }] } },
    { $set: { user: { $first: '$user' } } },
    { $lookup: { from: 'memberships', let: { u: '$user._id' }, pipeline: [{ $match: { $expr: { $and: [{ $eq: ['$user', '$$u'] }, { $eq: ['$agency', client.agency] }] } } }, { $project: { role: 1, titles: 1, departments: 1, status: 1 } }], as: 'membership' } },
    { $set: { membership: { $first: '$membership' } } },
    { $sort: { 'user.name': 1 } },
  ])
  // Owner and Admin see every client without an access row; list them so the screen is complete.
  const admins = await MembershipModel.find({ agency: client.agency, role: { $in: ['owner', 'admin'] }, status: 'active' })
    .populate('user', 'name email')
    .lean()
  res.json({ items: rows, alwaysVisibleTo: admins.map((a) => ({ user: a.user, role: a.role })) })
})

const accessSchema = z.object({ userId: z.string() })

clientsRouter.post('/:id/access', async (req, res) => {
  const auth = req.agencyAuth!
  const client = await loadClient(req, objectId(req.params.id, 'Client not found.'), 'manage')
  const user = await activeTeamMember(auth.agency._id, accessSchema.parse(req.body).userId, 'userId')
  await grantAccess(auth.agency._id, client._id, user, auth.user._id)
  const member = await MembershipModel.findOne({ agency: auth.agency._id, user }).populate<{ user: { name: string } }>('user', 'name').lean()
  const event = await logActivity(req, {
    action: 'client.access_granted',
    message: `${auth.user.name} gave ${member?.user.name} access to ${client.brandName}`,
    agency: auth.agency._id,
    client: client._id,
    target: { type: 'user', id: user, label: member?.user.name },
  })
  await notify({
    recipients: [user],
    audience: 'agency',
    agency: auth.agency._id,
    client: client._id,
    category: 'clients',
    event: 'client.access_granted',
    title: `You now have access to ${client.brandName}`,
    entity: { type: 'client', id: client._id },
    link: `/app/clients/${client._id}`,
    activity: event?._id,
    except: auth.user._id,
  })
  res.status(201).json({ ok: true })
})

clientsRouter.delete('/:id/access/:userId', async (req, res) => {
  const auth = req.agencyAuth!
  const client = await loadClient(req, objectId(req.params.id, 'Client not found.'), 'manage')
  const user = objectId(req.params.userId, 'Access not found.')
  const removed = await AgencyAccessModel.findOneAndDelete({ client: client._id, user })
  if (!removed) throw notFound('Access not found.')
  await logActivity(req, {
    action: 'client.access_removed',
    message: `${auth.user.name} removed someone’s access to ${client.brandName}`,
    agency: auth.agency._id,
    client: client._id,
    target: { type: 'user', id: user },
  })
  res.json({ ok: true, wasAccountManager: String(client.accountManager) === String(user) })
})

// ── Client members (the brand's own people) ──────────────────────────────────

clientsRouter.get('/:id/members', async (req, res) => {
  const client = await loadClient(req, objectId(req.params.id, 'Client not found.'))
  res.json({ items: await ClientMemberModel.aggregate(clientMembersPipeline(client._id)) })
})

const roleSchema = z.object({ role: z.enum(CLIENT_ROLES) })

clientsRouter.patch('/:id/members/:userId', async (req, res) => {
  const { role } = roleSchema.parse(req.body)
  const client = await loadClient(req, objectId(req.params.id, 'Client not found.'), 'manage')
  await changeClientMember(req, client, objectId(req.params.userId, 'Member not found.'), { role })
  res.json({ ok: true })
})

clientsRouter.delete('/:id/members/:userId', async (req, res) => {
  const client = await loadClient(req, objectId(req.params.id, 'Client not found.'), 'manage')
  await changeClientMember(req, client, objectId(req.params.userId, 'Member not found.'), { remove: true })
  res.json({ ok: true })
})

const inviteListSchema = z.object({ ...pageQuery, status: csvEnum(INVITATION_STATUSES) })

clientsRouter.get('/:id/invitations', async (req, res) => {
  const f = inviteListSchema.parse(req.query)
  const client = await loadClient(req, objectId(req.params.id, 'Client not found.'))
  const match = { client: client._id, kind: 'client', status: { $in: f.status.length ? f.status : ['pending', 'expired'] } }
  const page = await paginateAggregate<any>(InvitationModel, [{ $match: match }], { page: f.page, pageSize: f.pageSize, sort: { createdAt: -1 } })
  res.json({ ...page, items: page.items.map(presentInvitation) })
})

const inviteSchema = z.object({
  email: z.email('Enter a valid email').trim().toLowerCase(),
  role: z.enum(CLIENT_ROLES),
  message: z.string().trim().max(500).optional(),
})

clientsRouter.post('/:id/invitations', idempotent(), async (req, res) => {
  const input = inviteSchema.parse(req.body)
  const client = await loadClient(req, objectId(req.params.id, 'Client not found.'), 'manage')
  await assertAdminWillExist(client._id, input.role)
  const inv = await createInvitation(req, { kind: 'client', agency: client.agency, client: client._id, ...input })
  res.status(201).json({ invitation: presentInvitation(inv.toObject()) })
})
