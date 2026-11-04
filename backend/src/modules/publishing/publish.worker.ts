import type { Types } from 'mongoose'
import { logActivity } from '../../lib/activity.ts'
import { enqueue, registerJob, releaseKey } from '../../lib/jobs.ts'
import { notify } from '../../lib/notify.ts'
import { PublishError, type MediaItem } from '../../lib/platforms/index.ts'
import { presignDownload } from '../../lib/storage.ts'
import { clientPeople, contentTeam, publishers } from '../content/content.recipients.ts'
import { ContentModel } from '../content/content.model.ts'
import type { ContentDoc } from '../content/content.service.ts'
import { PublishJobModel } from '../content/publishJob.model.ts'
import { VersionModel } from '../content/version.model.ts'
import { FileModel } from '../files/file.model.ts'
import { ConnectionModel } from './connection.model.ts'
import { markBroken, usableConnection } from './connections.service.ts'

/*
 * The publish worker (Flow 8, step 4; D27, D78, D79). At publish time:
 *   1. claim `scheduled → publishing` atomically (if that fails, someone moved it: stop);
 *   2. post the APPROVED version (never "latest");
 *   3. success → published with the external id and link;
 *      nothing was posted yet → back to scheduled and try again (up to 3 times);
 *      the platform refused → back to scheduled, job failed, a person fixes it;
 *      no answer after sending → back to scheduled, job `unknown`, never retried automatically.
 * The external id is stored before anything else, so a post is never published twice.
 */

const MAX_TRIES = 3
const MEDIA_URL_TTL_S = 6 * 3600

export const publishKey = (contentId: Types.ObjectId | string) => `publish:${contentId}`

/** Queues the publish for the content's publish date. Re-queuing replaces nothing: the key keeps it single. */
export const queuePublish = (contentId: Types.ObjectId, at: Date) => enqueue('publish.run', { content: String(contentId) }, { runAt: at, uniqueKey: publishKey(contentId), maxAttempts: 1 })

async function mediaOf(versionId: Types.ObjectId): Promise<MediaItem[]> {
  const version = await VersionModel.findById(versionId).lean()
  if (!version) throw new PublishError('failed', 'The approved version no longer exists.')
  const files = await FileModel.find({ _id: { $in: version.files.map((f) => f.file) } }).lean()
  const items: MediaItem[] = []
  for (const vf of version.files) {
    const f = files.find((x) => String(x._id) === String(vf.file))
    if (!f || f.status !== 'ready') throw new PublishError('failed', 'A file of the approved version is missing.')
    // Platforms fetch from this URL, sometimes minutes later (video processing).
    items.push({ url: (await presignDownload(f.key, f, { inline: true, expiresInS: MEDIA_URL_TTL_S })).url, mimeType: f.mimeType, size: f.size, name: f.name })
  }
  return items
}

async function alert(content: ContentDoc, event: string, title: string, body: string) {
  await notify({
    recipients: [...(await publishers(content)), ...(await contentTeam(content))],
    audience: 'agency',
    agency: content.agency,
    client: content.client,
    category: 'publishing',
    event,
    title,
    body,
    entity: { type: 'content', id: content._id },
    link: `/app/content/${content._id}`,
    urgent: true,
  })
}

