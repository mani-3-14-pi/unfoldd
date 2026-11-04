import type { Types } from 'mongoose'
import { logActivity } from '../../lib/activity.ts'
import { AiPermanentError, checklistProvider, type FeedbackForAi } from '../../lib/ai.ts'
import { notify } from '../../lib/notify.ts'
import { contentTeam } from '../content/content.recipients.ts'
import { ContentModel } from '../content/content.model.ts'
import { VersionModel } from '../content/version.model.ts'
import { MessageModel } from '../feedback/message.model.ts'
import { ThreadModel } from '../feedback/thread.model.ts'
import { TaskModel } from '../tasks/task.model.ts'
import { ChecklistItemModel, ChecklistRunModel } from './checklist.model.ts'

const MAX_ATTEMPTS = 3
const LEASE_MS = 5 * 60_000

/**
 * Queues an AI pass over a version's client feedback (D21). Never blocks the caller and never throws:
 * if AI is off the run is recorded as `skipped`, so the portal can say so.
 */
export async function queueChecklist(
  content: { _id: Types.ObjectId; agency: Types.ObjectId; client: Types.ObjectId },
  versionId: Types.ObjectId,
  by?: { _id: Types.ObjectId; name: string },
) {
  try {
    const pending = await ChecklistRunModel.findOne({ content: content._id, version: versionId, status: { $in: ['queued', 'running'] } }).lean()
    if (pending) return pending
    return await ChecklistRunModel.create({
      agency: content.agency,
      client: content.client,
      content: content._id,
      version: versionId,
      status: checklistProvider() ? 'queued' : 'skipped',
      error: checklistProvider() ? '' : 'AI is switched off. Add ANTHROPIC_API_KEY to turn it on.',
      requestedBy: by ? { id: by._id, name: by.name } : undefined,
    })
  } catch (err) {
    console.error('Failed to queue checklist run', err)
    return null
  }
}

/** Where a feedback item points, in words the model can use. */
function describeAnchor(anchor: any, files: { _id: Types.ObjectId }[]) {
  const parts: string[] = []
  const index = anchor?.versionFile ? files.findIndex((f) => String(f._id) === String(anchor.versionFile)) : -1
  if (index >= 0 && files.length > 1) parts.push(`slide ${index + 1}`)
  if (anchor?.timeMs != null) {
    const s = Math.floor(anchor.timeMs / 1000)
    parts.push(`at ${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`)
  }
  if (anchor?.shapes?.length) parts.push(`with ${anchor.shapes.length} annotation mark${anchor.shapes.length === 1 ? '' : 's'}`)
  return parts.join(', ')
}

