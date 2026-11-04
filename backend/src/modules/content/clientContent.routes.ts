import { Router, type Request } from 'express'
import type { Types } from 'mongoose'
import { z } from 'zod'
import { objectId } from '../../lib/ids.ts'
import { csvEnum, escapeRegex, pageQuery, paginate } from '../../lib/pagination.ts'
import { clientCan, scopeFilter } from '../../lib/scope.ts'
import { presignDownload, storageConfigured } from '../../lib/storage.ts'
import { idempotent } from '../../middleware/idempotency.ts'
import { AppError, forbidden, notFound } from '../../utils/AppError.ts'
import { ChecklistItemModel } from '../checklist/checklist.model.ts'
import { withDone } from '../checklist/checklist.service.ts'
import { ClientModel } from '../clients/client.model.ts'
import { anchorSchema, copyDraftToCurrent, createThread, messageInput, reply, submitDrafts } from '../feedback/feedback.service.ts'
import { threadsFor } from '../feedback/feedback.routes.ts'
import { MessageModel } from '../feedback/message.model.ts'
import { ThreadModel } from '../feedback/thread.model.ts'
import { FileModel } from '../files/file.model.ts'
import { CLIENT_BUCKETS, STATES_FOR_BUCKET, clientStatus, shiftedDays } from './content.derive.ts'
import { CONTENT_STATES, ContentModel } from './content.model.ts'
import * as svc from './content.service.ts'
import { PublishJobModel } from './publishJob.model.ts'
import { ReviewDecisionModel } from './reviewDecision.model.ts'
import { VersionModel } from './version.model.ts'

/**
 * The Client App's content (F15–F45). A client sees content only once it has been sent (D64), only versions
 * that were sent to them, and only `client` feedback (D20). Comments and decisions go on the current version (D10).
 */
export const clientContentRouter = Router()

/** States in which the client is (or was) asked to decide, so comments and decisions are possible. */
const REVIEWABLE: readonly string[] = ['client_review', 'changes_requested', 'approved', 'scheduled']

async function loadVisible(req: Request, id: unknown) {
  const content = await ContentModel.findOne({
    ...(await scopeFilter(req, { softDelete: true })),
    _id: objectId(id, 'Content not found.'),
    clientVisibleAt: { $ne: null },
  }).lean()
  if (!content) throw notFound('Content not found.')
  return content as svc.ContentDoc
}

const sentVersions = (contentId: Types.ObjectId) =>
  VersionModel.find({ content: contentId, sentToClientAt: { $ne: null } }, { caption: 1, hashtags: 1, number: 1, files: 1, sentToClientAt: 1, withdrawnAt: 1, createdAt: 1 })
    .sort({ number: -1 })
    .lean()

/** The version the client should be looking at: the current one once it's sent, else the last one they saw. */
function visibleVersion<V extends { _id: Types.ObjectId }>(content: svc.ContentDoc, versions: V[]): V | null {
  return versions.find((v) => String(v._id) === String(content.currentVersion)) ?? versions[0] ?? null
}

async function signedFiles(files: { _id: Types.ObjectId; file: Types.ObjectId; width?: number | null; height?: number | null; durationMs?: number | null }[]) {
  const stored = await FileModel.find({ _id: { $in: files.map((f) => f.file) } }).lean()
  return Promise.all(
    files.map(async (f) => {
      const file = stored.find((s) => String(s._id) === String(f.file))
      const url = file && file.status === 'ready' && storageConfigured() ? (await presignDownload(file.key, file, { inline: true })).url : null
      return { id: f._id, name: file?.name, mimeType: file?.mimeType, width: f.width, height: f.height, durationMs: f.durationMs, url }
    }),
  )
}

