import { Router, type Request } from 'express'
import type { PipelineStage, Types } from 'mongoose'
import { z } from 'zod'
import { logActivity } from '../../lib/activity.ts'
import { objectId } from '../../lib/ids.ts'
import { notify } from '../../lib/notify.ts'
import { csvEnum, pageQuery, paginateAggregate } from '../../lib/pagination.ts'
import { scopeFilter } from '../../lib/scope.ts'
import { AppError, invalid, notFound } from '../../utils/AppError.ts'
import { AgencyAccessModel } from '../clients/agencyAccess.model.ts'
import { contentTeam, clientPeople } from '../content/content.recipients.ts'
import { loadContent } from '../content/content.routes.ts'
import type { ContentDoc } from '../content/content.service.ts'
import { VersionModel } from '../content/version.model.ts'
import { MembershipModel } from '../users/membership.model.ts'
import { anchorSchema, createThread, messageInput, reply } from './feedback.service.ts'
import { MessageModel } from './message.model.ts'
import { THREAD_STATUSES, ThreadModel } from './thread.model.ts'

/** Agency side of feedback on content (mounted under /content): threads, replies, status and assignment. */
export const feedbackRouter = Router()

/** Threads (with messages) on a content item, as the given person may see them: submitted ones, plus their own drafts. */
export async function threadsFor(contentId: Types.ObjectId, viewer: Types.ObjectId, opts: { clientOnly: boolean; version?: Types.ObjectId }) {
  const filter: Record<string, unknown> = {
    content: contentId,
    deletedAt: null,
    $or: [{ submittedAt: { $ne: null } }, { 'author.id': viewer }],
  }
  if (opts.clientOnly) filter.visibility = 'client'
  if (opts.version) filter.version = opts.version
  const threads = await ThreadModel.find(filter).sort({ visibility: 1, pin: 1, createdAt: 1 }).lean()
  const messages = await MessageModel.find({ thread: { $in: threads.map((t) => t._id) }, deletedAt: null }).sort({ createdAt: 1 }).lean()
  return threads.map((t) => ({
    ...t,
    draft: !t.submittedAt,
    messages: messages
      .filter((m) => String(m.thread) === String(t._id))
      .map((m) => ({
        ...m,
        // D22: the transcript is shown as an auto-transcript, and never to anyone who can't hear the note.
        voice: m.voice?.file ? { ...m.voice, transcriptLabel: 'Auto-transcript' } : undefined,
      })),
  }))
}

const listSchema = z.object({ version: z.string().optional(), visibility: z.enum(['internal', 'client']).optional() })

feedbackRouter.get('/:id/threads', async (req, res) => {
  const f = listSchema.parse(req.query)
  const content = await loadContent(req, req.params.id)
  const items = await threadsFor(content._id, req.agencyAuth!.user._id, {
    clientOnly: f.visibility === 'client',
    version: f.version ? objectId(f.version) : undefined,
  })
  res.json({ items: f.visibility === 'internal' ? items.filter((t) => t.visibility === 'internal') : items })
})

async function assignable(req: Request, client: Types.ObjectId, id: string | null | undefined) {
  if (!id) return null
  const user = objectId(id, 'Person not found.')
  const member = await MembershipModel.findOne({ agency: req.agencyAuth!.agency._id, user, status: 'active' }).lean()
  const ok = member && (member.role === 'owner' || member.role === 'admin' || (await AgencyAccessModel.exists({ client, user })))
  if (!ok) throw invalid('assignee', 'Pick someone with access to this client')
  return user
}

const createSchema = z.object({
  /** Who the comment is for. With `client` it's visible to the client (the team always sees it too). */
  sendTo: z
    .object({ team: z.boolean(), client: z.boolean() })
    .refine((t) => t.team || t.client, 'Pick the team, the client or both')
    .optional(),
  /** Older callers pick the visibility directly instead of `sendTo`. */
  visibility: z.enum(['internal', 'client']).optional(),
  kind: z.enum(['feedback', 'discussion']).default('feedback'),
  /** Defaults to the current version. */
  versionId: z.string().optional(),
  anchor: anchorSchema.optional(),
  assignee: z.string().nullable().optional(),
  ...messageInput,
})

/** Agency comments are posted at once. Internal ones (P50) are never visible to the client (D20). */
feedbackRouter.post('/:id/threads', async (req, res) => {
  const input = createSchema.parse(req.body)
  const visibility = input.sendTo ? (input.sendTo.client ? 'client' : 'internal') : input.visibility
  if (!visibility) throw invalid('sendTo', 'Pick the team, the client or both')
  const content = await loadContent(req, req.params.id, 'write')
  const versionId = input.versionId ? objectId(input.versionId, 'Version not found.') : content.currentVersion
  if (!versionId) throw new AppError(409, 'no_version', 'Upload a version first.')
  const version = await VersionModel.findOne({ _id: versionId, content: content._id }, { number: 1 }).lean()
  if (!version) throw notFound('Version not found.')
  if (String(versionId) !== String(content.currentVersion)) throw new AppError(409, 'not_current_version', 'Comments go on the current version only.')
  if (visibility === 'client' && !content.clientVisibleAt) throw new AppError(409, 'not_sent', 'The client can’t see this content yet. Send it to your team only.')

  const thread = await createThread(req, {
    content,
    versionId,
    versionNumber: version.number,
    visibility,
    kind: input.kind,
    anchor: input.anchor,
    message: input,
    draft: false,
    assignee: await assignable(req, content.client, input.assignee),
  })
  if (input.sendTo) await notifyComment(req, content, input.sendTo)
  res.status(201).json({ thread })
})