/** Runs one claimed job. Raw feedback is already saved; this only adds suggestions. */
async function runOne(runId: Types.ObjectId) {
  const run = await ChecklistRunModel.findById(runId).lean()
  if (!run) return
  const provider = checklistProvider()
  if (!provider) {
    await ChecklistRunModel.updateOne({ _id: run._id }, { $set: { status: 'skipped', error: 'AI is switched off.', finishedAt: new Date() } })
    return
  }
  const [content, version] = await Promise.all([ContentModel.findById(run.content).lean(), VersionModel.findById(run.version).lean()])
  if (!content || !version) {
    await ChecklistRunModel.updateOne({ _id: run._id }, { $set: { status: 'failed', error: 'The content or version no longer exists.', finishedAt: new Date() } })
    return
  }

  const threads = await ThreadModel.find(
    { version: version._id, visibility: 'client', kind: 'feedback', submittedAt: { $ne: null }, status: { $ne: 'resolved' }, deletedAt: null },
    { pin: 1, anchor: 1 },
  )
    .sort({ pin: 1 })
    .lean()
  const messages = await MessageModel.find({ thread: { $in: threads.map((t) => t._id) }, 'author.side': 'client', deletedAt: null }).sort({ createdAt: 1 }).lean()
  const feedback: FeedbackForAi[] = threads
    .map((t) => {
      const text = messages
        .filter((m) => String(m.thread) === String(t._id))
        // Voice notes count once their transcript exists (D22); until then the item is text-only.
        .map((m) => [m.body, m.voice?.transcriptStatus === 'done' ? m.voice.transcript : ''].filter(Boolean).join('\n'))
        .filter(Boolean)
        .join('\n')
      return { pin: t.pin!, text, where: describeAnchor(t.anchor, version.files) }
    })
    .filter((f) => f.text)

  if (!feedback.length) {
    await ChecklistRunModel.updateOne({ _id: run._id }, { $set: { status: 'done', suggestions: 0, provider: provider.name, finishedAt: new Date() } })
    return
  }

  try {
    const result = await provider.suggest({
      contentTitle: content.title,
      platform: content.platform,
      format: content.format,
      versionNumber: version.number,
      caption: version.caption,
      feedback,
    })
    const byPin = new Map(threads.map((t) => [t.pin, t._id]))
    const items = result.items
      .map((item, i) => ({
        agency: run.agency,
        client: run.client,
        content: run.content,
        version: run.version,
        versionNumber: version.number,
        text: item.text.trim().slice(0, 1000),
        suggestedText: item.text.trim().slice(0, 1000),
        sourceThreads: [...new Set(item.sourcePins)].map((p) => byPin.get(p)).filter(Boolean),
        origin: 'ai',
        status: 'suggested',
        run: run._id,
        order: i,
      }))
      .filter((i) => i.text)
    // A re-run replaces the earlier suggestions nobody has acted on; accepted and removed ones stay.
    await ChecklistItemModel.deleteMany({ version: run.version, origin: 'ai', status: 'suggested' })
    await ChecklistItemModel.insertMany(items)
    await ChecklistRunModel.updateOne(
      { _id: run._id },
      { $set: { status: 'done', suggestions: items.length, provider: provider.name, model: result.model, usage: result.usage, error: '', finishedAt: new Date() } },
    )
    if (items.length) {
      const e = await logActivity(null, {
        action: 'checklist.suggested',
        message: `AI found ${items.length} actionable change${items.length === 1 ? '' : 's'} in the feedback on ${content.title}`,
        agency: content.agency,
        client: content.client,
        target: { type: 'content', id: content._id, label: content.title },
        actor: { type: 'system', name: 'AI assistant' },
      })
      await notify({
        recipients: await contentTeam(content),
        audience: 'agency',
        agency: content.agency,
        client: content.client,
        category: 'feedback',
        event: 'checklist.suggested',
        title: `We found ${items.length} actionable change${items.length === 1 ? '' : 's'} on ${content.title}`,
        body: 'Review the suggestions and accept the ones that belong on the revision checklist.',
        entity: { type: 'content', id: content._id },
        link: `/app/content/${content._id}`,
        activity: e?._id,
      })
    }
  } catch (err) {
    const permanent = err instanceof AiPermanentError || run.attempts >= MAX_ATTEMPTS
    const message = err instanceof Error ? err.message : String(err)
    console.error(`Checklist run ${run._id} failed${permanent ? '' : ', will retry'}:`, message)
    await ChecklistRunModel.updateOne(
      { _id: run._id },
      permanent
        ? { $set: { status: 'failed', error: message.slice(0, 500), finishedAt: new Date() } }
        : { $set: { status: 'queued', error: message.slice(0, 500), runAfter: new Date(Date.now() + 2 ** run.attempts * 60_000), leaseUntil: null } },
    )
  }
}

/** Claims and runs queued jobs (and ones whose worker died mid-run), one at a time. */
export async function processChecklistRuns(limit = 10) {
  for (let i = 0; i < limit; i++) {
    const now = new Date()
    const run = await ChecklistRunModel.findOneAndUpdate(
      { $or: [{ status: 'queued', runAfter: { $lte: now } }, { status: 'running', leaseUntil: { $lt: now } }] },
      { $set: { status: 'running', leaseUntil: new Date(now.getTime() + LEASE_MS) }, $inc: { attempts: 1 } },
      { sort: { runAfter: 1 }, returnDocument: 'after' },
    ).lean()
    if (!run) return
    await runOne(run._id)
  }
}

/**
 * The client's view of a checklist item: done once its task is done, or once every feedback item it came from
 * was resolved. Derived on read, never stored (rule §12.12).
 */
export async function withDone<T extends { task?: Types.ObjectId | null; sourceThreads: Types.ObjectId[] }>(items: T[]) {
  const [tasks, threads] = await Promise.all([
    TaskModel.find({ _id: { $in: items.map((i) => i.task).filter(Boolean) } }, { status: 1 }).lean(),
    ThreadModel.find({ _id: { $in: items.flatMap((i) => i.sourceThreads) } }, { status: 1, closedOnApproval: 1 }).lean(),
  ])
  return items.map((item) => {
    const task = tasks.find((t) => String(t._id) === String(item.task))
    const sources = threads.filter((t) => item.sourceThreads.some((s) => String(s) === String(t._id)))
    const resolved = sources.length > 0 && sources.every((t) => t.status === 'resolved' && !t.closedOnApproval)
    return { ...item, done: task?.status === 'done' || resolved }
  })
}
