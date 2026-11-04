import { Router, type Request } from 'express'
import type { Types } from 'mongoose'
import { z } from 'zod'
import { diff, logActivity } from '../../lib/activity.ts'
import { transition, updateWithRev, type Transition } from '../../lib/concurrency.ts'
import { objectId } from '../../lib/ids.ts'
import { notify } from '../../lib/notify.ts'
import { csvEnum, escapeRegex, pageQuery, paginate } from '../../lib/pagination.ts'
import { clientCan, loadClient, scopeFilter } from '../../lib/scope.ts'
import { dateOnlySchema, todayIn } from '../../lib/time.ts'
import { idempotent } from '../../middleware/idempotency.ts'
import { AppError, forbidden, invalid, notFound } from '../../utils/AppError.ts'
import { CampaignModel } from '../campaigns/campaign.model.ts'
import { ClientModel } from '../clients/client.model.ts'
import { clientPeople } from '../content/content.recipients.ts'
import { ContentModel, PRIORITIES } from '../content/content.model.ts'
import { FILE_CATEGORIES, FileModel } from '../files/file.model.ts'
import { releaseDependents } from '../tasks/task.service.ts'
import { addDays, loadTemplate } from '../templates/template.service.ts'
import { REQUEST_STATUSES, REQUEST_TRANSITIONS, RequestModel, type ClientRequest, type RequestStatus } from './request.model.ts'

/** Needed From You (Flow 9): agency side and client side. */
export const requestsRouter = Router()
export const clientRequestsRouter = Router()

type RequestDoc = ClientRequest & { _id: Types.ObjectId }

/** Client labels (§6.6): Needed · Submitted · Done. */
const CLIENT_LABEL: Partial<Record<RequestStatus, string>> = { open: 'Needed', submitted: 'Submitted', completed: 'Done', cancelled: 'Cancelled' }

/** Overdue is derived: past due in the client's timezone and still open. */
const isOverdue = (r: { status: string; due?: string | null }, today: string) => r.status === 'open' && !!r.due && r.due < today

async function timezones(clientIds: Types.ObjectId[]) {
  const clients = await ClientModel.find({ _id: { $in: clientIds } }, { timezone: 1 }).lean()
  return new Map(clients.map((c) => [String(c._id), todayIn(c.timezone)]))
}

const reqLink = (r: { _id: Types.ObjectId }, side: 'agency' | 'client') => (side === 'client' ? `/c/requests/${r._id}` : `/app/requests/${r._id}`)

async function move(req: Request, request: RequestDoc, rule: Transition<RequestStatus>, set: Record<string, unknown> = {}) {
  const updated = await transition(RequestModel, { _id: request._id, agency: request.agency, deletedAt: null }, rule, {
    label: 'request',
    set: { ...set, statusChangedAt: new Date() },
  })
  // D38: tasks waiting on this request are released when it reaches an end state.
  if (['completed', 'cancelled'].includes(updated.status)) await releaseDependents(req, { _id: updated._id, title: updated.title, status: updated.status })
  return updated
}

// ── Agency ──────────────────────────────────────────────────────────────────

async function load(req: Request, id: unknown, need: 'read' | 'write' = 'read') {
  const r = await RequestModel.findOne({ ...(await scopeFilter(req, { softDelete: true, agencyLevel: false })), _id: objectId(id, 'Request not found.') }).lean()
  if (!r) throw notFound('Request not found.')
  if (need === 'write') await loadClient(req, r.client, 'write')
  return r as RequestDoc
}

const listSchema = z.object({ ...pageQuery, client: z.string().optional(), status: csvEnum(REQUEST_STATUSES), overdue: z.stringbool().optional() })

requestsRouter.get('/', async (req, res) => {
  const f = listSchema.parse(req.query)
  const filter: Record<string, unknown> = await scopeFilter(req, { softDelete: true, agencyLevel: false })
  if (f.client) filter.$and = [{ client: objectId(f.client) }]
  filter.status = f.status.length ? { $in: f.status } : { $in: ['draft', 'open', 'submitted'] }
  if (f.q) filter.title = new RegExp(escapeRegex(f.q), 'i')
  const page = await paginate(RequestModel, filter, { page: f.page, pageSize: f.pageSize, sort: { due: 1, createdAt: -1 } })
  const today = await timezones(page.items.map((r) => r.client))
  let items = page.items.map((r) => ({ ...r, overdue: isOverdue(r, today.get(String(r.client))!) }))
  if (f.overdue !== undefined) items = items.filter((r) => r.overdue === f.overdue)
  res.json({ ...page, items })
})

