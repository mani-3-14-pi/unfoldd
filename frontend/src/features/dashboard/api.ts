import { api } from '@/lib/api'
import type { AgencyRole } from '@/features/agency/api'
import type { Health } from '@/features/clients/api'
import type { AgencyActivity } from '@/features/workspace/api'

// Phase 3 command centre (P05–P10): /api/dashboard. Every number is computed live on the server (D51).

export interface Metrics {
  awaitingReview: number
  awaitingApproval: number
  changesRequested: number
  inProduction: number
  readyToSchedule: number
  scheduled: number
  overdue: number
}

export type AttentionKind =
  | 'overdue_for_approval'
  | 'at_risk'
  | 'slot_missed'
  | 'publish_failed'
  | 'changes_requested'
  | 'internal_review'
  | 'ready_for_client'
  | 'task_overdue'
  | 'task_blocked'
  | 'request_overdue'
  | 'request_submitted'

export interface AttentionItem {
  kind: AttentionKind
  severity: 'urgent' | 'high' | 'normal'
  entity: { type: 'content' | 'task' | 'request'; id: string }
  title: string
  client: { id: string; brandName: string }
  at: string | null
  link: string
}

export type WorkloadStatus = 'available' | 'at_capacity' | 'overloaded'

export interface WorkloadPerson {
  user: { _id: string; name: string }
  role: AgencyRole
  titles: string[]
  departments: string[]
  activeTasks: number
  capacity: number
  /** Percent of capacity. */
  load: number
  status: WorkloadStatus
}

export interface DepartmentLoad {
  department: string
  people: number
  activeTasks: number
  capacity: number
  load: number
}

export interface PendingApproval {
  _id: string
  title: string
  client: string
  stateChangedAt: string
  publishDate: string | null
  versionNumber?: number
  viewed: boolean
  sentAt: string
}

export interface ClientHealthRow {
  id: string
  brandName: string
  status: string
  health: Health
  reasons: string[]
}

export interface Dashboard {
  metrics: Metrics
  needsAttention: { total: number; items: AttentionItem[] }
  pendingApprovals: PendingApproval[]
  workload: WorkloadPerson[]
  recentActivity: AgencyActivity[]
  clients: ClientHealthRow[]
}

export const dashboardApi = {
  get: (mine: boolean) => api<Dashboard>(`/dashboard${mine ? '?mine=true' : ''}`),
  needsAttention: (mine: boolean) => api<{ total: number; items: AttentionItem[] }>(`/dashboard/needs-attention${mine ? '?mine=true' : ''}`),
  workload: () => api<{ items: WorkloadPerson[]; byDepartment: DepartmentLoad[] }>('/dashboard/workload'),
}

export const dashboardKey = (mine: boolean) => ['agency', 'dashboard', mine]
