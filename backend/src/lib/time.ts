import { z } from 'zod'

// Rule §12.8 / D59: store UTC. Publish times and date-only fields are in the client's timezone.

export function isTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export const timezoneSchema = z.string().trim().refine(isTimezone, 'Unknown timezone')

/** A calendar date with no time (due dates, start dates). Stored as the `YYYY-MM-DD` string, never as a Date. */
export const dateOnlySchema = z.iso.date()

/** Minutes the zone is ahead of UTC at that instant. */
function offsetMinutes(at: Date, tz: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at)
  const n = (type: string) => Number(parts.find((p) => p.type === type)!.value)
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'))
  return Math.round((asUtc - at.getTime()) / 60_000)
}

/** `2026-11-04` at `10:30` in `Asia/Kolkata` → that instant in UTC. */
export function zonedToUtc(date: string, time: string, tz: string) {
  const naive = new Date(`${date}T${time.length === 5 ? `${time}:00` : time}.000Z`)
  // A second pass fixes instants right next to a DST change.
  const first = new Date(naive.getTime() - offsetMinutes(naive, tz) * 60_000)
  return new Date(naive.getTime() - offsetMinutes(first, tz) * 60_000)
}

/** The calendar date (`YYYY-MM-DD`) of an instant in a timezone. */
export function dateIn(at: Date, tz: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
}

export const todayIn = (tz: string) => dateIn(new Date(), tz)
