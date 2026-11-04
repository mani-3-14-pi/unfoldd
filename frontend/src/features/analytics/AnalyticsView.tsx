import { ExternalLink } from 'lucide-react'
import { Link } from 'react-router'
import { Card, EmptyState } from '@/components/ui/Card'
import { formatDate } from '@/lib/format'
import type { Analytics, AnalyticsPost, Totals } from './api'
import { formatMetric, METRICS } from './labels'

/** The headline numbers for a period: hero tiles, "n/a" where no platform reports the metric. */
export function TotalsGrid({ totals }: { totals: Totals }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-7">
      <Tile label="Posts published" value={totals.posts.toLocaleString()} />
      {METRICS.map((m) => (
        <Tile key={m.key} label={m.label} value={formatMetric(m.key, totals[m.key], { compact: true })} hint={m.hint} muted={totals[m.key] == null} />
      ))}
    </div>
  )
}

function Tile({ label, value, hint, muted }: { label: string; value: string; hint?: string; muted?: boolean }) {
  return (
    <article className="rounded-xl border border-border bg-surface px-4 py-3" title={hint}>
      <div className="text-xs text-text-3">{label}</div>
      <div className={muted ? 'mt-1 text-xl font-semibold text-text-4' : 'mt-1 text-2xl font-semibold tracking-tight'}>{value}</div>
    </article>
  )
}

/**
 * Engagements per platform as one series of thin horizontal bars (one hue, so no legend; the platform name labels
 * each bar), with every metric in the table underneath, so nothing is read from colour alone.
 */
export function PlatformBreakdown({ platforms }: { platforms: Analytics['platforms'] }) {
  if (platforms.length === 0) return null
  const max = Math.max(...platforms.map((p) => p.engagements ?? 0), 1)
  return (
    <Card title="By platform" description="Engagements per platform. The table has every metric.">
      <div className="flex flex-col gap-2.5 px-5 py-4" role="img" aria-label="Engagements by platform">
        {platforms.map((p) => (
          <div key={p.platform} className="grid grid-cols-[120px_1fr_72px] items-center gap-3 text-[13px]">
            <span className="truncate text-text-2">{p.label}</span>
            <div className="h-3 rounded-full bg-surface-input">
              {p.engagements != null && (
                <div
                  className="h-full rounded-full bg-brand transition-[width]"
                  style={{ width: `${Math.max(2, (p.engagements / max) * 100)}%` }}
                  title={`${p.label}: ${formatMetric('engagements', p.engagements)} engagements from ${p.posts} posts`}
                />
              )}
            </div>
            <span className="text-right tabular-nums">{formatMetric('engagements', p.engagements, { compact: true })}</span>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto border-t border-border">
        <table className="w-full min-w-[640px] text-left text-[13px]">
          <thead>
            <tr className="text-[11px] text-text-3">
              <th scope="col" className="px-5 py-2.5 font-normal">Platform</th>
              <th scope="col" className="px-3 py-2.5 text-right font-normal">Posts</th>
              {METRICS.map((m) => (
                <th key={m.key} scope="col" className="px-3 py-2.5 text-right font-normal">
                  {m.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {platforms.map((p) => (
              <tr key={p.platform} className="border-t border-border">
                <th scope="row" className="px-5 py-2.5 font-medium">
                  {p.label}
                </th>
                <td className="px-3 py-2.5 text-right tabular-nums">{p.posts}</td>
                {METRICS.map((m) => (
                  <td key={m.key} className={p[m.key] == null ? 'px-3 py-2.5 text-right text-text-4' : 'px-3 py-2.5 text-right tabular-nums'}>
                    {formatMetric(m.key, p[m.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

/** The best posts of the period by engagements. */
export function TopPosts({ posts, linkContent = true }: { posts: AnalyticsPost[]; linkContent?: boolean }) {
  return (
    <Card title="Top posts" description="Most engagements in the period.">
      {posts.length === 0 ? (
        <EmptyState title="No numbers yet">Posts published through a connected account get numbers within a day. Manually published posts show n/a.</EmptyState>
      ) : (
        <ol className="divide-y divide-border">
          {posts.map((p, i) => (
            <li key={p._id} className="flex items-center gap-4 px-5 py-3">
              <span className="w-5 text-center text-xs text-text-4">{i + 1}</span>
              <div className="min-w-0 flex-1">
                {linkContent ? (
                  <Link to={`/app/content/${p._id}`} className="block truncate text-[13px] font-semibold hover:underline">
                    {p.title}
                  </Link>
                ) : (
                  <span className="block truncate text-[13px] font-semibold">{p.title}</span>
                )}
                <span className="text-xs text-text-3">
                  {p.platform} · published {formatDate(p.publishedAt)}
                </span>
              </div>
              <div className="hidden gap-5 text-right text-xs sm:flex">
                <Metric label="Reach" value={formatMetric('reach', p.metrics?.reach, { compact: true })} />
                <Metric label="Engagements" value={formatMetric('engagements', p.metrics?.engagements, { compact: true })} />
                <Metric label="Rate" value={formatMetric('engagementRate', p.metrics?.engagementRate)} />
              </div>
              {p.externalUrl && (
                <a href={p.externalUrl} target="_blank" rel="noreferrer" aria-label={`Open ${p.title} on the platform`} className="grid size-8 place-items-center rounded-lg text-text-3 hover:bg-black/5">
                  <ExternalLink size={15} />
                </a>
              )}
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-text-4">{label}</div>
      <div className="font-medium tabular-nums">{value}</div>
    </div>
  )
}
