import type { Metrics } from './api'

/** The headline metrics, in the order they're shown (D58). */
export const METRICS: { key: keyof Metrics; label: string; hint: string }[] = [
  { key: 'impressions', label: 'Impressions', hint: 'Times the posts were shown' },
  { key: 'reach', label: 'Reach', hint: 'Accounts that saw them' },
  { key: 'views', label: 'Views', hint: 'Video views' },
  { key: 'engagements', label: 'Engagements', hint: 'Likes + comments + shares + saves' },
  { key: 'engagementRate', label: 'Engagement rate', hint: 'Engagements ÷ reach' },
  { key: 'linkClicks', label: 'Link clicks', hint: 'Where the platform reports them' },
]

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
const whole = new Intl.NumberFormat('en')

/** A metric for display: "n/a" when the platform doesn't give it, a percentage for the rate. */
export function formatMetric(key: keyof Metrics, value: number | null | undefined, opts: { compact?: boolean } = {}) {
  if (value == null) return 'n/a'
  if (key === 'engagementRate') return `${value.toLocaleString('en', { maximumFractionDigits: 2 })}%`
  return opts.compact ? compact.format(value) : whole.format(value)
}

/** "2026-11-04" in the browser's own calendar. */
export const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** The default period: the last 30 days. Call it from an event or a state initializer, not during render. */
export const defaultPeriod = () => {
  const p = periodPresets(new Date())[0]!
  return { from: p.from, to: p.to }
}

/** Quick periods for the pickers, relative to `today`. */
export function periodPresets(today: Date) {
  const daysAgo = (n: number) => isoDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - n))
  const monthStart = (offset: number) => new Date(today.getFullYear(), today.getMonth() + offset, 1)
  const monthEnd = (offset: number) => new Date(today.getFullYear(), today.getMonth() + offset + 1, 0)
  return [
    { key: '30d', label: 'Last 30 days', from: daysAgo(29), to: isoDate(today) },
    { key: '90d', label: 'Last 90 days', from: daysAgo(89), to: isoDate(today) },
    { key: 'month', label: 'This month', from: isoDate(monthStart(0)), to: isoDate(today) },
    { key: 'last_month', label: 'Last month', from: isoDate(monthStart(-1)), to: isoDate(monthEnd(-1)) },
  ]
}