const fieldsSchema = z.object({
  title: z.string().trim().min(1, 'Say what you need').max(200),
  description: z.string().max(5000).optional(),
  why: z.string().max(2000).optional(),
  due: z.union([dateOnlySchema, z.literal('')]).optional(),
  priority: z.enum(PRIORITIES).optional(),
  uploadCategory: z.enum(FILE_CATEGORIES).optional(),
  campaign: z.string().nullable().optional(),
  content: z.string().nullable().optional(),
})

async function links(client: Types.ObjectId, input: { campaign?: string | null; content?: string | null }) {
  const out: Record<string, unknown> = {}
  if (input.campaign !== undefined) {
    out.campaign = input.campaign ? (await CampaignModel.findOne({ _id: objectId(input.campaign), client, deletedAt: null }, { _id: 1 }).lean())?._id : null
    if (out.campaign === undefined) throw invalid('campaign', 'Pick a campaign of this client')
  }
  if (input.content !== undefined) {
    out.content = input.content ? (await ContentModel.findOne({ _id: objectId(input.content), client, deletedAt: null }, { _id: 1 }).lean())?._id : null
    if (out.content === undefined) throw invalid('content', 'Pick content of this client')
  }
  return out
}

async function announce(req: Request, r: RequestDoc) {
  const e = await logActivity(req, {
    action: 'request.opened',
    message: `${req.agencyAuth!.user.name} asked for: ${r.title}`,
    agency: r.agency,
    client: r.client,
    visibility: 'client',
    target: { type: 'request', id: r._id, label: r.title },
  })
  // D68: a new request is urgent.
  await notify({
    recipients: await clientPeople(r.client, ['admin', 'approver', 'contributor']),
    audience: 'client',
    agency: r.agency,
    client: r.client,
    category: 'requests',
    event: 'request.opened',
    title: `Needed from you: ${r.title}`,
    body: r.due ? `Due ${r.due}.` : '',
    entity: { type: 'request', id: r._id },
    link: reqLink(r, 'client'),
    urgent: true,
    activity: e?._id,
  })
}

requestsRouter.post('/', idempotent(), async (req, res) => {
  const input = fieldsSchema.extend({ client: z.string(), template: z.string().optional(), draft: z.boolean().default(false) }).parse(req.body)
  const auth = req.agencyAuth!
  const client = await loadClient(req, objectId(input.client, 'Client not found.'), 'write')
  const fromTemplate = input.template ? await loadTemplate(auth.agency._id, objectId(input.template, 'Template not found.'), 'request') : null
  const { dueOffsetDays, ...tpl } = fromTemplate?.body ?? ({} as Record<string, any>)
  const r = await RequestModel.create({
    ...tpl,
    ...Object.fromEntries(Object.entries(input).filter(([k, v]) => v !== undefined && !['client', 'template', 'draft', 'campaign', 'content'].includes(k))),
    ...(await links(client._id, input)),
    due: input.due ?? (dueOffsetDays !== undefined ? addDays(todayIn(client.timezone), dueOffsetDays) : ''),
    agency: auth.agency._id,
    client: client._id,
    template: fromTemplate?._id ?? null,
    source: fromTemplate ? 'template' : 'manual',
    status: input.draft ? 'draft' : 'open',
    createdBy: auth.user._id,
    updatedBy: { id: auth.user._id, name: auth.user.name },
  })
  if (r.status === 'open') await announce(req, r.toObject() as RequestDoc)
  res.status(201).json({ request: r })
})

requestsRouter.get('/:id', async (req, res) => {
  const r = await load(req, req.params.id)
  const files = await FileModel.find({ _id: { $in: r.files.map((f) => f.file) } }, { name: 1, mimeType: 1, size: 1, status: 1, category: 1 }).lean()
  const today = (await timezones([r.client])).get(String(r.client))!
  res.json({ request: { ...r, overdue: isOverdue(r, today), files: r.files.map((f) => ({ ...f, info: files.find((x) => String(x._id) === String(f.file)) })) } })
})

const EDITABLE = ['title', 'description', 'why', 'due', 'priority', 'uploadCategory', 'campaign', 'content'] as const