async function presentForClient(req: Request, content: svc.ContentDoc) {
  const [versions, job, decisions, used, client] = await Promise.all([
    sentVersions(content._id),
    PublishJobModel.findOne({ content: content._id }, { status: 1 }).sort({ createdAt: -1 }).lean(),
    ReviewDecisionModel.find({ content: content._id, scope: 'client' }, { decision: 1, by: 1, versionNumber: 1, note: 1, createdAt: 1 }).sort({ createdAt: -1 }).lean(),
    svc.revisionsUsed(content._id),
    ClientModel.findById(content.client, { contract: 1 }).lean(),
  ])
  const visible = visibleVersion(content, versions)
  const isCurrent = !!visible && String(visible._id) === String(content.currentVersion)
  const role = req.clientAuth!.role
  return {
    id: content._id,
    title: content.title,
    platform: content.platform,
    format: content.format,
    publishDate: content.publishDate,
    status: clientStatus(content.state, job?.status),
    /** Echo back as `expectedState` on decisions (D07). */
    state: content.state,
    approved: content.approvedAt ? { by: content.approvedBy?.name, at: content.approvedAt } : null,
    published: content.publishedAt ? { at: content.publishedAt, url: content.externalUrl } : null,
    version: visible ? { ...visible, isCurrent, files: await signedFiles(visible.files as any) } : null,
    versions: versions.map((v) => ({ id: v._id, number: v.number, sentToClientAt: v.sentToClientAt, withdrawnAt: v.withdrawnAt })),
    decisions,
    // D29: neutral delay signals for the client. "At risk" stays agency-only.
    delay: {
      reviewPendingSince: content.state === 'client_review' ? content.stateChangedAt : null,
      approvalNeededBy:
        content.publishDate && ['client_review', 'changes_requested'].includes(content.state)
          ? new Date(content.publishDate.getTime() - (client?.contract?.approvalLeadHours ?? 24) * 3_600_000)
          : null,
      shiftedDays: shiftedDays(content, req.clientAuth!.client.timezone),
    },
    revisions: { used, included: content.revisionLimit ?? client?.contract?.revisionsIncluded ?? 2 },
    can: {
      comment: isCurrent && REVIEWABLE.includes(content.state) && clientCan(role, 'feedback'),
      decide: isCurrent && REVIEWABLE.includes(content.state) && clientCan(role, 'approve'),
    },
  }
}

// ── Content hub ──────────────────────────────────────────────────────────────

const listSchema = z.object({
  ...pageQuery,
  status: csvEnum(CLIENT_BUCKETS),
  sort: z.enum(['updated', 'publish_date']).default('updated'),
})

clientContentRouter.get('/', async (req, res) => {
  const f = listSchema.parse(req.query)
  const base: Record<string, unknown> = { ...(await scopeFilter(req, { softDelete: true })), clientVisibleAt: { $ne: null } }
  const filter: Record<string, unknown> = { ...base, state: { $ne: 'planned' } }
  if (f.status.length) filter.state = { $in: f.status.flatMap((b) => STATES_FOR_BUCKET[b]) }
  if (f.q) filter.title = new RegExp(escapeRegex(f.q), 'i')
  const page = await paginate(ContentModel, filter, {
    page: f.page,
    pageSize: f.pageSize,
    sort: f.sort === 'publish_date' ? { publishDate: 1 } : { stateChangedAt: -1 },
  })
  const jobs = await PublishJobModel.find({ content: { $in: page.items.map((c) => c._id) }, status: { $in: ['failed', 'unknown'] } }, { content: 1, status: 1 }).lean()
  const covers = await VersionModel.find({ content: { $in: page.items.map((c) => c._id) }, sentToClientAt: { $ne: null } }, { content: 1, number: 1, files: { $slice: 1 } })
    .sort({ number: -1 })
    .lean()

  const counts = Object.fromEntries(CLIENT_BUCKETS.map((b) => [b, 0])) as Record<string, number>
  for (const { _id, n } of await ContentModel.aggregate<{ _id: (typeof CONTENT_STATES)[number]; n: number }>([{ $match: base }, { $group: { _id: '$state', n: { $sum: 1 } } }])) {
    const bucket = clientStatus(_id).bucket
    if (bucket) counts[bucket] += n
  }
  res.json({
    ...page,
    counts,
    items: await Promise.all(
      page.items.map(async (c) => {
        const cover = covers.find((v) => String(v.content) === String(c._id))
        return {
          id: c._id,
          title: c.title,
          platform: c.platform,
          format: c.format,
          publishDate: c.publishDate,
          status: clientStatus(c.state, jobs.find((j) => String(j.content) === String(c._id))?.status),
          versionNumber: cover?.number ?? null,
          cover: (cover as any)?.files?.[0] ? (await signedFiles([(cover as any).files[0]]))[0] : null,
          updatedAt: c.stateChangedAt,
        }
      }),
    ),
  })
})

