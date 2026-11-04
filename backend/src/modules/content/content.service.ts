import type { Request } from 'express'
import mongoose, { Types } from 'mongoose'
import { logActivity, type ActivityInput } from '../../lib/activity.ts'
import { transition, type Transition } from '../../lib/concurrency.ts'
import { notify } from '../../lib/notify.ts'
import { currentUser, isManagerPlus } from '../../lib/scope.ts'
import { AppError, forbidden } from '../../utils/AppError.ts'
import { ClientModel } from '../clients/client.model.ts'
import { ThreadModel } from '../feedback/thread.model.ts'
import { FileModel } from '../files/file.model.ts'
import { MessageModel } from '../feedback/message.model.ts'
import { submitDrafts } from '../feedback/feedback.service.ts'
import { queueChecklist } from '../checklist/checklist.service.ts'
import { flagTasksClosedOnApproval } from '../tasks/task.service.ts'
import { clientPeople, contentTeam, internalReviewers, publishers } from './content.recipients.ts'
import { CONTENT_TRANSITIONS, ContentModel, type Content, type ContentState } from './content.model.ts'
import { cancelJob } from '../../lib/jobs.ts'
import type { PlatformKey } from '../../lib/platforms/types.ts'
import { ConnectionModel } from '../publishing/connection.model.ts'
import { publishKey, queuePublish } from '../publishing/publish.worker.ts'
import { PublishJobModel } from './publishJob.model.ts'
import { ReviewDecisionModel } from './reviewDecision.model.ts'
import { VersionModel, versionLabel } from './version.model.ts'

export type ContentDoc = Content & { _id: Types.ObjectId; createdAt?: Date; updatedAt?: Date }

const T = CONTENT_TRANSITIONS
const agencyLink = (c: { _id: Types.ObjectId }) => `/app/content/${c._id}`
const clientLink = (c: { _id: Types.ObjectId }) => `/c/content/${c._id}`

const publishingLock = () => new AppError(409, 'already_publishing', 'This is already being published.')

/** Runs a state change scoped to the content's agency, stamps `stateChangedAt`, and refuses during publishing. */
async function move(content: ContentDoc, rule: Transition<ContentState>, set: Record<string, unknown> = {}) {
  try {
    return await transition(ContentModel, { _id: content._id, agency: content.agency, deletedAt: null }, rule, {
      field: 'state',
      label: 'content',
      set: { ...set, stateChangedAt: new Date() },
    })
  } catch (err) {
    if (err instanceof AppError && err.code === 'invalid_state' && (err.details as any)?.state === 'publishing') throw publishingLock()
    throw err
  }
}

const event = (req: Request | null, content: ContentDoc, input: Omit<ActivityInput, 'agency' | 'client' | 'target'>) =>
  logActivity(req, { ...input, agency: content.agency, client: content.client, target: { type: 'content', id: content._id, label: content.title } })

const actorName = (req: Request | null) => (req ? currentUser(req).name : 'Unfoldd')

/** Cancels the publish job and its queued worker run (new version, pulled approval, unschedule, cancel). */
async function cancelJobs(contentId: Types.ObjectId, session?: mongoose.ClientSession) {
  await PublishJobModel.updateMany({ content: contentId, status: { $in: ['queued', 'failed', 'unknown'] } }, { $set: { status: 'cancelled', finishedAt: new Date() } }, { session })
  await cancelJob(publishKey(contentId))
}

async function currentVersionOf(content: ContentDoc) {
  if (!content.currentVersion) throw new AppError(409, 'no_version', 'Upload a version first.')
  const version = await VersionModel.findById(content.currentVersion)
  if (!version) throw new AppError(409, 'no_version', 'Upload a version first.')
  return version
}

