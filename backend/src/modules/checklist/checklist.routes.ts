import { Router, type Request } from 'express'
import type { Types } from 'mongoose'
import { z } from 'zod'
import { logActivity } from '../../lib/activity.ts'
import { checklistProvider } from '../../lib/ai.ts'
import { objectId } from '../../lib/ids.ts'
import { AppError, invalid, notFound } from '../../utils/AppError.ts'
import { loadContent } from '../content/content.routes.ts'
import type { ContentDoc } from '../content/content.service.ts'
import { VersionModel } from '../content/version.model.ts'
import { MessageModel } from '../feedback/message.model.ts'
import { ThreadModel } from '../feedback/thread.model.ts'
import { taskFromChecklistItem, taskFromThread } from '../tasks/task.service.ts'
import { ChecklistItemModel, ChecklistRunModel } from './checklist.model.ts'
import { queueChecklist, withDone } from './checklist.service.ts'

/**
 * Agency side of the revision engine (Flow 7), mounted under /content: the AI checklist (review suggestions,
 * accept / edit / remove / add) and converting feedback or checklist items into tasks.
 */
export const checklistRouter = Router()

async function versionOf(content: ContentDoc, id?: unknown) {
  const versionId = id ? objectId(id, 'Version not found.') : content.currentVersion
  if (!versionId) throw new AppError(409, 'no_version', 'Upload a version first.')
  const version = await VersionModel.findOne({ _id: versionId, content: content._id }, { number: 1 }).lean()
  if (!version) throw notFound('Version not found.')
  return version
}

/** The version whose feedback the checklist is about: the latest one the client requested changes on, by default. */
checklistRouter.get('/:id/checklist', async (req, res) => {
  const content = await loadContent(req, req.params.id)
  const version = await versionOf(content, req.query.version)
  const [items, run] = await Promise.all([
    ChecklistItemModel.find({ version: version._id, status: { $ne: 'removed' } }).sort({ status: 1, order: 1, createdAt: 1 }).lean(),
    ChecklistRunModel.findOne({ version: version._id }).sort({ createdAt: -1 }).lean(),
  ])
  res.json({
    version: { id: version._id, number: version.number },
    ai: {
      enabled: !!checklistProvider(),
      run: run ? { status: run.status, error: run.error || undefined, suggestions: run.suggestions, finishedAt: run.finishedAt, model: run.model } : null,
    },
    items: await withDone(items),
  })
})

/** Run (or re-run) the AI over the version's open client feedback. Retry after a failure (D21). */
checklistRouter.post('/:id/checklist/run', async (req, res) => {
  const content = await loadContent(req, req.params.id, 'write')
  const version = await versionOf(content, req.body?.versionId)
  if (!checklistProvider()) throw new AppError(409, 'ai_disabled', 'AI is switched off for this workspace.')
  const run = await queueChecklist(content, version._id, req.agencyAuth!.user)
  res.status(202).json({ run })
})

async function threadsOnVersion(content: ContentDoc, versionId: Types.ObjectId, ids: string[]) {
  const oids = ids.map((id) => objectId(id, 'Comment not found.'))
  const found = await ThreadModel.countDocuments({ _id: { $in: oids }, content: content._id, version: versionId, kind: 'feedback' })
  if (found !== oids.length) throw invalid('sourceThreads', 'Pick feedback on this version')
  return oids
}

const addSchema = z.object({ versionId: z.string().optional(), text: z.string().trim().min(1).max(1000), sourceThreads: z.array(z.string()).max(50).default([]) })

/** A person adds an item themselves: accepted straight away. */
checklistRouter.post('/:id/checklist/items', async (req, res) => {
  const input = addSchema.parse(req.body)
  const content = await loadContent(req, req.params.id, 'write')
  const version = await versionOf(content, input.versionId)
  const me = req.agencyAuth!.user
  const last = await ChecklistItemModel.findOne({ version: version._id }, { order: 1 }).sort({ order: -1 }).lean()
  const item = await ChecklistItemModel.create({
    agency: content.agency,
    client: content.client,
    content: content._id,
    version: version._id,
    versionNumber: version.number,
    text: input.text,
    sourceThreads: await threadsOnVersion(content, version._id, input.sourceThreads),
    origin: 'human',
    status: 'accepted',
    order: (last?.order ?? 0) + 1,
    decidedBy: { id: me._id, name: me.name },
    decidedAt: new Date(),
  })
  await logActivity(req, {
    action: 'checklist.item_added',
    message: `${me.name} added “${item.text}” to the revision checklist of ${content.title}`,
    agency: content.agency,
    client: content.client,
    visibility: 'client',
    target: { type: 'content', id: content._id, label: content.title },
  })
  res.status(201).json({ item })
})