clientContentRouter.get('/:id', async (req, res) => {
  res.json({ content: await presentForClient(req, await loadVisible(req, req.params.id)) })
})

/** Version history (D10): sent versions only, read-only. Opening the current one counts as "viewed" for Admins/Approvers (D04). */
clientContentRouter.get('/:id/versions/:versionId', async (req, res) => {
  const content = await loadVisible(req, req.params.id)
  const version = await VersionModel.findOne({
    _id: objectId(req.params.versionId, 'Version not found.'),
    content: content._id,
    sentToClientAt: { $ne: null },
  }).lean()
  if (!version) throw notFound('Version not found.')
  const auth = req.clientAuth!
  const isCurrent = String(version._id) === String(content.currentVersion)
  if (isCurrent && !version.firstViewedAt && clientCan(auth.role, 'approve') && content.state === 'client_review') {
    await VersionModel.updateOne({ _id: version._id, firstViewedAt: null }, { $set: { firstViewedAt: new Date(), firstViewedBy: { id: auth.user._id, name: auth.user.name } } })
  }
  const { number, caption, hashtags, sentToClientAt, withdrawnAt, files } = version
  res.json({ version: { id: version._id, number, caption, hashtags, sentToClientAt, withdrawnAt, isCurrent, files: await signedFiles(files as any) } })
})

// ── Feedback ────────────────────────────────────────────────────────────────

clientContentRouter.get('/:id/threads', async (req, res) => {
  const content = await loadVisible(req, req.params.id)
  const version = typeof req.query.version === 'string' ? objectId(req.query.version) : undefined
  const sent = (await sentVersions(content._id)).map((v) => String(v._id))
  const items = (await threadsFor(content._id, req.clientAuth!.user._id, { clientOnly: true, version })).filter((t) => sent.includes(String(t.version)))
  res.json({ items })
})

/** The caller's unsent drafts on this content. Drafts on a replaced version are `stale` (D83). */
clientContentRouter.get('/:id/drafts', async (req, res) => {
  const content = await loadVisible(req, req.params.id)
  const drafts = await ThreadModel.find({ content: content._id, 'author.id': req.clientAuth!.user._id, submittedAt: null, deletedAt: null }).sort({ createdAt: 1 }).lean()
  res.json({ items: drafts.map((d) => ({ ...d, stale: String(d.version) !== String(content.currentVersion) })) })
})

function assertCanComment(req: Request, content: svc.ContentDoc) {
  if (!clientCan(req.clientAuth!.role, 'feedback')) throw forbidden('Your role can view but not comment.')
  if (!REVIEWABLE.includes(content.state)) throw new AppError(409, 'not_in_review', 'This isn’t open for comments right now.', { state: content.state })
}

const createSchema = z.object({
  versionId: z.string(),
  kind: z.enum(['feedback', 'discussion']).default('feedback'),
  anchor: anchorSchema.optional(),
  ...messageInput,
})