/** D60: a version can't be submitted or sent while any of its files are still processing. */
async function assertFilesReady(version: { files: { file: Types.ObjectId }[] }) {
  if (!version.files.length) throw new AppError(409, 'no_files', 'Add at least one file to the version.')
  const ready = await FileModel.countDocuments({ _id: { $in: version.files.map((f) => f.file) }, status: 'ready', deletedAt: null })
  if (ready !== version.files.length) throw new AppError(409, 'files_processing', 'Some files are still processing. Try again when they’re ready.')
}

// ── Versions ────────────────────────────────────────────────────────────────

export interface VersionInput {
  files: Types.ObjectId[]
  caption: string
  hashtags: string[]
  changeNote: string
  /** "Which feedback does this version address?" → resolved in this version (Flow 7, step 7). */
  resolves: Types.ObjectId[]
  resolutionNote: string
}

export async function versionFiles(content: ContentDoc, ids: Types.ObjectId[]) {
  const files = await FileModel.find(
    { _id: { $in: ids }, agency: content.agency, client: content.client, purpose: 'version', deletedAt: null, status: { $ne: 'failed' } },
    { _id: 1 },
  ).lean()
  if (files.length !== new Set(ids.map(String)).size) {
    throw new AppError(400, 'invalid_input', 'Some fields are invalid.', { files: ['Upload every file for this version first'] })
  }
  return ids.map((file) => ({ file }))
}

/**
 * D76: uploading a version from any state after submit moves the content to `in_production`, voids approval
 * and cancels any publish job. The number comes from a counter on the content, inside the transaction (D60).
 */
export async function uploadVersion(req: Request, content: ContentDoc, input: VersionInput) {
  const files = await versionFiles(content, input.files)
  if (!files.length) throw new AppError(400, 'invalid_input', 'Some fields are invalid.', { files: ['Add at least one file'] })
  const me = currentUser(req)
  const versionId = new Types.ObjectId()
  let before: ContentDoc | null = null
  let number = 0

  await mongoose.connection.transaction(async (session) => {
    before = await ContentModel.findOneAndUpdate(
      { _id: content._id, agency: content.agency, deletedAt: null, state: { $in: T.newVersion.from } },
      {
        $inc: { 'counters.version': 1 },
        $set: {
          state: 'in_production',
          stateChangedAt: new Date(),
          currentVersion: versionId,
          approvedVersion: null,
          approvedAt: null,
          approvedBy: null,
          sendAt: null,
        },
      },
      { returnDocument: 'before', session },
    ).lean()
    if (!before) {
      const now = await ContentModel.findById(content._id, { state: 1 }).lean()
      if (now?.state === 'publishing') throw publishingLock()
      throw new AppError(409, 'invalid_state', `This content is ${now?.state.replace(/_/g, ' ')}, so a new version can’t be added.`, { state: now?.state })
    }
    number = (before.counters?.version ?? 0) + 1
    await VersionModel.create(
      [
        {
          _id: versionId,
          agency: content.agency,
          client: content.client,
          content: content._id,
          number,
          files,
          caption: input.caption,
          hashtags: input.hashtags,
          changeNote: input.changeNote,
          createdBy: { id: me._id, name: me.name },
        },
      ],
      { session },
    )
    await cancelJobs(content._id, session)
    await FileModel.updateMany({ _id: { $in: input.files } }, { $addToSet: { usedIn: { type: 'version', id: versionId } } }, { session })
    if (input.resolves.length) {
      await ThreadModel.updateMany(
        { _id: { $in: input.resolves }, content: content._id, kind: 'feedback', submittedAt: { $ne: null }, status: { $ne: 'resolved' } },
        {
          $set: {
            status: 'resolved',
            resolvedAt: new Date(),
            resolvedBy: { id: me._id, name: me.name },
            resolvedInVersion: { id: versionId, number },
            resolutionNote: input.resolutionNote,
          },
        },
        { session },
      )
    }
  })

  const prev = before! as ContentDoc
  const label = versionLabel(number)
  await event(req, content, { action: 'version.uploaded', message: `${me.name} uploaded ${label} of ${content.title}`, meta: { version: versionId, number } })

  // The client was looking at the old version: tell them it was withdrawn (D76).
  if (['client_review', 'changes_requested', 'approved', 'scheduled'].includes(prev.state) && prev.currentVersion) {
    await VersionModel.updateOne({ _id: prev.currentVersion, sentToClientAt: { $ne: null } }, { $set: { withdrawnAt: new Date() } })
    const old = await VersionModel.findById(prev.currentVersion, { number: 1 }).lean()
    const msg = `${versionLabel(old!.number)} of ${content.title} was withdrawn — a new version is coming`
    const e = await event(req, content, { action: 'version.withdrawn', message: msg, visibility: 'client' })
    await notify({
      recipients: await clientPeople(content.client),
      audience: 'client',
      agency: content.agency,
      client: content.client,
      category: 'reviews',
      event: 'version.withdrawn',
      title: msg,
      entity: { type: 'content', id: content._id },
      link: clientLink(content),
      activity: e?._id,
    })
  }
  if (prev.state === 'approved' || prev.state === 'scheduled') {
    await notify({
      recipients: await contentTeam(content),
      audience: 'agency',
      agency: content.agency,
      client: content.client,
      category: 'reviews',
      event: 'content.approval_voided',
      title: `${content.title}: the approval was voided by ${label}`,
      body: prev.state === 'scheduled' ? 'The scheduled publish was cancelled. It needs approval again.' : 'It needs approval again.',
      entity: { type: 'content', id: content._id },
      link: agencyLink(content),
      except: me._id,
    })
  }
  return { versionId, number }
}

