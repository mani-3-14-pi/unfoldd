// Calendar maths on plain `YYYY-MM-DD` keys, so a day is a day whatever the viewer's timezone does.

export type View = 'month' | 'week' | 'day'

const pad = (n: number) => String(n).padStart(2, '0')

/** A Date (in the viewer's zone) → "2026-11-04". */
export const keyOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** "2026-11-04" → local midnight of that day. */
export const dateOf = (key: string) => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y!, m! - 1, d!)
}

export const addDays = (key: string, n: number) => {
  const d = dateOf(key)
  d.setDate(d.getDate() + n)
  return keyOf(d)
}

/** The day an instant falls on in a timezone: publish times live on the client's clock (D59). */
export const keyIn = (iso: string, tz: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))

export const timeIn = (iso: string, tz: string) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

/** Monday of the week the day is in. */
export const weekStart = (key: string) => {
  const d = dateOf(key)
  return addDays(key, -((d.getDay() + 6) % 7))
}

/** The days a view shows: the month's weeks (Monday first), one week, or one day. */
export function daysFor(view: View, anchor: string): string[] {
  if (view === 'day') return [anchor]
  if (view === 'week') return Array.from({ length: 7 }, (_, i) => addDays(weekStart(anchor), i))
  const first = `${anchor.slice(0, 7)}-01`
  const start = weekStart(first)
  const next = dateOf(first)
  next.setMonth(next.getMonth() + 1)
  const end = addDays(weekStart(addDays(keyOf(next), -1)), 6)
  const days: string[] = []
  for (let k = start; k <= end; k = addDays(k, 1)) days.push(k)
  return days
}

/** Moves the anchor by one view's length. */
export function shift(view: View, anchor: string, by: 1 | -1) {
  if (view === 'day') return addDays(anchor, by)
  if (view === 'week') return addDays(anchor, 7 * by)
  const d = dateOf(`${anchor.slice(0, 7)}-01`)
  d.setMonth(d.getMonth() + by)
  return keyOf(d)
}

export function titleFor(view: View, anchor: string) {
  const d = dateOf(anchor)
  if (view === 'month') return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(d)
  if (view === 'day') return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d)
  const days = daysFor('week', anchor)
  const fmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })
  return `${fmt.format(dateOf(days[0]!))} – ${fmt.format(dateOf(days[6]!))} ${dateOf(days[6]!).getFullYear()}`
}