/** Adds a comment to the caller's pending review: a draft only they can see until they submit (D14). */
clientContentRouter.post('/:id/threads', idempotent(), async (req, res) => {
  const input = createSchema.parse(req.body)
  const content = await loadVisible(req, req.params.id)
  assertCanComment(req, content)
  const versionId = objectId(input.versionId, 'Version not found.')
  if (String(versionId) !== String(content.currentVersion)) throw new AppError(409, 'not_current_version', 'Comments go on the current version only.')
  const version = await VersionModel.findOne({ _id: versionId, sentToClientAt: { $ne: null } }, { number: 1 }).lean()
  if (!version) throw notFound('Version not found.')
  const thread = await createThread(req, {
    content,
    versionId,
    versionNumber: version.number,
    visibility: 'client',
    kind: input.kind,
    anchor: input.anchor,
    message: input,
    draft: true,
  })
  res.status(201).json({ thread })
})

async function ownDraft(req: Request, content: svc.ContentDoc) {
  const thread = await ThreadModel.findOne({
    _id: objectId(req.params.threadId, 'Draft not found.'),
    content: content._id,
    'author.id': req.clientAuth!.user._id,
    submittedAt: null,
    deletedAt: null,
  })
  if (!thread) throw notFound('Draft not found.')
  return thread
}

const editSchema = z.object({ body: z.string().trim().max(5000).optional(), anchor: anchorSchema.nullable().optional() })

clientContentRouter.patch('/:id/threads/:threadId', async (req, res) => {
  const input = editSchema.parse(req.body)
  const content = await loadVisible(req, req.params.id)
  const thread = await ownDraft(req, content)
  if (input.body !== undefined) await MessageModel.updateOne({ thread: thread._id, submittedAt: null }, { $set: { body: input.body, editedAt: new Date() } })
  if (input.anchor === null) thread.anchor = { versionFile: null, timeMs: null, shapes: undefined }
  else if (input.anchor) {
    const vf = input.anchor.versionFile ? objectId(input.anchor.versionFile) : null
    const version = await VersionModel.findById(thread.version, { files: 1 }).lean()
    if (vf && !version?.files.some((f) => String(f._id) === String(vf))) throw new AppError(400, 'invalid_input', 'That slide isn’t part of this version.')
    thread.anchor = { versionFile: vf, timeMs: input.anchor.timeMs ?? null, shapes: input.anchor.shapes }
  }
  await thread.save()
  res.json({ thread })
})

clientContentRouter.delete('/:id/threads/:threadId', async (req, res) => {
  const content = await loadVisible(req, req.params.id)
  const thread = await ownDraft(req, content)
  await ThreadModel.updateOne({ _id: thread._id }, { $set: { deletedAt: new Date() } })
  await MessageModel.updateMany({ thread: thread._id }, { $set: { deletedAt: new Date() } })
  res.status(204).end()
})

clientContentRouter.post('/:id/threads/:threadId/copy-to-current', async (req, res) => {
  const content = await loadVisible(req, req.params.id)
  assertCanComment(req, content)
  res.json({ thread: await copyDraftToCurrent(req, objectId(req.params.threadId, 'Draft not found.'), content) })
})

clientContentRouter.post('/:id/threads/:threadId/messages', async (req, res) => {
  const content = await loadVisible(req, req.params.id)
  if (!clientCan(req.clientAuth!.role, 'feedback')) throw forbidden('Your role can view but not comment.')
  const threadId = objectId(req.params.threadId, 'Comment not found.')
  if (!(await ThreadModel.exists({ _id: threadId, content: content._id, visibility: 'client' }))) throw notFound('Comment not found.')
  const message = await reply(req, threadId, content, z.object(messageInput).parse(req.body))
  res.status(201).json({ message })
})