// ── Production → review → send ───────────────────────────────────────────────

/** in_production → internal_review (internal review on) or ready_for_client (off). The toggle applies at submit. */
export async function submit(req: Request, content: ContentDoc) {
  const version = await currentVersionOf(content)
  await assertFilesReady(version)
  const client = await ClientModel.findById(content.client, { contract: 1 }).lean()
  const internal = client?.contract?.internalReview ?? true
  const updated = await move(content, internal ? T.submitToInternal : T.submitToReady)
  if (!version.lockedAt) await VersionModel.updateOne({ _id: version._id, lockedAt: null }, { $set: { lockedAt: new Date() } })

  const me = currentUser(req)
  const e = await event(req, content, {
    action: 'content.submitted',
    message: `${me.name} submitted ${versionLabel(version.number)} of ${content.title}${internal ? ' for internal review' : ''}`,
  })
  if (internal) {
    await notify({
      recipients: await internalReviewers(content),
      audience: 'agency',
      agency: content.agency,
      client: content.client,
      category: 'reviews',
      event: 'content.internal_review',
      title: `${content.title} is ready for internal review`,
      entity: { type: 'content', id: content._id },
      link: agencyLink(content),
      activity: e?._id,
      except: me._id,
    })
  }
  return updated
}

/** D46: Manager+ with access, or the content's assigned reviewer. */
export function canInternallyReview(req: Request, content: ContentDoc) {
  const auth = req.agencyAuth!
  return isManagerPlus(auth.role) || String(content.reviewer) === String(auth.user._id)
}

export async function internalDecision(req: Request, content: ContentDoc, decision: 'approve' | 'approve_and_send' | 'request_changes', note: string) {
  if (!canInternallyReview(req, content)) throw forbidden('Only a manager or the assigned reviewer can review this.')
  const version = await currentVersionOf(content)
  if (decision === 'approve_and_send') await assertFilesReady(version)
  const rule = decision === 'approve' ? T.internalApprove : decision === 'approve_and_send' ? T.internalApproveAndSend : T.internalRequestChanges
  const sending = decision === 'approve_and_send'
  const now = new Date()
  const updated = await move(content, rule, sending ? { clientVisibleAt: content.clientVisibleAt ?? now, sendAt: null } : {})
  const me = currentUser(req)
  await ReviewDecisionModel.create({
    agency: content.agency,
    client: content.client,
    content: content._id,
    version: version._id,
    versionNumber: version.number,
    scope: 'internal',
    decision: decision === 'request_changes' ? 'changes_requested' : 'approved',
    by: { id: me._id, name: me.name },
    note,
  })
  const verb = decision === 'request_changes' ? 'requested internal changes on' : 'approved'
  await event(req, content, { action: `content.internal_${decision}`, message: `${me.name} ${verb} ${versionLabel(version.number)} of ${content.title}`, meta: { note } })
  await notify({
    recipients: await contentTeam(content),
    audience: 'agency',
    agency: content.agency,
    client: content.client,
    category: 'reviews',
    event: `content.internal_${decision}`,
    title: `${me.name} ${verb} ${content.title}`,
    body: note,
    entity: { type: 'content', id: content._id },
    link: agencyLink(content),
    except: me._id,
  })
  if (sending) await afterSend(req, updated as ContentDoc, version._id, version.number, '')
  return updated
}

