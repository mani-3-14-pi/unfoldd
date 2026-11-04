import { Router, type Request } from 'express'
import type { PipelineStage, Types } from 'mongoose'
import { z } from 'zod'
import { diff, logActivity } from '../../lib/activity.ts'
import { updateWithRev } from '../../lib/concurrency.ts'
import { objectId } from '../../lib/ids.ts'
import { notify } from '../../lib/notify.ts'
import { csvEnum, escapeRegex, pageQuery, paginateAggregate } from '../../lib/pagination.ts'
import { isManagerPlus, loadClient, scopeFilter } from '../../lib/scope.ts'
import { dateOnlySchema } from '../../lib/time.ts'
import { idempotent } from '../../middleware/idempotency.ts'
import { forbidden, invalid, notFound } from '../../utils/AppError.ts'
import { AgencyAccessModel } from '../clients/agencyAccess.model.ts'
import { ContentModel, PRIORITIES } from '../content/content.model.ts'
import { MessageModel } from '../feedback/message.model.ts'
import { ThreadModel } from '../feedback/thread.model.ts'
import { FileModel } from '../files/file.model.ts'
import { MembershipModel } from '../users/membership.model.ts'
import { TASK_STATUSES, TaskModel } from './task.model.ts'
import { moveTask, setDependencies, type TaskDoc } from './task.service.ts'

/** Agency tasks and the board (P85–P89, D37, D38). Agency-only. */
export const tasksRouter = Router()

async function loadTask(req: Request, id: unknown, need: 'read' | 'write' = 'read') {
  const task = await TaskModel.findOne({ ...(await scopeFilter(req, { softDelete: true, agencyLevel: false })), _id: objectId(id, 'Task not found.') }).lean()
  if (!task) throw notFound('Task not found.')
  if (need === 'write') await loadClient(req, task.client, 'write')
  return task as TaskDoc
}

/** Owners and collaborators must be on the team with access to the client. */
async function people(req: Request, client: Types.ObjectId, ids: string[], field: string) {
  const oids = ids.map((id) => objectId(id))
  const [members, access] = await Promise.all([
    MembershipModel.find({ agency: req.agencyAuth!.agency._id, user: { $in: oids }, status: 'active' }, { user: 1, role: 1 }).lean(),
    AgencyAccessModel.find({ client, user: { $in: oids } }, { user: 1 }).lean(),
  ])
  const assigned = new Set(access.map((a) => String(a.user)))
  if (members.filter((m) => m.role === 'owner' || m.role === 'admin' || assigned.has(String(m.user))).length !== new Set(ids).size) {
    throw invalid(field, 'Pick someone with access to this client')
  }
  return oids
}

async function attachments(task: { agency: Types.ObjectId; client: Types.ObjectId }, ids: string[]) {
  const oids = ids.map((id) => objectId(id, 'File not found.'))
  if ((await FileModel.countDocuments({ _id: { $in: oids }, agency: task.agency, client: task.client, deletedAt: null })) !== oids.length) {
    throw invalid('attachments', 'Upload the files first')
  }
  return oids
}

const blockedView = (t: { blocked?: { manual?: boolean; byDependency?: boolean; reason?: string } | null }) => ({
  isBlocked: !!(t.blocked?.manual || t.blocked?.byDependency),
  ...t.blocked,
})

// ── Board and list ───────────────────────────────────────────────────────────

const listSchema = z.object({
  ...pageQuery,
  client: z.string().optional(),
  content: z.string().optional(),
  status: csvEnum(TASK_STATUSES),
  owner: z.string().optional(),
  mine: z.stringbool().optional(),
  blocked: z.stringbool().optional(),
  view: z.enum(['list', 'board']).default('list'),
})

