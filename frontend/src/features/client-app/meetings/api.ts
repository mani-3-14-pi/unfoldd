import { api } from '@/lib/api'

// Meetings as the client sees them (F57–F62): /api/client/meetings. Never the transcript (D23).

export interface ClientActionItem {
  _id: string
  text: string
  side: 'agency' | 'client'
  due: string
  /** For a client item: the request it became (Needed From You, D24). */
  request: string | null
}

export interface ClientMeeting {
  _id: string
  title: string
  startAt: string
  endAt: string
  platform: 'google_meet' | 'zoom' | 'teams' | 'phone' | 'in_person' | 'other'
  joinUrl: string
  location: string
  agenda: string
  status: 'scheduled' | 'completed' | 'cancelled'
  /** Only once the agency shares it; the transcript never reaches the client (D23). */
  summary: { text: string; decisions: string[]; actionItems: ClientActionItem[]; sharedAt: string } | null
}

export const clientMeetingsApi = {
  list: (when: 'upcoming' | 'past') => api<{ items: ClientMeeting[] }>(`/client/meetings?when=${when}`),
  get: (id: string) => api<{ meeting: ClientMeeting }>(`/client/meetings/${id}`),
}

export const meetingPlatformLabel: Record<ClientMeeting['platform'], string> = {
  google_meet: 'Google Meet',
  zoom: 'Zoom',
  teams: 'Microsoft Teams',
  phone: 'Phone',
  in_person: 'In person',
  other: 'Online',
}