/**
 * ready_for_client → client_review (send now), or re-send the same version from changes_requested with a reply.
 * With `sendAt` in the future it only sets the time; the send job sends it then (P52). `req` is null from the job.
 */
export async function send(req: Request | null, content: ContentDoc, opts: { sendAt?: Date | null; note?: string } = {}) {
  const version = await currentVersionOf(content)
  if (!version.lockedAt) throw new AppError(409, 'not_submitted', 'Submit this version before sending it.')
  await assertFilesReady(version)

  if (opts.sendAt && opts.sendAt.getTime() > Date.now()) {
    if (content.state !== 'ready_for_client') throw new AppError(409, 'invalid_state', 'Only content that is ready for the client can be sent later.')
    const updated = await ContentModel.findOneAndUpdate(
      { _id: content._id, state: 'ready_for_client' },
      { $set: { sendAt: opts.sendAt } },
      { returnDocument: 'after' },
    )
    if (!updated) throw new AppError(409, 'invalid_state', 'This content has moved on, so it can’t be sent later.')
    await event(req, content, { action: 'content.send_scheduled', message: `${actorName(req)} set ${content.title} to be sent on ${opts.sendAt.toISOString()}` })
    return updated
  }

  const updated = await move(content, T.send, { clientVisibleAt: content.clientVisibleAt ?? new Date(), sendAt: null })
  await afterSend(req, updated as ContentDoc, version._id, version.number, opts.note ?? '')
  return updated
}

async function afterSend(req: Request | null, content: ContentDoc, versionId: Types.ObjectId, number: number, note: string) {
  await VersionModel.updateOne({ _id: versionId, sentToClientAt: null }, { $set: { sentToClientAt: new Date() } })
  // The date the client first sees; "Schedule shifted · N days" is measured from it (D29).
  await ContentModel.updateOne({ _id: content._id, sharedPublishDate: null, publishDate: { $ne: null } }, [{ $set: { sharedPublishDate: '$publishDate' } }], { updatePipeline: true })
  const label = versionLabel(number)
  const e = await event(req, content, {
    action: 'content.sent',
    message: `${actorName(req)} sent ${label} of ${content.title} for review`,
    visibility: 'client',
    meta: note ? { note } : undefined,
  })
  await notify({
    recipients: await clientPeople(content.client),
    audience: 'client',
    agency: content.agency,
    client: content.client,
    category: 'reviews',
    event: 'content.review_required',
    title: `Review required: ${content.title}`,
    body: note || `${label} is ready for your review.`,
    entity: { type: 'content', id: content._id },
    link: clientLink(content),
    urgent: true,
    activity: e?._id,
  })
}

export async function continueEditing(req: Request, content: ContentDoc) {
  const updated = await move(content, T.continueEditing, { sendAt: null })
  await event(req, content, { action: 'content.editing_resumed', message: `${currentUser(req).name} took ${content.title} back into production` })
  return updated
}

// ── Client decisions (D07, D08, D14, D16) ─────────────────────────────────────