tasksRouter.get('/', async (req, res) => {
  const f = listSchema.parse(req.query)
  const match: Record<string, unknown> = await scopeFilter(req, { softDelete: true, agencyLevel: false })
  const and: Record<string, unknown>[] = []
  if (f.client) and.push({ client: objectId(f.client) })
  if (f.content) match.content = objectId(f.content)
  if (f.owner) match.owner = objectId(f.owner)
  if (f.mine) and.push({ $or: [{ owner: req.agencyAuth!.user._id }, { collaborators: req.agencyAuth!.user._id }] })
  if (f.blocked !== undefined) and.push(f.blocked ? { $or: [{ 'blocked.manual': true }, { 'blocked.byDependency': true }] } : { 'blocked.manual': false, 'blocked.byDependency': false })
  if (f.q) and.push({ title: new RegExp(escapeRegex(f.q), 'i') })
  if (and.length) match.$and = and
  const lookups: PipelineStage[] = [
    { $lookup: { from: 'users', localField: 'owner', foreignField: '_id', as: 'ownerInfo', pipeline: [{ $project: { name: 1 } }] } },
    { $lookup: { from: 'clients', localField: 'client', foreignField: '_id', as: 'clientInfo', pipeline: [{ $project: { brandName: 1 } }] } },
    { $set: { ownerInfo: { $first: '$ownerInfo' }, clientInfo: { $first: '$clientInfo' } } },
  ]

  if (f.view === 'board') {
    // Columns: the four working statuses (cancelled only when asked for), each in board order.
    const statuses = f.status.length ? f.status : TASK_STATUSES.filter((s) => s !== 'cancelled')
    const rows = await TaskModel.aggregate([{ $match: { ...match, status: { $in: statuses } } }, ...lookups, { $sort: { position: 1, createdAt: 1 } }, { $limit: 1000 }])
    res.json({ columns: statuses.map((s) => ({ status: s, items: rows.filter((r) => r.status === s).map((r) => ({ ...r, blocked: blockedView(r) })) })) })
    return
  }
  if (f.status.length) match.status = { $in: f.status }
  else match.status = { $ne: 'cancelled' }
  const page = await paginateAggregate<any>(TaskModel, [{ $match: match }, ...lookups], { page: f.page, pageSize: f.pageSize, sort: { due: 1, createdAt: -1 } })
  res.json({ ...page, items: page.items.map((t) => ({ ...t, blocked: blockedView(t) })) })
})

// ── CRUD ───────────────────────────────────────────────────────────────────

const fieldsSchema = z.object({
  title: z.string().trim().min(1, 'Give it a title').max(200),
  description: z.string().max(20_000).optional(),
  owner: z.string().nullable().optional(),
  collaborators: z.array(z.string()).max(20).optional(),
  due: z.union([dateOnlySchema, z.literal('')]).optional(),
  priority: z.enum(PRIORITIES).optional(),
  attachments: z.array(z.string()).max(20).optional(),
})

tasksRouter.post('/', idempotent(), async (req, res) => {
  const input = fieldsSchema.extend({ client: z.string(), content: z.string().optional() }).parse(req.body)
  const auth = req.agencyAuth!
  const client = await loadClient(req, objectId(input.client, 'Client not found.'), 'write')
  let content: Types.ObjectId | null = null
  if (input.content) {
    const c = await ContentModel.findOne({ _id: objectId(input.content, 'Content not found.'), client: client._id, deletedAt: null }, { _id: 1 }).lean()
    if (!c) throw invalid('content', 'Pick content from this client')
    content = c._id
  }
  const base = { agency: auth.agency._id, client: client._id }
  const last = await TaskModel.findOne({ ...base, status: 'todo' }, { position: 1 }).sort({ position: -1 }).lean()
  const task = await TaskModel.create({
    ...base,
    content,
    title: input.title,
    description: input.description ?? '',
    owner: input.owner === undefined ? auth.user._id : input.owner ? (await people(req, client._id, [input.owner], 'owner'))[0] : null,
    collaborators: input.collaborators ? await people(req, client._id, input.collaborators, 'collaborators') : [],
    due: input.due ?? '',
    priority: input.priority ?? 'normal',
    attachments: input.attachments ? await attachments(base, input.attachments) : [],
    position: (last?.position ?? 0) + 1,
    createdBy: auth.user._id,
    updatedBy: { id: auth.user._id, name: auth.user.name },
  })
  await logActivity(req, {
    action: 'task.created',
    message: `${auth.user.name} created the task ${task.title}`,
    agency: auth.agency._id,
    client: client._id,
    target: { type: 'task', id: task._id, label: task.title },
  })
  if (task.owner && String(task.owner) !== String(auth.user._id)) {
    await notify({
      recipients: [task.owner],
      audience: 'agency',
      agency: auth.agency._id,
      client: client._id,
      category: 'team',
      event: 'task.assigned',
      title: `${auth.user.name} assigned you “${task.title}”`,
      entity: { type: 'task', id: task._id },
      link: `/app/tasks/${task._id}`,
    })
  }
  res.status(201).json({ task: { ...task.toObject(), blocked: blockedView(task) } })
})

