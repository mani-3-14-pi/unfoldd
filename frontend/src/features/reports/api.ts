import { api } from '@/lib/api'
import type { Analytics } from '@/features/analytics/api'

// Reports (P126–P129, D53): /api/reports. A report freezes its numbers when generated; sharing locks it.

export const REPORT_SECTIONS = ['summary', 'platforms', 'top_posts', 'delivery', 'notes'] as const
export type ReportSection = (typeof REPORT_SECTIONS)[number]

export type ReportSnapshot = Analytics & {
  /** What the agency delivered in the period. */
  delivery: { published: number; approvals: number; revisionRounds: number }
  generatedAt: string
}

export interface Report {
  _id: string
  client: string
  title: string
  period: { from: string; to: string }
  sections: ReportSection[]
  notes: string
  status: 'draft' | 'shared'
  generatedAt: string | null
  sharedAt: string | null
  sharedBy?: { id: string; name: string }
  createdBy?: { id: string; name: string }
  createdAt: string
  /** Only on a single report, not in the list. */
  snapshot?: ReportSnapshot | null
}

export const reportsApi = {
  list: (client?: string) => api<{ items: Report[] }>(`/reports${client ? `?client=${client}` : ''}`),
  get: (id: string) => api<{ report: Report }>(`/reports/${id}`),
  create: (body: { client: string; title?: string; from: string; to: string; sections: ReportSection[]; notes?: string }, idempotencyKey: string) =>
    api<{ report: Report }>('/reports', { body, idempotencyKey }),
  update: (id: string, body: { title?: string; notes?: string; sections?: ReportSection[] }) => api<{ report: Report }>(`/reports/${id}`, { method: 'PATCH', body }),
  refresh: (id: string) => api<{ report: Report }>(`/reports/${id}/refresh`, { method: 'POST' }),
  share: (id: string) => api<{ report: Report }>(`/reports/${id}/share`, { method: 'POST' }),
  remove: (id: string) => api<void>(`/reports/${id}`, { method: 'DELETE' }),
}

export const reportKey = (id: string) => ['agency', 'reports', 'detail', id]
