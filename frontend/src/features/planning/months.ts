/** "2026-11" → "November 2026". Plan months are calendar months in the client's timezone. */
export const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })

/** The next `count` months starting with the current one, as "YYYY-MM", for a month picker. */
export function upcomingMonths(now: Date, count = 12) {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1))
    return d.toISOString().slice(0, 7)
  })
}
