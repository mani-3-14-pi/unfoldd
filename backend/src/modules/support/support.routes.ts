import { Router } from 'express'
import { z } from 'zod'
import { env } from '../../config/env.ts'
import { logActivity } from '../../lib/activity.ts'
import { objectId } from '../../lib/ids.ts'
import { sendEmail } from '../../lib/mailer.ts'
import { csvEnum, pageQuery, paginate } from '../../lib/pagination.ts'
import { currentUser } from '../../lib/scope.ts'
import { AppError, notFound } from '../../utils/AppError.ts'
import { AgencyModel } from '../agencies/agency.model.ts'
import { ClientModel } from '../clients/client.model.ts'
import { UserModel } from '../users/user.model.ts'
import { SupportTicketModel, TICKET_CATEGORIES, TICKET_STATUSES } from './support.model.ts'

/** Support: people raise and follow their own tickets (/support); platform admins answer (/admin/support). */
export const supportRouter = Router()
export const supportAdminRouter = Router()

const createSchema = z.object({
  category: z.enum(TICKET_CATEGORIES).default('question'),
  subject: z.string().trim().min(3).max(200),
  message: z.string().trim().min(1).max(10_000),
  context: z.object({ url: z.string().max(1000).default(''), entityType: z.string().max(40).default(''), entityId: z.string().max(40).default('') }).partial().default({}),
})

supportRouter.post('/tickets', async (req, res) => {
  const input = createSchema.parse(req.body)
  const me = currentUser(req)
  const user = await UserModel.findById(me._id, { email: 1 }).lean()
  const ticket = await SupportTicketModel.create({
    agency: req.agencyAuth?.agency._id ?? req.clientAuth?.agency._id ?? null,
    client: req.clientAuth?.client._id ?? null,
    user: { id: me._id, name: me.name, email: user?.email, side: me.side },
    category: input.category,
    subject: input.subject,
    context: { ...input.context, userAgent: req.get('user-agent')?.slice(0, 300) ?? '' },
    messages: [{ from: 'user', author: { id: me._id, name: me.name }, body: input.message }],
  })
  if (env.SUPPORT_EMAIL) {
    await sendEmail({ to: env.SUPPORT_EMAIL, subject: `[Support] ${input.subject}`, text: `${me.name} (${user?.email}, ${me.side})\nCategory: ${input.category}\n\n${input.message}\n\nTicket ${ticket._id}`, kind: 'support' })
  }
  res.status(201).json({ ticket })
})

supportRouter.get('/tickets', async (req, res) => {
  const f = z.object(pageQuery).parse(req.query)
  res.json(await paginate(SupportTicketModel, { 'user.id': currentUser(req)._id }, { page: f.page, pageSize: f.pageSize, sort: { lastMessageAt: -1 } }))
})

const ownTicket = async (req: Parameters<typeof currentUser>[0], id: unknown) => {
  const t = await SupportTicketModel.findOne({ _id: objectId(id, 'Ticket not found.'), 'user.id': currentUser(req)._id })
  if (!t) throw notFound('Ticket not found.')
  return t
}

supportRouter.get('/tickets/:id', async (req, res) => {
  res.json({ ticket: await ownTicket(req, req.params.id) })
})

supportRouter.post('/tickets/:id/messages', async (req, res) => {
  const { body } = z.object({ body: z.string().trim().min(1).max(10_000) }).parse(req.body)
  const t = await ownTicket(req, req.params.id)
  const me = currentUser(req)
  t.messages.push({ from: 'user', author: { id: me._id, name: me.name }, body, at: new Date() })
  t.lastMessageAt = new Date()
  // A reply reopens a ticket that was waiting on the person or resolved.
  if (t.status !== 'in_progress') t.status = 'open'
  await t.save()
  res.status(201).json({ ticket: t })
})

// ── Platform admin ───────────────────────────────────────────────────────────

const adminListSchema = z.object({ ...pageQuery, status: csvEnum(TICKET_STATUSES), category: csvEnum(TICKET_CATEGORIES) })

supportAdminRouter.get('/', async (req, res) => {
  const f = adminListSchema.parse(req.query)
  const filter: Record<string, unknown> = {}
  filter.status = { $in: f.status.length ? f.status : ['open', 'in_progress', 'waiting_on_user'] }
  if (f.category.length) filter.category = { $in: f.category }
  if (f.q) {
    const rx = new RegExp(f.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    filter.$or = [{ subject: rx }, { 'user.name': rx }, { 'user.email': rx }]
  }
  const page = await paginate(SupportTicketModel, filter, { page: f.page, pageSize: f.pageSize, sort: { lastMessageAt: -1 } })
  res.json({ ...page, items: await withNames(page.items) })
})

/** Which agency and client space each ticket came from, by name, for the support inbox. */
async function withNames<T extends { agency?: unknown; client?: unknown }>(tickets: T[]) {
  const [agencies, clients] = await Promise.all([
    AgencyModel.find({ _id: { $in: tickets.map((t) => t.agency).filter(Boolean) } }, { name: 1 }).lean(),
    ClientModel.find({ _id: { $in: tickets.map((t) => t.client).filter(Boolean) } }, { brandName: 1 }).lean(),
  ])
  return tickets.map((t) => ({
    ...t,
    agencyName: agencies.find((a) => String(a._id) === String(t.agency))?.name ?? null,
    clientName: clients.find((c) => String(c._id) === String(t.client))?.brandName ?? null,
  }))
}

supportAdminRouter.get('/:id', async (req, res) => {
  const t = await SupportTicketModel.findById(objectId(req.params.id, 'Ticket not found.')).lean()
  if (!t) throw notFound('Ticket not found.')
  const [ticket] = await withNames([t])
  res.json({ ticket })
})

const replySchema = z.object({ body: z.string().trim().min(1).max(10_000), status: z.enum(TICKET_STATUSES).default('waiting_on_user') })

supportAdminRouter.post('/:id/reply', async (req, res) => {
  const input = replySchema.parse(req.body)
  const t = await SupportTicketModel.findById(objectId(req.params.id, 'Ticket not found.'))
  if (!t) throw notFound('Ticket not found.')
  const admin = req.admin!
  t.messages.push({ from: 'support', author: { id: admin._id, name: admin.name }, body: input.body, at: new Date() })
  t.status = input.status
  t.lastMessageAt = new Date()
  t.resolvedAt = input.status === 'resolved' ? new Date() : null
  await t.save()
  if (t.user?.email) await sendEmail({ to: t.user.email, subject: `Re: ${t.subject}`, text: `${input.body}\n\n— Unfoldd support`, kind: 'support' })
  await logActivity(req, { action: 'support.replied', message: `${admin.name} replied to “${t.subject}”`, agency: t.agency ?? undefined, visibility: 'platform' })
  res.json({ ticket: t })
})

supportAdminRouter.patch('/:id', async (req, res) => {
  const { status } = z.object({ status: z.enum(TICKET_STATUSES) }).parse(req.body)
  const t = await SupportTicketModel.findByIdAndUpdate(objectId(req.params.id, 'Ticket not found.'), { $set: { status, resolvedAt: status === 'resolved' ? new Date() : null } }, { returnDocument: 'after' }).lean()
  if (!t) throw new AppError(404, 'not_found', 'Ticket not found.')
  await logActivity(req, {
    action: 'support.status_changed',
    message: `${req.admin!.name} marked “${t.subject}” ${status.replace(/_/g, ' ')}`,
    agency: t.agency ?? undefined,
    visibility: 'platform',
  })
  res.json({ ticket: t })
})