requestsRouter.patch('/:id', async (req, res) => {
  const { rev, campaign, content, ...rest } = fieldsSchema.partial().extend({ rev: z.number().int().min(1) }).parse(req.body)
  const r = await load(req, req.params.id, 'write')
  if (!['draft', 'open'].includes(r.status)) throw new AppError(409, 'invalid_state', `This request is ${r.status}, so it can’t be edited.`)
  const set = { ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)), ...(await links(r.client, { campaign, content })) }
  const updated = await updateWithRev(RequestModel, { _id: r._id, agency: r.agency }, rev, set, req.agencyAuth!.user)
  const changes = diff(r, updated.toObject(), [...EDITABLE])
  if (changes) {
    await logActivity(req, {
      action: 'request.updated',
      message: `${req.agencyAuth!.user.name} updated the request ${updated.title}`,
      agency: r.agency,
      client: r.client,
      visibility: r.status === 'draft' ? 'internal' : 'client',
      target: { type: 'request', id: r._id, label: updated.title },
      ...changes,
    })
  }
  res.json({ request: updated })
})

const noteSchema = z.object({ note: z.string().trim().max(2000).default('') })

requestsRouter.post('/:id/:action', async (req, res, next) => {
  const action = req.params.action
  if (!['publish', 'complete', 'reopen', 'cancel'].includes(action)) return next()
  const { note } = noteSchema.parse(req.body ?? {})
  const r = await load(req, req.params.id, 'write')
  const me = req.agencyAuth!.user
  if (action === 'reopen' && !note) throw invalid('note', 'Tell the client what else you need')

  const updated = await move(req, r, REQUEST_TRANSITIONS[action as keyof typeof REQUEST_TRANSITIONS], {
    ...(action === 'complete' ? { completedAt: new Date() } : {}),
    ...(action === 'reopen' ? { returnNote: note } : {}),
  })
  if (action === 'publish') {
    await announce(req, updated.toObject() as RequestDoc)
  } else {
    const verb = { complete: 'marked done', reopen: 'needs something else for', cancel: 'cancelled' }[action]
    const e = await logActivity(req, {
      action: `request.${action === 'reopen' ? 'reopened' : action === 'complete' ? 'completed' : 'cancelled'}`,
      message: `${me.name} ${verb} the request ${r.title}${note ? `: ${note}` : ''}`,
      agency: r.agency,
      client: r.client,
      visibility: r.status === 'draft' ? 'internal' : 'client',
      target: { type: 'request', id: r._id, label: r.title },
    })
    if (r.status !== 'draft') {
      await notify({
        recipients: await clientPeople(r.client, ['admin', 'approver', 'contributor']),
        audience: 'client',
        agency: r.agency,
        client: r.client,
        category: 'requests',
        event: e?.action ?? 'request.updated',
        title: action === 'reopen' ? `We need something else: ${r.title}` : action === 'complete' ? `Done: ${r.title}` : `Request cancelled: ${r.title}`,
        body: note,
        entity: { type: 'request', id: r._id },
        link: reqLink(r, 'client'),
        urgent: action === 'reopen',
        activity: e?._id,
      })
    }
  }
  res.json({ request: updated })
})

// ── Client (F53–F56) ─────────────────────────────────────────────────────────

async function loadForClient(req: Request, id: unknown) {
  const r = await RequestModel.findOne({ ...(await scopeFilter(req, { softDelete: true })), _id: objectId(id, 'Request not found.'), status: { $ne: 'draft' } }).lean()
  if (!r) throw notFound('Request not found.')
  return r as RequestDoc
}

const presentForClient = async (r: RequestDoc, today: string) => {
  const files = await FileModel.find({ _id: { $in: r.files.map((f) => f.file) }, deletedAt: null }, { name: 1, mimeType: 1, size: 1, status: 1 }).lean()
  return {
    id: r._id,
    title: r.title,
    description: r.description,
    why: r.why,
    due: r.due,
    priority: r.priority,
    status: r.status,
    label: CLIENT_LABEL[r.status as RequestStatus],
    overdue: isOverdue(r, today),
    returnNote: r.status === 'open' ? r.returnNote : '',
    response: r.response,
    submittedAt: r.submittedAt,
    files: r.files.map((f) => ({ ...files.find((x) => String(x._id) === String(f.file)), id: f.file, addedAt: f.addedAt, locked: !!f.submittedAt })),
  }
}

clientRequestsRouter.get('/', async (req, res) => {
  const f = z.object({ status: csvEnum(['open', 'submitted', 'completed'] as const) }).parse(req.query)
  const filter: Record<string, unknown> = { ...(await scopeFilter(req, { softDelete: true })), status: { $in: f.status.length ? f.status : ['open', 'submitted', 'completed'] } }
  const items = await RequestModel.find(filter).sort({ status: 1, due: 1 }).limit(200).lean()
  const today = todayIn(req.clientAuth!.client.timezone)
  res.json({ items: await Promise.all(items.map((r) => presentForClient(r as RequestDoc, today))) })
})

