import { api } from '@/lib/api'
import type { ContentState, Format, Platform } from '@/features/content/api'

// The agency's operational calendar (P94–P98, D31): /api/calendar. Up to 62 days per request.

export const LAYERS = ['content', 'tasks', 'requests', 'plans', 'meetings'] as const
export type Layer = (typeof LAYERS)[number]

interface EventBase {
  id: string
  title: string
  client: { id: string; brandName?: string }
  link: string
}

/** A timed event: content publish times and meetings. */
export interface TimedEvent extends EventBase {
  layer: 'content' | 'meetings'
  at: string
  endAt?: string
  allDay: false
  state?: ContentState
  status?: string
  platform?: Platform
  format?: Format
  risk?: { atRisk: boolean; overdueForApproval: boolean; slotMissed: boolean; publishFailed: boolean }
}

/** A date-only event: task and request due dates, plan months (`YYYY-MM-DD`). */
export interface DayEvent extends EventBase {
  layer: 'tasks' | 'requests' | 'plans'
  date: string
  allDay: true
  status: string
  blocked?: boolean
}

export type CalendarEvent = TimedEvent | DayEvent

export const calendarApi = {
  range: (query: string) => api<{ from: string; to: string; events: CalendarEvent[] }>(`/calendar?${query}`),
}
