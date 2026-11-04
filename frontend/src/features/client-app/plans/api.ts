import { api } from '@/lib/api'
import type { Format, Platform } from '@/features/content/api'

// Content plans in the Client App (F46/F47, D33/D34/D80): /api/client/plans.

export type PlanStatus = 'sent' | 'approved' | 'changes_requested'

export interface ClientPlanRow {
  id: string
  month: string
  status: PlanStatus
  /** "Review Required", "Approved", "Changes Requested" (D63). */
  label: string
  sentAt: string | null
  decidedAt: string | null
}

/** A plan item: a content row still in planning (D33). */
export interface PlanItem {
  _id: string
  title: string
  platform: Platform
  format: Format
  idea: string
  concept: string
  objective: string
  publishDate: string | null
  /** Work on it has started (it left the `planned` state). */
  inProduction: boolean
  campaign: string | null
  /** D34: changed after the plan was approved. */
  updatedSinceApproval: boolean
}

export interface PlanMessage {
  _id: string
  author: { id: string; name: string; side: 'agency' | 'client' }
  body: string
  createdAt: string
}

export interface PlanThread {
  _id: string
  /** The item it's about, or null for the whole plan. */
  content: string | null
  status: 'open' | 'in_progress' | 'resolved' | null
  author: { id: string; name: string; side: 'agency' | 'client' }
  submittedAt: string | null
  /** Unsent: only its author sees it (D14). */
  draft: boolean
  messages: PlanMessage[]
  createdAt: string
}

export interface ClientPlan {
  id: string
  month: string
  status: PlanStatus
  label: string
  sentAt: string | null
  decided: { by?: string; at: string } | null
  items: PlanItem[]
  threads: PlanThread[]
  can: { comment: boolean; decide: boolean }
}

export const clientPlansApi = {
  list: () => api<{ items: ClientPlanRow[] }>('/client/plans'),
  get: (id: string) => api<{ plan: ClientPlan }>(`/client/plans/${id}`),
  comment: (id: string, body: { body: string; item?: string }, idempotencyKey: string) =>
    api<{ thread: PlanThread }>(`/client/plans/${id}/threads`, { body, idempotencyKey }),
  discard: (id: string, threadId: string) => api<void>(`/client/plans/${id}/threads/${threadId}`, { method: 'DELETE' }),
  reply: (id: string, threadId: string, body: string) => api<unknown>(`/client/plans/${id}/threads/${threadId}/messages`, { body: { body } }),
  sendComments: (id: string) => api<{ submitted: number }>(`/client/plans/${id}/review/submit`, { method: 'POST' }),
  /** `confirm` goes ahead after a 409 "already decided" (D07). */
  approve: (id: string, body: { expectedStatus: PlanStatus; confirm?: boolean; note?: string }, idempotencyKey: string) =>
    api<unknown>(`/client/plans/${id}/approve`, { body, idempotencyKey }),
  requestChanges: (id: string, body: { expectedStatus: PlanStatus; confirm?: boolean; note?: string }, idempotencyKey: string) =>
    api<unknown>(`/client/plans/${id}/request-changes`, { body, idempotencyKey }),
}

export const clientPlanKey = (id: string) => ['client', 'plans', id]

/** "2026-12" → "December 2026". */
export const monthLabel = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