/** "Priya approved this at 4:42 — still request changes?" */
async function decidedMeanwhile(content: ContentDoc, state: string) {
  const last = await ReviewDecisionModel.findOne({ content: content._id, scope: 'client' }).sort({ createdAt: -1 }).lean()
  const what = state === 'changes_requested' ? 'requested changes on' : 'approved'
  return new AppError(
    409,
    'decided_meanwhile',
    last ? `${last.by?.name} ${what} this at ${last.createdAt.toISOString()}. Do you still want to continue?` : `This is now ${state.replace(/_/g, ' ')}.`,
    { state, decision: last ? { decision: last.decision, by: last.by?.name, at: last.createdAt, versionNumber: last.versionNumber } : null },
  )
}

export interface DecisionInput {
  versionId: Types.ObjectId
  /** The state the person saw. If it changed, they must confirm (D07). */
  expectedState: ContentState
  confirm: boolean
  note: string
}

async function decisionVersion(content: ContentDoc, input: DecisionInput) {
  if (String(content.currentVersion) !== String(input.versionId)) {
    throw new AppError(409, 'not_current_version', 'A newer version has replaced this one. Review the current version instead.')
  }
  const version = await VersionModel.findById(input.versionId)
  if (!version?.sentToClientAt) throw new AppError(409, 'not_current_version', 'This version hasn’t been sent for review.')
  return version
}

async function recordClientDecision(req: Request, content: ContentDoc, version: { _id: Types.ObjectId; number: number }, decision: 'approved' | 'changes_requested' | 'pulled', note: string) {
  const me = currentUser(req)
  await ReviewDecisionModel.create({
    agency: content.agency,
    client: content.client,
    content: content._id,
    version: version._id,
    versionNumber: version.number,
    scope: 'client',
    decision,
    by: { id: me._id, name: me.name },
    note,
  })
}

/**
 * Approve the current version. If the approver still has unsent drafts they must choose first (D16):
 * `discard` them, or post them as plain messages (conversation, no status).
 */
export async function clientApprove(req: Request, content: ContentDoc, input: DecisionInput & { drafts?: 'discard' | 'post_as_messages' }) {
  const me = currentUser(req)
  const version = await decisionVersion(content, input)
  if (content.state !== input.expectedState && !input.confirm) throw await decidedMeanwhile(content, content.state)
  if (content.state === 'approved' || content.state === 'scheduled' || content.state === 'publishing' || content.state === 'published') {
    throw await decidedMeanwhile(content, content.state)
  }

  const drafts = await ThreadModel.find({ content: content._id, 'author.id': me._id, submittedAt: null, deletedAt: null }, { _id: 1 }).lean()
  if (drafts.length && !input.drafts) {
    throw new AppError(409, 'has_drafts', `You have ${drafts.length} unsent comment${drafts.length === 1 ? '' : 's'}.`, { drafts: drafts.length })
  }
  if (drafts.length && input.drafts === 'discard') {
    const ids = drafts.map((d) => d._id)
    await ThreadModel.updateMany({ _id: { $in: ids } }, { $set: { deletedAt: new Date() } })
    await MessageModel.updateMany({ thread: { $in: ids } }, { $set: { deletedAt: new Date() } })
  }
  if (drafts.length && input.drafts === 'post_as_messages') {
    await ThreadModel.updateMany({ _id: { $in: drafts.map((d) => d._id) } }, { $set: { kind: 'discussion', status: null, anchor: null } })
    await submitDrafts(req, content, version._id)
  }

  const now = new Date()
  const updated = await move(content, T.approve, { approvedVersion: version._id, approvedAt: now, approvedBy: { id: me._id, name: me.name } })
  await recordClientDecision(req, content, version, 'approved', input.note)

  // D16: open client feedback on this content closes "on approval".
  await ThreadModel.updateMany(
    { content: content._id, visibility: 'client', kind: 'feedback', submittedAt: { $ne: null }, status: { $in: ['open', 'in_progress'] } },
    { $set: { status: 'resolved', resolvedAt: now, closedOnApproval: true, resolvedBy: { id: me._id, name: me.name } } },
  )

  await flagTasksClosedOnApproval(content._id, content.title)

  const label = versionLabel(version.number)
  const e = await event(req, content, { action: 'content.approved', message: `${me.name} approved ${label} of ${content.title}`, visibility: 'client' })
  await notify({
    recipients: [...(await contentTeam(content)), ...(await publishers(content))],
    audience: 'agency',
    agency: content.agency,
    client: content.client,
    category: 'reviews',
    event: 'content.approved',
    title: `${me.name} approved ${content.title}`,
    body: `${label} is ready to schedule.`,
    entity: { type: 'content', id: content._id },
    link: agencyLink(content),
    activity: e?._id,
  })
  return updated
}