async function loadItem(req: Request, content: ContentDoc) {
  const item = await ChecklistItemModel.findOne({ _id: objectId(req.params.itemId, 'Checklist item not found.'), content: content._id })
  if (!item) throw notFound('Checklist item not found.')
  return item
}

const updateSchema = z.object({
  text: z.string().trim().min(1).max(1000).optional(),
  status: z.enum(['accepted', 'removed', 'suggested']).optional(),
  sourceThreads: z.array(z.string()).max(50).optional(),
})

/** Accept / edit / remove (Flow 7, step 3). Every decision is logged, with the AI's wording when it was edited. */
checklistRouter.patch('/:id/checklist/items/:itemId', async (req, res) => {
  const input = updateSchema.parse(req.body)
  const content = await loadContent(req, req.params.id, 'write')
  const item = await loadItem(req, content)
  const me = req.agencyAuth!.user
  const before = { text: item.text, status: item.status }
  if (input.text !== undefined) item.text = input.text
  if (input.sourceThreads) item.sourceThreads = await threadsOnVersion(content, item.version, input.sourceThreads)
  if (input.status && input.status !== item.status) {
    if (item.task && input.status !== 'accepted') throw new AppError(409, 'has_task', 'This item already has a task. Cancel the task instead.')
    item.status = input.status
    item.decidedBy = { id: me._id, name: me.name }
    item.decidedAt = new Date()
  }
  await item.save()
  if (before.status !== item.status || before.text !== item.text) {
    await logActivity(req, {
      action: `checklist.item_${item.status === before.status ? 'edited' : item.status}`,
      message: `${me.name} ${item.status === 'accepted' && before.status !== 'accepted' ? 'accepted' : item.status === 'removed' ? 'removed' : 'edited'} “${item.text}” on ${content.title}`,
      agency: content.agency,
      client: content.client,
      // Only accepted items are ever shown to the client.
      visibility: item.status === 'accepted' ? 'client' : 'internal',
      target: { type: 'content', id: content._id, label: content.title },
      before,
      after: { text: item.text, status: item.status },
      meta: item.origin === 'ai' ? { suggestedText: item.suggestedText } : undefined,
    })
  }
  res.json({ item })
})

const taskSchema = z.object({ owner: z.string().nullable().optional(), title: z.string().trim().min(1).max(200).optional() })

const taskBase = (req: Request, content: ContentDoc, title: string, description: string) => ({
  agency: content.agency,
  client: content.client,
  content: content._id,
  title,
  description,
  owner: content.owner ?? req.agencyAuth!.user._id,
  createdBy: req.agencyAuth!.user._id,
})

/** Convert to task (P62/P75). One accepted item makes at most one task; a repeat returns the same task. */
checklistRouter.post('/:id/checklist/items/:itemId/task', async (req, res) => {
  const input = taskSchema.parse(req.body ?? {})
  const content = await loadContent(req, req.params.id, 'write')
  const item = await loadItem(req, content)
  if (item.status !== 'accepted') throw new AppError(409, 'not_accepted', 'Accept the item before turning it into a task.')
  const { task, created } = await taskFromChecklistItem(req, taskBase(req, content, input.title ?? item.text, `From the revision checklist of ${content.title}.`), item)
  res.status(created ? 201 : 200).json({ task })
})

/** Turn a feedback item straight into a task. Idempotent: one task per feedback item. */
checklistRouter.post('/:id/threads/:threadId/task', async (req, res) => {
  const input = taskSchema.parse(req.body ?? {})
  const content = await loadContent(req, req.params.id, 'write')
  const thread = await ThreadModel.findOne({ _id: objectId(req.params.threadId, 'Comment not found.'), content: content._id, kind: 'feedback', submittedAt: { $ne: null }, deletedAt: null }).lean()
  if (!thread) throw notFound('Comment not found.')
  const first = await MessageModel.findOne({ thread: thread._id }).sort({ createdAt: 1 }).lean()
  const title = input.title ?? (first?.body ? first.body.slice(0, 120) : `Feedback #${thread.pin} on ${content.title}`)
  const { task, created } = await taskFromThread(req, taskBase(req, content, title, first?.body ?? ''), thread)
  res.status(created ? 201 : 200).json({ task })
})
