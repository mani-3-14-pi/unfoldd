import { api } from '@/lib/api'
import type { Analytics } from '@/features/analytics/api'
import type { Report } from '@/features/reports/api'

// Analytics and shared reports (F75–F79, D53/D58), only when the agency switched analytics on.

export const clientAnalyticsApi = {
  period: (from: string, to: string) => api<Analytics>(`/client/analytics?${new URLSearchParams({ from, to })}`),
  reports: () => api<{ items: Pick<Report, '_id' | 'title' | 'period' | 'sharedAt'>[] }>('/client/analytics/reports'),
  report: (id: string) => api<{ report: Report }>(`/client/analytics/reports/${id}`),
}