/** Reopen works only while the content is in review; on approved content, request changes instead (§6.5). */
clientContentRouter.post('/:id/threads/:threadId/reopen', async (req, res) => {
  const content = await loadVisible(req, req.params.id)
  if (!clientCan(req.clientAuth!.role, 'feedback')) throw forbidden()
  if (!['client_review', 'changes_requested'].includes(content.state)) {
    throw new AppError(409, 'not_in_review', 'This content is no longer in review. Use “Request changes” instead.', { state: content.state })
  }
  const thread = await ThreadModel.findOneAndUpdate(
    { _id: objectId(req.params.threadId, 'Comment not found.'), content: content._id, visibility: 'client', kind: 'feedback', status: 'resolved' },
    { $set: { status: 'open', reopenedAt: new Date(), resolvedAt: null, closedOnApproval: false } },
    { returnDocument: 'after' },
  )
  if (!thread) throw new AppError(409, 'invalid_state', 'Only resolved feedback can be reopened.')
  res.json({ thread })
})

/**
 * The revision checklist the agency accepted, per sent version (D21). Never suggestions, never raw AI output.
 * Each item is done once its task is done or its feedback was resolved.
 */
clientContentRouter.get('/:id/checklist', async (req, res) => {
  const content = await loadVisible(req, req.params.id)
  const sent = await sentVersions(content._id)
  const items = await ChecklistItemModel.find(
    { content: content._id, version: { $in: sent.map((v) => v._id) }, status: 'accepted' },
    { text: 1, versionNumber: 1, sourceThreads: 1, task: 1, order: 1 },
  )
    .sort({ versionNumber: -1, order: 1 })
    .lean()
  const pins = await ThreadModel.find({ _id: { $in: items.flatMap((i) => i.sourceThreads) }, visibility: 'client' }, { pin: 1 }).lean()
  res.json({
    items: (await withDone(items)).map(({ task: _task, sourceThreads, ...item }) => ({
      ...item,
      pins: pins.filter((p) => sourceThreads.some((s) => String(s) === String(p._id))).map((p) => p.pin),
    })),
  })
})

// ── Review: send feedback, approve, request changes ──────────────────────────

const submitSchema = z.object({ versionId: z.string() })

/** "Send feedback": submits the caller's drafts without a decision. Anyone who can comment may do it (D14). */
clientContentRouter.post('/:id/review/submit', idempotent(), async (req, res) => {
  const { versionId } = submitSchema.parse(req.body)
  const content = await loadVisible(req, req.params.id)
  assertCanComment(req, content)
  const vid = objectId(versionId, 'Version not found.')
  if (String(vid) !== String(content.currentVersion)) throw new AppError(409, 'not_current_version', 'A newer version has replaced this one.')
  res.json({ submitted: await submitDrafts(req, content, vid) })
})

const decisionSchema = z.object({
  versionId: z.string(),
  expectedState: z.enum(CONTENT_STATES),
  confirm: z.boolean().default(false),
  note: z.string().trim().max(2000).default(''),
})

function assertCanDecide(req: Request) {
  if (!clientCan(req.clientAuth!.role, 'approve')) throw forbidden('Only an admin or approver can approve or request changes.')
}

clientContentRouter.post('/:id/approve', idempotent(), async (req, res) => {
  assertCanDecide(req)
  const input = decisionSchema.extend({ drafts: z.enum(['discard', 'post_as_messages']).optional() }).parse(req.body)
  const content = await loadVisible(req, req.params.id)
  await svc.clientApprove(req, content, { ...input, versionId: objectId(input.versionId, 'Version not found.') })
  res.json({ content: await presentForClient(req, await loadVisible(req, req.params.id)) })
})

clientContentRouter.post('/:id/request-changes', idempotent(), async (req, res) => {
  assertCanDecide(req)
  const input = decisionSchema.parse(req.body)
  const content = await loadVisible(req, req.params.id)
  await svc.clientRequestChanges(req, content, { ...input, versionId: objectId(input.versionId, 'Version not found.') })
  res.json({ content: await presentForClient(req, await loadVisible(req, req.params.id)) })
})
