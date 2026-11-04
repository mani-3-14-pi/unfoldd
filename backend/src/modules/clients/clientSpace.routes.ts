import { Router, type Request } from 'express'
import { z } from 'zod'
import { objectId } from '../../lib/ids.ts'
import { notify } from '../../lib/notify.ts'
import { csvEnum, pageQuery, paginate, paginateAggregate } from '../../lib/pagination.ts'
import { CLIENT_CAN, clientCan, scopeFilter } from '../../lib/scope.ts'
import { presignDownload, storageConfigured } from '../../lib/storage.ts'
import { idempotent } from '../../middleware/idempotency.ts'
import { forbidden, notFound } from '../../utils/AppError.ts'
import { ActivityModel } from '../activity/activity.model.ts'
import { FileModel } from '../files/file.model.ts'
import { INVITATION_STATUSES, InvitationModel } from '../invitations/invitation.model.ts'
import { createInvitation, presentInvitation, resendInvitation, revokeInvitation } from '../invitations/invitation.service.ts'
import { AgencyAccessModel } from './agencyAccess.model.ts'
import { CLIENT_ROLES, ClientMemberModel } from './clientMember.model.ts'
import { assertAdminWillExist, changeClientMember, clientMembersPipeline } from './clientMember.service.ts'
import { ClientModel } from './client.model.ts'

/** The Client App's own space: the brand's people, seen from their side. Everything is scoped to one client. */
export const clientSpaceRouter = Router()

const requireClientAdmin = (req: Request) => {
  if (!clientCan(req.clientAuth!.role, 'invite')) throw forbidden('Only a client admin can do that.')
}

const signedLogo = async (id: unknown) => {
  if (!id || !storageConfigured()) return null
  const file = await FileModel.findOne({ _id: id, status: 'ready', deletedAt: null }).lean()
  return file ? (await presignDownload(file.key, file, { inline: true })).url : null
}

clientSpaceRouter.get('/', async (req, res) => {
  const auth = req.clientAuth!
  const client = await ClientModel.findById(auth.client._id, { name: 1, brandName: 1, logo: 1, status: 1, timezone: 1, showAnalytics: 1, accountManager: 1 })
    .populate('accountManager', 'name email')
    .lean()
  res.json({
    client: { ...client, logoUrl: await signedLogo(client?.logo) },
    agency: { id: auth.agency._id, name: auth.agency.name, logoUrl: await signedLogo(auth.agency.logo) },
    role: auth.role,
    can: Object.fromEntries(Object.keys(CLIENT_CAN).map((k) => [k, clientCan(auth.role, k as keyof typeof CLIENT_CAN)])),
  })
})

clientSpaceRouter.get('/members', async (req, res) => {
  const items = await ClientMemberModel.aggregate([...clientMembersPipeline(req.clientAuth!.client._id), { $match: { status: 'active' } }])
  res.json({ items })
})

const roleSchema = z.object({ role: z.enum(CLIENT_ROLES) })

clientSpaceRouter.patch('/members/:userId', async (req, res) => {
  requireClientAdmin(req)
  const { role } = roleSchema.parse(req.body)
  const client = await ClientModel.findById(req.clientAuth!.client._id)
  await changeClientMember(req, client!, objectId(req.params.userId, 'Member not found.'), { role })
  res.json({ ok: true })
})

clientSpaceRouter.delete('/members/:userId', async (req, res) => {
  requireClientAdmin(req)
  const client = await ClientModel.findById(req.clientAuth!.client._id)
  await changeClientMember(req, client!, objectId(req.params.userId, 'Member not found.'), { remove: true })
  res.json({ ok: true })
})

const inviteListSchema = z.object({ ...pageQuery, status: csvEnum(INVITATION_STATUSES) })

clientSpaceRouter.get('/invitations', async (req, res) => {
  requireClientAdmin(req)
  const f = inviteListSchema.parse(req.query)
  const match = { client: req.clientAuth!.client._id, kind: 'client', status: { $in: f.status.length ? f.status : ['pending', 'expired'] } }
  const page = await paginateAggregate<any>(InvitationModel, [{ $match: match }], { page: f.page, pageSize: f.pageSize, sort: { createdAt: -1 } })
  res.json({ ...page, items: page.items.map(presentInvitation) })
})

