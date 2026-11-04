import type { Types } from 'mongoose'
import { registerJob } from '../../lib/jobs.ts'
import { PROVIDERS, type Metrics, type PlatformKey } from '../../lib/platforms/index.ts'
import { zonedToUtc } from '../../lib/time.ts'
import { ClientModel } from '../clients/client.model.ts'
import { ContentModel } from '../content/content.model.ts'
import { PublishJobModel } from '../content/publishJob.model.ts'
import { usableConnection } from '../publishing/connections.service.ts'
import { AnalyticsSnapshotModel } from './analytics.model.ts'

const COLLECT_FOR_DAYS = 90
const REFRESH_EVERY_MS = 12 * 3600_000

/** D58: engagements and engagement rate, or null when the platform doesn't provide the parts. */
export function derive(m: Metrics) {
  const parts = [m.likes, m.comments, m.shares, m.saves].filter((v): v is number => typeof v === 'number')
  const engagements = parts.length ? parts.reduce((a, b) => a + b, 0) : null
  const engagementRate = engagements != null && m.reach ? Math.round((engagements / m.reach) * 10_000) / 100 : null
  return { ...m, engagements, engagementRate }
}

/**
 * Collects fresh numbers for posts published through a connected account in the last 90 days, at most every
 * 12 hours each. Manual publishes have no API access, so they show "n/a".
 */
export async function collectAnalytics(limit = 200) {
  const since = new Date(Date.now() - COLLECT_FOR_DAYS * 86_400_000)
  const jobs = await PublishJobModel.find({ status: 'succeeded', 'account.kind': { $ne: 'manual' }, 'account.id': { $ne: null }, externalId: { $ne: '' }, finishedAt: { $gte: since } }).sort({ finishedAt: -1 }).limit(limit).lean()
  for (const job of jobs) {
    const last = await AnalyticsSnapshotModel.findOne({ content: job.content }, { collectedAt: 1 }).sort({ collectedAt: -1 }).lean()
    if (last && Date.now() - last.collectedAt.getTime() < REFRESH_EVERY_MS) continue
    try {
      const { provider, account } = await usableConnection(job.account!.id!)
      if (!provider.metrics) continue
      const m = derive(await provider.metrics(account, job.externalId))
      await AnalyticsSnapshotModel.create({ agency: job.agency, client: job.client, content: job.content, connection: job.account!.id, platform: job.account!.kind, externalId: job.externalId, metrics: m })
    } catch (err) {
      console.error(`Analytics for content ${job.content} failed:`, err instanceof Error ? err.message : err)
    }
  }
}

registerJob('analytics.collect', () => collectAnalytics())

/** Latest numbers per post, for content published in a period (client timezone, date-only bounds). */
export async function periodAnalytics(clientId: Types.ObjectId, from: string, to: string) {
  const client = await ClientModel.findById(clientId, { timezone: 1 }).lean()
  const tz = client?.timezone ?? 'UTC'
  const start = zonedToUtc(from, '00:00', tz)
  const end = new Date(zonedToUtc(to, '00:00', tz).getTime() + 86_400_000)
  const posts = await ContentModel.find({ client: clientId, state: 'published', publishedAt: { $gte: start, $lt: end }, deletedAt: null }, { title: 1, platform: 1, format: 1, publishedAt: 1, externalUrl: 1 }).lean()
  const latest = await AnalyticsSnapshotModel.aggregate([
    { $match: { content: { $in: posts.map((p) => p._id) } } },
    { $sort: { collectedAt: -1 } },
    { $group: { _id: '$content', metrics: { $first: '$metrics' }, collectedAt: { $first: '$collectedAt' } } },
  ])
  const rows = posts.map((p) => ({ ...p, metrics: latest.find((l) => String(l._id) === String(p._id))?.metrics ?? null }))

  const sum = (list: typeof rows, key: string) => {
    const vals = list.map((r) => r.metrics?.[key]).filter((v): v is number => typeof v === 'number')
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null
  }
  const totalsOf = (list: typeof rows) => {
    const t = Object.fromEntries(['impressions', 'reach', 'views', 'likes', 'comments', 'shares', 'saves', 'linkClicks', 'engagements'].map((k) => [k, sum(list, k)]))
    return { posts: list.length, ...t, engagementRate: t.engagements != null && t.reach ? Math.round(((t.engagements as number) / (t.reach as number)) * 10_000) / 100 : null }
  }
  const platforms = [...new Set(rows.map((r) => r.platform))].map((p) => ({ platform: p, label: PROVIDERS[p as PlatformKey]?.label ?? p, ...totalsOf(rows.filter((r) => r.platform === p)) }))
  const top = [...rows].filter((r) => r.metrics?.engagements != null).sort((a, b) => b.metrics.engagements - a.metrics.engagements).slice(0, 5)
  return { period: { from, to, timezone: tz }, totals: totalsOf(rows), platforms, topPosts: top, posts: rows }
}