registerJob('publish.run', async ({ content: id }) => {
  const job = await PublishJobModel.findOne({ content: id, status: 'queued', 'account.kind': { $ne: 'manual' } }).lean()
  if (!job) return
  // 1. The lock. Only the approved version, and only if it's still scheduled.
  const content = (await ContentModel.findOneAndUpdate(
    { _id: id, state: 'scheduled', approvedVersion: job.version, deletedAt: null, publishDate: { $lte: new Date() } },
    { $set: { state: 'publishing', stateChangedAt: new Date() } },
    { returnDocument: 'after' },
  ).lean()) as ContentDoc | null
  if (!content) return
  await PublishJobModel.updateOne({ _id: job._id }, { $set: { status: 'running' }, $inc: { attempts: 1 } })
  const attempt = job.attempts + 1
  const backToScheduled = () => ContentModel.updateOne({ _id: content._id, state: 'publishing' }, { $set: { state: 'scheduled', stateChangedAt: new Date() } })

  try {
    // Everything before provider.publish happens before anything is sent: its errors are never "unknown".
    const prepared = await (async () => {
      const version = await VersionModel.findById(job.version).lean()
      const { provider, account } = await usableConnection(job.account!.id!)
      if (!provider.formats.includes(content.format)) throw new PublishError('failed', `${provider.label} can’t publish the ${content.format} format here. Publish it by hand.`)
      const media = await mediaOf(job.version)
      return { provider, account, post: { format: content.format, caption: version?.caption ?? '', hashtags: version?.hashtags ?? [], title: content.title, media } }
    })().catch((err) => {
      throw err instanceof PublishError ? err : new PublishError('failed', err instanceof Error ? err.message : String(err))
    })
    const { provider } = prepared
    const result = await provider.publish(prepared.account, prepared.post)
    const now = new Date()
    await PublishJobModel.updateOne({ _id: job._id }, { $set: { status: 'succeeded', externalId: result.externalId, externalUrl: result.url, error: '', finishedAt: now } })
    await ContentModel.updateOne(
      { _id: content._id, state: 'publishing' },
      { $set: { state: 'published', stateChangedAt: now, publishedAt: now, externalPostId: result.externalId, externalUrl: result.url, publishedBy: { name: provider.label } } },
    )
    const e = await logActivity(null, {
      action: 'content.published',
      message: `${content.title} was published to ${provider.label}`,
      agency: content.agency,
      client: content.client,
      visibility: 'client',
      target: { type: 'content', id: content._id, label: content.title },
      meta: { url: result.url },
      actor: { type: 'system', name: 'Publisher' },
    })
    await notify({
      recipients: await clientPeople(content.client),
      audience: 'client',
      agency: content.agency,
      client: content.client,
      category: 'publishing',
      event: 'content.published',
      title: `${content.title} is live`,
      entity: { type: 'content', id: content._id },
      link: `/c/content/${content._id}`,
      activity: e?._id,
    })
  } catch (err) {
    const pe = err instanceof PublishError ? err : new PublishError('unknown', err instanceof Error ? err.message : String(err))
    await backToScheduled()
    if (pe.kind === 'retryable' && attempt < MAX_TRIES) {
      await PublishJobModel.updateOne({ _id: job._id }, { $set: { status: 'queued', error: pe.message } })
      await releaseKey(publishKey(content._id))
      await queuePublish(content._id, new Date(Date.now() + attempt * 5 * 60_000))
      return
    }
    const status = pe.kind === 'unknown' ? 'unknown' : 'failed'
    await PublishJobModel.updateOne({ _id: job._id }, { $set: { status, error: pe.message, finishedAt: new Date() } })
    if (pe.kind === 'auth') await markBroken(job.account!.id!, 'expired', pe.message)
    await logActivity(null, {
      action: status === 'unknown' ? 'publish.unknown' : 'publish.failed',
      message: `Publishing ${content.title} ${status === 'unknown' ? 'may or may not have gone through' : 'failed'}: ${pe.message}`,
      agency: content.agency,
      client: content.client,
      target: { type: 'content', id: content._id, label: content.title },
      actor: { type: 'system', name: 'Publisher' },
    })
    await alert(
      content,
      status === 'unknown' ? 'publish.unknown' : 'publish.failed',
      status === 'unknown' ? `Check ${content.title}: we don’t know if it was posted` : `Publishing ${content.title} failed`,
      status === 'unknown' ? 'Look at the account. If it’s live, mark it published with the link; if not, retry.' : pe.message,
    )
  }
})

/** D27: 24 hours ahead, check every connection that's about to publish, so there's time to reconnect. */
registerJob('connections.health', async () => {
  const soon = await ContentModel.find({ state: 'scheduled', publishDate: { $lte: new Date(Date.now() + 24 * 3600_000) }, deletedAt: null }, { _id: 1 }).lean()
  const jobs = await PublishJobModel.find({ content: { $in: soon.map((c) => c._id) }, status: 'queued', 'account.kind': { $ne: 'manual' } }, { account: 1 }).lean()
  const ids = [...new Set(jobs.map((j) => String(j.account?.id)).filter(Boolean))]
  for (const id of ids) {
    const conn = await ConnectionModel.findOne({ _id: id, status: 'active', $or: [{ lastCheckedAt: null }, { lastCheckedAt: { $lt: new Date(Date.now() - 6 * 3600_000) } }] }, { _id: 1 }).lean()
    if (!conn) continue
    try {
      const { provider, account } = await usableConnection(conn._id)
      await provider.check(account)
      await ConnectionModel.updateOne({ _id: conn._id }, { $set: { lastCheckedAt: new Date(), lastError: '' } })
    } catch (err) {
      await ConnectionModel.updateOne({ _id: conn._id }, { $set: { lastCheckedAt: new Date() } })
      await markBroken(conn._id, err instanceof PublishError && err.kind === 'auth' ? 'expired' : 'error', err instanceof Error ? err.message : String(err))
    }
  }
})