tasksRouter.get('/:id', async (req, res) => {
  const task = await loadTask(req, req.params.id)
  const [deps, dependents] = await Promise.all([
    TaskModel.find({ _id: { $in: task.dependencies.filter((d) => d.type === 'task').map((d) => d.id) } }, { title: 1, status: 1, owner: 1 }).lean(),
    TaskModel.find({ 'dependencies.id': task._id, deletedAt: null }, { title: 1, status: 1, owner: 1 }).lean(),
  ])
  res.json({ task: { ...task, blocked: blockedView(task), dependencyTasks: deps, dependents } })
})

const EDITABLE = ['title', 'description', 'owner', 'collaborators', 'due', 'priority', 'attachments', 'blocked'] as const

const patchSchema = fieldsSchema.partial().extend({
  rev: z.number().int().min(1),
  /** Manual block with a reason (D37). */
  blocked: z.object({ manual: z.boolean(), reason: z.string().trim().max(500).default('') }).optional(),
})

tasksRouter.patch('/:id', async (req, res) => {
  const { rev, owner, collaborators, attachments: files, blocked, ...rest } = patchSchema.parse(req.body)
  const task = await loadTask(req, req.params.id, 'write')
  const set: Record<string, unknown> = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined))
  if (owner !== undefined) set.owner = owner ? (await people(req, task.client, [owner], 'owner'))[0] : null
  if (collaborators !== undefined) set.collaborators = await people(req, task.client, collaborators, 'collaborators')
  if (files !== undefined) set.attachments = await attachments(task, files)
  if (blocked) {
    if (blocked.manual && !blocked.reason) throw invalid('blocked', 'Say why it’s blocked')
    set['blocked.manual'] = blocked.manual
    set['blocked.reason'] = blocked.manual ? blocked.reason : ''
  }
  const updated = await updateWithRev(TaskModel, { _id: task._id, agency: task.agency }, rev, set, req.agencyAuth!.user)
  const changes = diff(task, updated.toObject(), [...EDITABLE])
  if (changes) {
    await logActivity(req, {
      action: 'task.updated',
      message: `${req.agencyAuth!.user.name} updated ${updated.title}`,
      agency: task.agency,
      client: task.client,
      target: { type: 'task', id: task._id, label: updated.title },
      ...changes,
    })
  }
  if (set.owner && String(set.owner) !== String(task.owner) && String(set.owner) !== String(req.agencyAuth!.user._id)) {
    await notify({
      recipients: [set.owner as Types.ObjectId],
      audience: 'agency',
      agency: task.agency,
      client: task.client,
      category: 'team',
      event: 'task.assigned',
      title: `${req.agencyAuth!.user.name} assigned you “${updated.title}”`,
      entity: { type: 'task', id: task._id },
      link: `/app/tasks/${task._id}`,
    })
  }
  res.json({ task: { ...updated.toObject(), blocked: blockedView(updated) } })
})

const moveSchema = z.object({
  status: z.enum(TASK_STATUSES),
  /** The column the card was in when it was picked up. */
  expectedStatus: z.enum(TASK_STATUSES).optional(),
  position: z.number().optional(),
})