/**
 * Request changes. On content in review it submits the person's drafts and needs at least one unresolved
 * client feedback item on the version. On approved or scheduled content it pulls the approval (D08):
 * the job is cancelled and the agency is alerted urgently. Refused while publishing (D78).
 */
export async function clientRequestChanges(req: Request, content: ContentDoc, input: DecisionInput) {
  const me = currentUser(req)
  const version = await decisionVersion(content, input)
  if (content.state === 'publishing' || content.state === 'published') throw publishingLock()
  if (content.state !== input.expectedState && !input.confirm) throw await decidedMeanwhile(content, content.state)

  if (content.state === 'approved' || content.state === 'scheduled') {
    if (String(content.approvedVersion) !== String(version._id)) throw new AppError(409, 'not_current_version', 'This version isn’t the approved one.')
    await submitDrafts(req, content, version._id)
    const updated = await move(content, T.pullApproval, { approvedVersion: null, approvedAt: null, approvedBy: null })
    await cancelJobs(content._id)
    await recordClientDecision(req, content, version, 'pulled', input.note)
    await queueChecklist(content, version._id)
    const e = await event(req, content, {
      action: 'content.approval_pulled',
      message: `${me.name} pulled the approval of ${content.title} and requested changes`,
      visibility: 'client',
    })
    await notify({
      recipients: [...(await contentTeam(content)), ...(await publishers(content))],
      audience: 'agency',
      agency: content.agency,
      client: content.client,
      category: 'reviews',
      event: 'content.approval_pulled',
      title: `${me.name} pulled the approval of ${content.title}`,
      body: content.state === 'scheduled' ? 'The scheduled publish was cancelled.' : 'It needs changes before it can be scheduled.',
      entity: { type: 'content', id: content._id },
      link: agencyLink(content),
      urgent: true,
      activity: e?._id,
    })
    return updated
  }

  if (content.state === 'changes_requested') {
    // Someone already requested changes and the person confirmed: their feedback still goes in.
    await submitDrafts(req, content, version._id)
    return ContentModel.findById(content._id)
  }

  await submitDrafts(req, content, version._id, { notify: false })
  const open = await ThreadModel.countDocuments({
    content: content._id,
    version: version._id,
    visibility: 'client',
    kind: 'feedback',
    submittedAt: { $ne: null },
    status: { $ne: 'resolved' },
    deletedAt: null,
  })
  if (!open) throw new AppError(400, 'feedback_required', 'Add at least one comment describing the changes you need.')

  const updated = await move(content, T.requestChanges)
  await recordClientDecision(req, content, version, 'changes_requested', input.note)
  // D21: the AI checklist runs in the background; the raw feedback is already saved and usable.
  await queueChecklist(content, version._id)
  const e = await event(req, content, {
    action: 'content.changes_requested',
    message: `${me.name} requested changes on ${versionLabel(version.number)} of ${content.title}`,
    visibility: 'client',
  })
  const used = await revisionsUsed(content._id)
  const limit = await revisionLimit(content)
  await notify({
    recipients: await contentTeam(content),
    audience: 'agency',
    agency: content.agency,
    client: content.client,
    category: 'feedback',
    event: 'content.changes_requested',
    title: `${me.name} requested changes on ${content.title}`,
    body: used > limit ? `Revision ${used} of ${limit} included — over the limit.` : `Revision ${used} of ${limit} included.`,
    entity: { type: 'content', id: content._id },
    link: agencyLink(content),
    urgent: true,
    activity: e?._id,
  })
  return updated
}

