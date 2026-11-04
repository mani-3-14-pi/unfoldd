import { api } from '@/lib/api'
import type { Page, UpdatedBy } from '@/types/api'

// Meetings (Flow 10, P103–P109): /api/meetings.

export const MEETING_STATUSES = ['scheduled', 'completed', 'cancelled'] as const
export type MeetingStatus = (typeof MEETING_STATUSES)[number]
export const MEETING_PLATFORMS = ['google_meet', 'zoom', 'teams', 'phone', 'in_person', 'other'] as const
export type MeetingPlatform = (typeof MEETING_PLATFORMS)[number]

/** D24: on share, an agency item becomes a task and a client item a request, exactly once. */
export interface ActionItem {
  _id?: string
  text: string
  side: 'agency' | 'client'
  assignee: string | null
  due: string
  task?: string | null
  request?: string | null
}

export interface Meeting {
  _id: string
  client: string
  title: string
  startAt: string
  endAt: string
  platform: MeetingPlatform
  joinUrl: string
  location: string
  agenda: string
  participants: { agency: string[]; client: string[] }
  campaign: string | null
  content: string[]
  status: MeetingStatus
  /** Internal only (D23). */
  transcript: string
  summary: {
    text: string
    decisions: string[]
    actionItems: ActionItem[]
    status: 'draft' | 'shared'
    sharedAt: string | null
    sharedBy?: { id: string; name: string }
  }
  rev: number
  updatedBy?: UpdatedBy
  createdAt: string
}

export interface MeetingInput {
  title: string
  startAt: string
  endAt: string
  platform: MeetingPlatform
  joinUrl: string
  location: string
  agenda: string
  participants: { agency: string[]; client: string[] }
  campaign: string | null
  content: string[]
}

export interface SummaryInput {
  text: string
  decisions: string[]
  actionItems: { text: string; side: 'agency' | 'client'; assignee: string | null; due: string }[]
}

export const meetingsApi = {
  list: (query: string) => api<Page<Meeting>>(`/meetings?${query}`),
  get: (id: string) => api<{ meeting: Meeting }>(`/meetings/${id}`),
  create: (body: MeetingInput & { client: string }, idempotencyKey: string) => api<{ meeting: Meeting }>('/meetings', { body, idempotencyKey }),
  update: (id: string, body: Partial<MeetingInput> & { rev: number }) => api<{ meeting: Meeting }>(`/meetings/${id}`, { method: 'PATCH', body }),
  action: (id: string, action: 'complete' | 'cancel') => api<{ meeting: Meeting }>(`/meetings/${id}/${action}`, { method: 'POST' }),
  transcript: (id: string, transcript: string) => api<{ meeting: Meeting }>(`/meetings/${id}/transcript`, { method: 'PUT', body: { transcript } }),
  summary: (id: string, body: SummaryInput) => api<{ meeting: Meeting }>(`/meetings/${id}/summary`, { method: 'PUT', body }),
  share: (id: string, idempotencyKey: string) => api<{ meeting: Meeting }>(`/meetings/${id}/share`, { method: 'POST', idempotencyKey }),
}

export const meetingKey = (id: string) => ['agency', 'meetings', 'detail', id]
