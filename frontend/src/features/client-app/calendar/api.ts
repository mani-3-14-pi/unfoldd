import { api } from '@/lib/api'

// The client's calendar (D31/D32): /api/client/calendar. Content they can see, meetings and request due dates,
// each with its day already worked out in the client's timezone.

interface Base {
  id: string
  title: string
  /** "YYYY-MM-DD" in the client's timezone. */
  date: string
  link: string
}

export type ClientCalendarEvent =
  | (Base & { layer: 'content'; at: string; status: { bucket: string | null; label: string; delayed: boolean }; platform: string; shiftedDays: number })
  | (Base & { layer: 'meetings'; at: string; endAt: string; joinUrl: string })
  | (Base & { layer: 'requests'; allDay: true; label: string })

export const clientCalendarApi = {
  /** Up to 62 days at a time. */
  range: (from: string, to: string) => api<{ timezone: string; events: ClientCalendarEvent[] }>(`/client/calendar?${new URLSearchParams({ from, to })}`),
}
