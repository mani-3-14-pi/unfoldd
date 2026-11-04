import { api } from '@/lib/api'
import type { ContentState, Format, Platform, ThreadStatus } from '@/features/content/api'
import type { Page } from '@/types/api'

// Monthly content plans (Flow 4, P37–P41): /api/plans. Plan items ARE content rows in `planned` state (D33).

export const PLAN_STATUSES = ['draft', 'sent', 'approved', 'changes_requested'] as const
export type PlanStatus = (typeof PLAN_STATUSES)[number]

export interface Plan {
  _id: string
  client: string
  /** "YYYY-MM", in the client's timezone. */
  month: string
  status: PlanStatus
  statusChangedAt: string
  note: string
  sentAt: string | null
  sentBy?: { id: string; name: string }
  decidedAt: string | null
  decidedBy?: { id: string; name: string }
  createdAt: string
  itemCount?: number
}

export interface PlanItem {
  _id: string
  title: string
  platform: Platform
  format: Format
  idea: string
  concept: string
  objective: string
  publishDate: string | null
  campaign: string | null
  owner: string | null
  state: ContentState
  /** D34: changed or added after the client approved the plan. */
  updatedSinceApproval: boolean
}

export interface PlanMessage {
  _id: string
  author: { id: string; name: string; side: 'agency' | 'client' }
  body: string
  createdAt: string
}

/** A plan comment (D80): on the whole plan, or on one item when `content` is set. */
export interface PlanThread {
  _id: string
  content: string | null
  status: ThreadStatus | null
  author: { id: string; name: string; side: 'agency' | 'client' }
  submittedAt: string | null
  draft: boolean
  resolutionNote: string
  messages: PlanMessage[]
  createdAt: string
}

export type PlanDetail = Plan & { items: PlanItem[]; threads: PlanThread[] }

export interface PlanItemInput {
  title: string
  platform: Platform
  format: Format
  idea?: string
  concept?: string
  objective?: string
  publishDate?: string | null
  campaign?: string | null
  owner?: string | null
}

export interface BulkGroup {
  platform: Platform
  format: Format
  count: number
  title?: string
}

export const plansApi = {
  list: (query: string) => api<Page<Plan>>(`/plans?${query}`),
  get: (id: string) => api<{ plan: PlanDetail }>(`/plans/${id}`),
  create: (body: { client: string; month: string; note?: string }, idempotencyKey: string) => api<{ plan: Plan }>('/plans', { body, idempotencyKey }),
  addItem: (id: string, body: PlanItemInput, idempotencyKey: string) => api<{ item: PlanItem }>(`/plans/${id}/items`, { body, idempotencyKey }),
  addBulk: (id: string, groups: BulkGroup[], idempotencyKey: string) => api<{ items: PlanItem[] }>(`/plans/${id}/items/bulk`, { body: { groups }, idempotencyKey }),
  send: (id: string) => api<{ plan: Plan }>(`/plans/${id}/send`, { method: 'POST' }),
  reply: (id: string, threadId: string, body: string) => api<{ message: PlanMessage }>(`/plans/${id}/threads/${threadId}/messages`, { body: { body } }),
  setThreadStatus: (id: string, threadId: string, status: ThreadStatus, resolutionNote = '') =>
    api<{ thread: PlanThread }>(`/plans/${id}/threads/${threadId}`, { method: 'PATCH', body: { status, resolutionNote } }),
}

export const planKey = (id: string) => ['agency', 'plans', 'detail', id]