/** D09: distinct versions the client requested changes on. Internal rounds don't count. */
export async function revisionsUsed(contentId: Types.ObjectId) {
  return (await ReviewDecisionModel.distinct('version', { content: contentId, scope: 'client', decision: { $in: ['changes_requested', 'pulled'] } })).length
}

export async function revisionLimit(content: ContentDoc) {
  if (content.revisionLimit != null) return content.revisionLimit
  const client = await ClientModel.findById(content.client, { contract: 1 }).lean()
  return client?.contract?.revisionsIncluded ?? 2
}

// ── Scheduling and publishing (D25–D28, D78, D79) ─────────────────────────────

export const assertCanPublish = (req: Request) => {
  if (!req.agencyAuth?.canPublish) throw forbidden('You don’t have permission to publish.')
}

/** approved → scheduled with a manual job. Scheduling writes `publishDate`, which the job reads (D28). */
/**
 * approved → scheduled. `connectionId` publishes automatically through a connected account; without it the
 * account is manual and the job only reminds the publisher (D26). Scheduling writes `publishDate` (D28).
 */
export async function schedule(req: Request, content: ContentDoc, publishDate: Date, connectionId?: Types.ObjectId | null) {
  assertCanPublish(req)
  if (publishDate.getTime() <= Date.now()) throw new AppError(400, 'invalid_input', 'Some fields are invalid.', { publishDate: ['Pick a time in the future'] })
  const me = currentUser(req)
  let account: { kind: 'manual' | PlatformKey; id: Types.ObjectId | null; label: string } = { kind: 'manual', id: null, label: 'Manual' }
  if (connectionId) {
    const conn = await ConnectionModel.findOne({ _id: connectionId, client: content.client, status: 'active' }).lean()
    if (!conn) throw new AppError(400, 'invalid_input', 'Some fields are invalid.', { account: ['Pick an active account connected to this client'] })
    if (conn.platform !== content.platform) throw new AppError(400, 'invalid_input', 'Some fields are invalid.', { account: [`This content is for ${content.platform}, not ${conn.platform}`] })
    account = { kind: conn.platform as PlatformKey, id: conn._id, label: conn.name }
  }
  let updated: ContentDoc | null = null
  await mongoose.connection.transaction(async (session) => {
    updated = (await ContentModel.findOneAndUpdate(
      { _id: content._id, agency: content.agency, state: 'approved', approvedVersion: { $ne: null } },
      { $set: { state: 'scheduled', stateChangedAt: new Date(), publishDate, missedSlotAlertedFor: null } },
      { returnDocument: 'after', session },
    ).lean()) as ContentDoc | null
    if (!updated) throw new AppError(409, 'invalid_state', 'Only approved content can be scheduled.', { state: content.state })
    await cancelJobs(content._id, session)
    await PublishJobModel.create(
      [{ agency: content.agency, client: content.client, content: content._id, version: (updated as ContentDoc).approvedVersion!, account, scheduledBy: { id: me._id, name: me.name } }],
      { session },
    )
  })
  if (account.kind !== 'manual') await queuePublish(content._id, publishDate)
  await event(req, content, { action: 'content.scheduled', message: `${me.name} scheduled ${content.title} for ${publishDate.toISOString()}`, visibility: 'client' })
  return updated!
}

export async function unschedule(req: Request, content: ContentDoc) {
  assertCanPublish(req)
  const updated = await move(content, T.unschedule)
  await cancelJobs(content._id)
  await event(req, content, { action: 'content.unscheduled', message: `${currentUser(req).name} unscheduled ${content.title}`, visibility: 'client' })
  return updated
}