const inviteSchema = z.object({
  email: z.email('Enter a valid email').trim().toLowerCase(),
  role: z.enum(CLIENT_ROLES),
  message: z.string().trim().max(500).optional(),
})

/** D48: a client Admin invites their own colleagues; the agency is told and can revoke. */
clientSpaceRouter.post('/invitations', idempotent(), async (req, res) => {
  requireClientAdmin(req)
  const auth = req.clientAuth!
  const input = inviteSchema.parse(req.body)
  await assertAdminWillExist(auth.client._id, input.role)
  const inv = await createInvitation(req, { kind: 'client', agency: auth.agency._id, client: auth.client._id, ...input })

  const client = await ClientModel.findById(auth.client._id, { accountManager: 1 }).lean()
  const team = await AgencyAccessModel.find({ client: auth.client._id }, { user: 1 }).lean()
  await notify({
    recipients: [...(client?.accountManager ? [client.accountManager] : []), ...team.map((t) => t.user)],
    audience: 'agency',
    agency: auth.agency._id,
    client: auth.client._id,
    category: 'clients',
    event: 'client_member.invited_by_client',
    title: `${auth.user.name} invited ${input.email} to ${auth.client.brandName}`,
    body: `Role: ${input.role}. You can cancel the invitation from the client’s members page.`,
    entity: { type: 'invitation', id: inv._id },
    link: `/app/clients/${auth.client._id}/members`,
  })
  res.status(201).json({ invitation: presentInvitation(inv.toObject()) })
})

async function ownInvitation(req: Request) {
  requireClientAdmin(req)
  const inv = await InvitationModel.findOne({ _id: objectId(req.params.id, 'Invitation not found.'), client: req.clientAuth!.client._id, kind: 'client' }).lean()
  if (!inv) throw notFound('Invitation not found.')
  return inv as any
}

clientSpaceRouter.post('/invitations/:id/resend', idempotent(), async (req, res) => {
  const inv = await resendInvitation(req, await ownInvitation(req))
  res.status(201).json({ invitation: presentInvitation(inv.toObject()) })
})

clientSpaceRouter.post('/invitations/:id/revoke', async (req, res) => {
  const inv = await revokeInvitation(req, await ownInvitation(req))
  res.json({ invitation: presentInvitation(inv.toObject() as any) })
})

/** The client's feed: only `client`-visibility events, never internal ones (D20). */
clientSpaceRouter.get('/activity', async (req, res) => {
  const f = z.object(pageQuery).parse(req.query)
  const filter = await scopeFilter(req, { visibility: true })
  const page = await paginate(ActivityModel, filter, { page: f.page, pageSize: f.pageSize, sort: { createdAt: -1 } })
  res.json({
    ...page,
    items: page.items.map((e) => ({ id: e._id, action: e.action, message: e.message, actor: { type: e.actor?.type, name: e.actor?.name }, target: e.target, createdAt: e.createdAt })),
  })
})

/** F73: the client space's settings, as the client sees them. The contract stays with the agency. */
clientSpaceRouter.get('/settings', async (req, res) => {
  const c = await ClientModel.findById(req.clientAuth!.client._id, { name: 1, brandName: 1, timezone: 1, contact: 1, showAnalytics: 1, status: 1 }).lean()
  res.json({ settings: c, role: req.clientAuth!.role })
})

const settingsSchema = z.object({
  contact: z
    .object({
      name: z.string().trim().max(100).optional(),
      email: z.union([z.email().trim().toLowerCase(), z.literal('')]).optional(),
      phone: z.string().trim().max(30).optional(),
    })
    .optional(),
})

/** Client admins keep their contact details current. */
clientSpaceRouter.patch('/settings', async (req, res) => {
  requireClientAdmin(req)
  const { contact } = settingsSchema.parse(req.body)
  const set = Object.fromEntries(Object.entries(contact ?? {}).filter(([, v]) => v !== undefined).map(([k, v]) => [`contact.${k}`, v]))
  const c = await ClientModel.findByIdAndUpdate(req.clientAuth!.client._id, { $set: set }, { returnDocument: 'after', projection: { name: 1, brandName: 1, timezone: 1, contact: 1 } }).lean()
  res.json({ settings: c })
})
