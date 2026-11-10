import { api } from '@/lib/api'
import type { ClientRole } from '@/features/agency/api'
import type { Invitation } from '@/features/invitations/api'
import type { Page } from '@/types/api'

// The brand's own people, seen from their side (F71, D48): /api/client/members and /api/client/invitations.

export interface Colleague {
  _id: string
  role: ClientRole
  status: 'active' | 'disabled'
  createdAt: string
  user: { _id: string; name: string; email: string; lastLoginAt?: string }
}

export interface SpaceSettings {
  settings: {
    name: string
    brandName: string
    timezone: string
    status: string
    showAnalytics: boolean
    contact?: { name?: string; email?: string; phone?: string }
  }
  role: ClientRole
}

export const peopleApi = {
  members: () => api<{ items: Colleague[] }>('/client/members'),
  /** Client Admins only. The server keeps at least one Admin. */
  setRole: (userId: string, role: ClientRole) => api<{ ok: true }>(`/client/members/${userId}`, { method: 'PATCH', body: { role } }),
  remove: (userId: string) => api<{ ok: true }>(`/client/members/${userId}`, { method: 'DELETE' }),
  /** Client Admins only. */
  invitations: () => api<Page<Invitation>>('/client/invitations?pageSize=100'),
  invite: (body: { email: string; role: ClientRole; message?: string }, idempotencyKey: string) =>
    api<{ invitation: Invitation }>('/client/invitations', { body, idempotencyKey }),
  resend: (id: string, idempotencyKey: string) => api<{ invitation: Invitation }>(`/client/invitations/${id}/resend`, { method: 'POST', idempotencyKey }),
  revoke: (id: string) => api<{ invitation: Invitation }>(`/client/invitations/${id}/revoke`, { method: 'POST' }),
  settings: () => api<SpaceSettings>('/client/settings'),
}

export const peopleKey = ['client', 'people'] as const