/** Opening it records `viewedAt` (a timestamp, not a state, D35). */
clientRequestsRouter.get('/:id', async (req, res) => {
  const r = await loadForClient(req, req.params.id)
  if (!r.viewedAt) await RequestModel.updateOne({ _id: r._id, viewedAt: null }, { $set: { viewedAt: new Date() } })
  res.json({ request: await presentForClient(r, todayIn(req.clientAuth!.client.timezone)) })
})

function assertCanUpload(req: Request) {
  if (!clientCan(req.clientAuth!.role, 'upload')) throw forbidden('Your role can view but not upload.')
}

const attachSchema = z.object({ file: z.string() })

/**
 * Attaches a file the client uploaded (purpose `request`) to the request. It joins the resource library under
 * the request's category, shared with the agency (D36).
 */
clientRequestsRouter.post('/:id/files', async (req, res) => {
  assertCanUpload(req)
  const r = await loadForClient(req, req.params.id)
  if (r.status !== 'open') throw new AppError(409, 'invalid_state', 'Files can be added only while the request is open.')
  const auth = req.clientAuth!
  const file = await FileModel.findOneAndUpdate(
    { _id: objectId(attachSchema.parse(req.body).file, 'File not found.'), client: r.client, purpose: 'request', 'uploadedBy.id': auth.user._id, deletedAt: null, status: { $ne: 'failed' } },
    { $set: { category: r.uploadCategory, visibility: 'client' }, $addToSet: { usedIn: { type: 'request', id: r._id } } },
    { returnDocument: 'after' },
  )
  if (!file) throw notFound('File not found.')
  await RequestModel.updateOne(
    { _id: r._id, status: 'open', 'files.file': { $ne: file._id } },
    { $push: { files: { file: file._id, addedBy: { id: auth.user._id, name: auth.user.name }, addedAt: new Date() } } },
  )
  res.status(201).json({ request: await presentForClient((await RequestModel.findById(r._id).lean()) as RequestDoc, todayIn(auth.client.timezone)) })
})

/** Only files not yet submitted can be removed; submitted ones may already be in use (§6.6). */
clientRequestsRouter.delete('/:id/files/:fileId', async (req, res) => {
  assertCanUpload(req)
  const r = await loadForClient(req, req.params.id)
  const fileId = objectId(req.params.fileId, 'File not found.')
  const entry = r.files.find((f) => String(f.file) === String(fileId))
  if (!entry) throw notFound('File not found.')
  if (entry.submittedAt) throw new AppError(409, 'file_locked', 'This file was already submitted, so it can’t be removed.')
  await RequestModel.updateOne({ _id: r._id }, { $pull: { files: { file: fileId, submittedAt: null } } })
  await FileModel.updateOne({ _id: fileId }, { $pull: { usedIn: { type: 'request', id: r._id } } })
  res.status(204).end()
})

const submitSchema = z.object({ response: z.string().trim().max(5000).default('') })

clientRequestsRouter.post('/:id/submit', idempotent(), async (req, res) => {
  assertCanUpload(req)
  const { response } = submitSchema.parse(req.body ?? {})
  const r = await loadForClient(req, req.params.id)
  const auth = req.clientAuth!
  if (!r.files.length && !response) throw invalid('response', 'Add a file or a reply')
  const now = new Date()
  await move(req, r, REQUEST_TRANSITIONS.submit, { submittedAt: now, submittedBy: { id: auth.user._id, name: auth.user.name }, response })
  await RequestModel.updateOne({ _id: r._id }, { $set: { 'files.$[f].submittedAt': now } }, { arrayFilters: [{ 'f.submittedAt': null }] })

  const client = await ClientModel.findById(r.client, { accountManager: 1 }).lean()
  const e = await logActivity(req, {
    action: 'request.submitted',
    message: `${auth.user.name} submitted ${r.title}`,
    agency: r.agency,
    client: r.client,
    visibility: 'client',
    target: { type: 'request', id: r._id, label: r.title },
  })
  await notify({
    recipients: [r.createdBy, client?.accountManager].filter(Boolean) as Types.ObjectId[],
    audience: 'agency',
    agency: r.agency,
    client: r.client,
    category: 'requests',
    event: 'request.submitted',
    title: `${auth.user.name} submitted “${r.title}”`,
    body: `${r.files.length} file${r.files.length === 1 ? '' : 's'}${response ? ' and a reply' : ''}.`,
    entity: { type: 'request', id: r._id },
    link: reqLink(r, 'agency'),
    activity: e?._id,
  })
  res.json({ request: await presentForClient((await RequestModel.findById(r._id).lean()) as RequestDoc, todayIn(auth.client.timezone)) })
})
