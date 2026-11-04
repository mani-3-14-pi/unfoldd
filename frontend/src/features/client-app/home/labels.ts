import type { Tone } from '@/components/ui/Pill'
import type { AttentionItem } from './api'

export const attentionTone: Record<AttentionItem['kind'], Tone> = { review: 'amber', plan: 'amber', request: 'blue' }

/** The client's own status labels (§6.2) as pill tones. */
export const bucketTone: Record<string, Tone> = {
  review_required: 'amber',
  in_progress: 'blue',
  changes_requested: 'red',
  approved: 'green',
  scheduled: 'green',
  published: 'green',
  cancelled: 'gray',
}

export const meetingPlatformLabel: Record<string, string> = {
  google_meet: 'Google Meet',
  zoom: 'Zoom',
  teams: 'Microsoft Teams',
  phone: 'Phone call',
  in_person: 'In person',
  other: 'Online',
}

/** "Sat 7 Nov" for a date-only value ("2026-11-07"), the same in every timezone. */
export const formatDay = (date: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${date.slice(0, 10)}T12:00:00Z`))

/** Today in the client's timezone, as "2026-11-04". */
export const todayIn = (tz: string, now: number) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now))