tasksRouter.post('/:id/move', async (req, res) => {
  const input = moveSchema.parse(req.body)
  const task = await loadTask(req, req.params.id, 'write')
  const moved = await moveTask(req, task, input.status, input)
  res.json({ task: { ...moved, blocked: blockedView(moved) } })
})

const depsSchema = z.object({ dependencies: z.array(z.object({ type: z.enum(['task', 'request']), id: z.string() })).max(50) })

tasksRouter.put('/:id/dependencies', async (req, res) => {
  const { dependencies } = depsSchema.parse(req.body)
  const task = await loadTask(req, req.params.id, 'write')
  const updated = await setDependencies(req, task, dependencies.map((d) => ({ type: d.type, id: objectId(d.id, 'Task not found.') })))
  res.json({ task: { ...updated.toObject(), blocked: blockedView(updated) } })
})

/** Soft delete (D61). Manager+, the owner or the creator. */
tasksRouter.delete('/:id', async (req, res) => {
  const task = await loadTask(req, req.params.id, 'write')
  const me = req.agencyAuth!
  if (!isManagerPlus(me.role) && ![String(task.owner), String(task.createdBy)].includes(String(me.user._id))) throw forbidden()
  await TaskModel.updateOne({ _id: task._id }, { $set: { deletedAt: new Date(), deletedBy: me.user._id } })
  await logActivity(req, {
    action: 'task.deleted',
    message: `${me.user.name} deleted the task ${task.title}`,
    agency: task.agency,
    client: task.client,
    target: { type: 'task', id: task._id, label: task.title },
  })
  res.status(204).end()
})

// ── Comments: one internal discussion thread per task ─────────────────────────

async function taskThread(task: TaskDoc, create: boolean, author?: { _id: Types.ObjectId; name: string }) {
  const existing = await ThreadModel.findOne({ 'context.type': 'task', 'context.id': task._id }).lean()
  if (existing || !create) return existing
  return (
    await ThreadModel.findOneAndUpdate(
      { 'context.type': 'task', 'context.id': task._id },
      {
        $setOnInsert: {
          agency: task.agency,
          client: task.client,
          context: { type: 'task', id: task._id },
          kind: 'discussion',
          visibility: 'internal',
          author: { id: author!._id, name: author!.name, side: 'agency' },
          submittedAt: new Date(),
        },
      },
      { upsert: true, returnDocument: 'after' },
    )
  ).toObject()
}

tasksRouter.get('/:id/comments', async (req, res) => {
  const task = await loadTask(req, req.params.id)
  const thread = await taskThread(task, false)
  res.json({ items: thread ? await MessageModel.find({ thread: thread._id, deletedAt: null }).sort({ createdAt: 1 }).lean() : [] })
})

const commentSchema = z.object({ body: z.string().trim().min(1, 'Write a comment').max(5000), mentions: z.array(z.string()).max(20).default([]) })

tasksRouter.post('/:id/comments', async (req, res) => {
  const input = commentSchema.parse(req.body)
  const task = await loadTask(req, req.params.id, 'write')
  const me = req.agencyAuth!.user
  const thread = await taskThread(task, true, me)
  const mentions = input.mentions.length ? await people(req, task.client, input.mentions, 'mentions') : []
  const now = new Date()
  const message = await MessageModel.create({
    agency: task.agency,
    client: task.client,
    thread: thread!._id,
    visibility: 'internal',
    author: { id: me._id, name: me.name, side: 'agency' },
    body: input.body,
    mentions,
    submittedAt: now,
  })
  await ThreadModel.updateOne({ _id: thread!._id }, { $inc: { messageCount: 1 }, $set: { lastMessageAt: now } })
  const recipients = [task.owner, ...task.collaborators, ...mentions].filter(Boolean) as Types.ObjectId[]
  await notify({
    recipients,
    audience: 'agency',
    agency: task.agency,
    client: task.client,
    category: 'team',
    event: 'task.commented',
    title: `${me.name} commented on “${task.title}”`,
    body: input.body.slice(0, 200),
    entity: { type: 'task', id: task._id },
    link: `/app/tasks/${task._id}`,
    except: me._id,
  })
  res.status(201).json({ message })
})