/** Tells the people the comment was sent to. Whoever wrote it is never notified. */
async function notifyComment(req: Request, content: ContentDoc, sendTo: { team: boolean; client: boolean }) {
  const me = req.agencyAuth!.user
  const base = { agency: content.agency, client: content.client, category: 'feedback' as const, event: 'feedback.comment', entity: { type: 'content', id: content._id }, except: me._id }
  if (sendTo.team) {
    await notify({ ...base, recipients: await contentTeam(content), audience: 'agency', title: `${me.name} commented on ${content.title}`, link: `/app/content/${content._id}` })
  }
  if (sendTo.client) {
    await notify({ ...base, recipients: await clientPeople(content.client), audience: 'client', title: `${me.name} left a comment on ${content.title}`, link: `/c/content/${content._id}` })
  }
}

const replySchema = z.object(messageInput)

feedbackRouter.post('/:id/threads/:threadId/messages', async (req, res) => {
  const content = await loadContent(req, req.params.id, 'write')
  const message = await reply(req, objectId(req.params.threadId, 'Comment not found.'), content, replySchema.parse(req.body))
  res.status(201).json({ message })
})

const updateSchema = z.object({
  status: z.enum(THREAD_STATUSES).optional(),
  assignee: z.string().nullable().optional(),
  resolutionNote: z.string().trim().max(2000).optional(),
})

/** Assign (P58), start, resolve with a response. */
feedbackRouter.patch('/:id/threads/:threadId', async (req, res) => {
  const input = updateSchema.parse(req.body)
  const content = await loadContent(req, req.params.id, 'write')
  const thread = await ThreadModel.findOne({ _id: objectId(req.params.threadId, 'Comment not found.'), content: content._id, deletedAt: null, submittedAt: { $ne: null } })
  if (!thread) throw notFound('Comment not found.')
  const me = req.agencyAuth!.user
  if (input.status && thread.kind !== 'feedback') throw invalid('status', 'Only feedback items have a status')

  if (input.assignee !== undefined) {
    thread.assignee = await assignable(req, content.client, input.assignee)
    if (thread.assignee && String(thread.assignee) !== String(me._id)) {
      await notify({
        recipients: [thread.assignee],
        audience: 'agency',
        agency: content.agency,
        client: content.client,
        category: 'feedback',
        event: 'feedback.assigned',
        title: `${me.name} assigned you feedback on ${content.title}`,
        entity: { type: 'content', id: content._id },
        link: `/app/content/${content._id}`,
      })
    }
  }
  if (input.status && input.status !== thread.status) {
    if (input.status === 'resolved') {
      thread.set({ resolvedAt: new Date(), resolvedBy: { id: me._id, name: me.name }, resolutionNote: input.resolutionNote ?? '' })
    } else {
      thread.set({ resolvedAt: null, resolvedInVersion: undefined, closedOnApproval: false })
    }
    thread.status = input.status
    await logActivity(req, {
      action: `feedback.${input.status}`,
      message: `${me.name} marked feedback #${thread.pin} on ${content.title} as ${input.status.replace('_', ' ')}`,
      agency: content.agency,
      client: content.client,
      visibility: thread.visibility as 'internal' | 'client',
      target: { type: 'thread', id: thread._id, label: content.title },
    })
  }
  await thread.save()
  res.json({ thread })
})

// ── Feedback inbox (P57) ─────────────────────────────────────────────────────

const inboxSchema = z.object({
  ...pageQuery,
  status: csvEnum(THREAD_STATUSES),
  client: z.string().optional(),
  visibility: z.enum(['internal', 'client']).optional(),
  assignee: z.string().optional(),
  mine: z.stringbool().optional(),
})

export const feedbackInboxRouter = Router()

/** Submitted feedback across every client the person can see, newest first. Defaults to open + in progress. */
feedbackInboxRouter.get('/', async (req, res) => {
  const f = inboxSchema.parse(req.query)
  const match: Record<string, unknown> = { ...(await scopeFilter(req, { agencyLevel: false })), kind: 'feedback', submittedAt: { $ne: null }, deletedAt: null }
  match.status = { $in: f.status.length ? f.status : ['open', 'in_progress'] }
  match.visibility = f.visibility ?? 'client'
  if (f.client) match.$and = [{ client: objectId(f.client) }]
  if (f.assignee) match.assignee = objectId(f.assignee)
  if (f.mine) match.assignee = req.agencyAuth!.user._id
  const pipeline: PipelineStage[] = [
    { $match: match },
    { $lookup: { from: 'contents', localField: 'content', foreignField: '_id', as: 'contentInfo', pipeline: [{ $project: { title: 1, state: 1, platform: 1 } }] } },
    { $lookup: { from: 'clients', localField: 'client', foreignField: '_id', as: 'clientInfo', pipeline: [{ $project: { brandName: 1 } }] } },
    { $lookup: { from: 'messages', localField: '_id', foreignField: 'thread', as: 'first', pipeline: [{ $sort: { createdAt: 1 } }, { $limit: 1 }, { $project: { body: 1, voice: 1 } }] } },
    { $set: { contentInfo: { $first: '$contentInfo' }, clientInfo: { $first: '$clientInfo' }, first: { $first: '$first' } } },
  ]
  res.json(await paginateAggregate(ThreadModel, pipeline, { page: f.page, pageSize: f.pageSize, sort: { submittedAt: -1 } }))
})