/** D26: mark as published by hand, from approved or scheduled (or publishing, when the outcome was unknown). */
export async function markPublished(req: Request, content: ContentDoc, input: { url: string; externalId: string }) {
  assertCanPublish(req)
  if (!content.approvedVersion) throw new AppError(409, 'not_approved', 'Only an approved version can be published.')
  const me = currentUser(req)
  const now = new Date()
  const updated = await move(content, T.markPublished, {
    externalUrl: input.url,
    externalPostId: input.externalId,
    publishedAt: now,
    publishedBy: { id: me._id, name: me.name },
  })
  const job = await PublishJobModel.findOneAndUpdate(
    { content: content._id, status: { $in: ['queued', 'running', 'failed', 'unknown'] } },
    { $set: { status: 'succeeded', externalUrl: input.url, externalId: input.externalId, finishedAt: now } },
  )
  if (!job) {
    await PublishJobModel.create({
      agency: content.agency,
      client: content.client,
      content: content._id,
      version: content.approvedVersion,
      status: 'succeeded',
      externalUrl: input.url,
      externalId: input.externalId,
      scheduledBy: { id: me._id, name: me.name },
      finishedAt: now,
    })
  }
  const e = await event(req, content, { action: 'content.published', message: `${content.title} was published`, visibility: 'client', meta: { url: input.url } })
  await notify({
    recipients: await clientPeople(content.client),
    audience: 'client',
    agency: content.agency,
    client: content.client,
    category: 'publishing',
    event: 'content.published',
    title: `${content.title} is live`,
    entity: { type: 'content', id: content._id },
    link: clientLink(content),
    activity: e?._id,
  })
  return updated
}

/** Retry a failed job, or one whose outcome was unknown after a person checked the account (D79). */
export async function retryPublish(req: Request, content: ContentDoc) {
  assertCanPublish(req)
  if (content.state !== 'scheduled') throw new AppError(409, 'invalid_state', 'Only scheduled content can be retried.', { state: content.state })
  const job = await PublishJobModel.findOneAndUpdate(
    { content: content._id, status: { $in: ['failed', 'unknown'] } },
    { $set: { status: 'queued', error: '', remindedAt: null, attempts: 0 } },
    { returnDocument: 'after' },
  )
  if (!job) throw new AppError(409, 'invalid_state', 'There is no failed publish to retry.')
  if (job.account?.kind !== 'manual') await queuePublish(content._id, new Date())
  await event(req, content, { action: 'publish.retried', message: `${currentUser(req).name} retried publishing ${content.title}` })
  return job
}

// ── Cancel and restore (D77) ─────────────────────────────────────────────────

export function assertCanCancel(req: Request, content: ContentDoc) {
  const auth = req.agencyAuth!
  if (!isManagerPlus(auth.role) && String(content.owner) !== String(auth.user._id)) throw forbidden('Only a manager or the content’s owner can cancel it.')
}

export async function cancel(req: Request, content: ContentDoc, reason: string) {
  assertCanCancel(req, content)
  const updated = await move(content, T.cancel, { sendAt: null })
  await cancelJobs(content._id)
  await event(req, content, {
    action: 'content.cancelled',
    message: `${currentUser(req).name} cancelled ${content.title}${reason ? `: ${reason}` : ''}`,
    visibility: content.clientVisibleAt ? 'client' : 'internal',
  })
  return updated
}

export async function restore(req: Request, content: ContentDoc) {
  assertCanCancel(req, content)
  const to = content.currentVersion ? 'in_production' : 'planned'
  const updated = await move(content, { from: ['cancelled'], to }, { approvedVersion: null, approvedAt: null, approvedBy: null })
  await event(req, content, { action: 'content.restored', message: `${currentUser(req).name} restored ${content.title}` })
  return updated
}

export const startProduction = async (req: Request, content: ContentDoc) => {
  const updated = await move(content, T.startProduction)
  await event(req, content, { action: 'content.production_started', message: `${currentUser(req).name} started production on ${content.title}` })
  return updated
}
