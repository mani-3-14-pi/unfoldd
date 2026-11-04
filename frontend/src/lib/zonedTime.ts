// Publish times live in the client's timezone (D59): the audience's clock, not the viewer's.
// The API stores UTC; these turn it into and out of the `<input type="datetime-local">` value for a given zone.

/** Minutes the zone is ahead of UTC at that instant. */
function offsetMinutes(at: Date, tz: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  )
  const asUtc = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!)
  return Math.round((asUtc - at.getTime()) / 60_000)
}

/** "2026-11-08T19:00" in `tz` → an ISO instant. */
export function zonedInputToIso(local: string, tz: string) {
  const guess = new Date(`${local}:00Z`)
  // Two passes settle the offset across a daylight-saving change.
  let utc = guess.getTime() - offsetMinutes(guess, tz) * 60_000
  utc = guess.getTime() - offsetMinutes(new Date(utc), tz) * 60_000
  return new Date(utc).toISOString()
}

/** An ISO instant → "2026-11-08T19:00" in `tz`, for a datetime-local input. */
export function isoToZonedInput(iso: string | null | undefined, tz: string) {
  if (!iso) return ''
  const at = new Date(iso)
  return new Date(at.getTime() + offsetMinutes(at, tz) * 60_000).toISOString().slice(0, 16)
}

const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone

/** "Sun 8 Nov, 19:00" in the client's zone, with the viewer's own time added when it differs. */
export function formatInZone(iso: string | null | undefined, tz: string, opts: { withViewer?: boolean } = { withViewer: true }) {
  if (!iso) return '—'
  const fmt = (zone: string) =>
    new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
  const there = fmt(tz)
  if (!opts.withViewer) return there
  const here = fmt(viewerTz)
  return here === there ? there : `${there} (${here} your time)`
}
