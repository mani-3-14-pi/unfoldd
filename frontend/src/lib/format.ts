const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const dateTimeFmt = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})
const relativeFmt = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

export const formatDate = (value?: string | null) => (value ? dateFmt.format(new Date(value)) : '—')
export const formatDateTime = (value?: string | null) => (value ? dateTimeFmt.format(new Date(value)) : '—')

/** "3 hours ago", "yesterday", "in 5 days". */
export function timeAgo(value?: string | null) {
  if (!value) return '—'
  const seconds = (new Date(value).getTime() - Date.now()) / 1000
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ]
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return relativeFmt.format(Math.round(seconds / size), unit)
  }
  return 'just now'
}

/** "2026-11-03" for <input type="date"> and API date filters. */
export const toDateInput = (value?: string | null) => (value ? new Date(value).toISOString().slice(0, 10) : '')

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')

export const plural = (n: number, one: string, many = /[^aeiou]y$/.test(one) ? `${one.slice(0, -1)}ies` : `${one}s`) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`
