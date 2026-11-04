import { api } from '@/lib/api'
import type { AgencyRole, ClientRole } from '@/features/agency/api'
import type { Invitation } from '@/features/invitations/api'
import type { Page, UpdatedBy } from '@/types/api'

// Agency-side client management (P11–P20, Flow 2): /api/clients.

export const CLIENT_STATUSES = ['onboarding', 'active', 'paused', 'completed', 'archived'] as const
export type ClientStatus = (typeof CLIENT_STATUSES)[number]
export type ClientAction = 'activate' | 'pause' | 'complete' | 'archive' | 'restore'
export type Health = 'on_track' | 'needs_attention' | 'blocked'

export interface Contract {
  /** D09: revisions included per content item. Going over is flagged, never blocked. */
  revisionsIncluded: number
  /** "Needed by" = publish date − this many hours. */
  approvalLeadHours: number
  /** D46: internal review before sending to the client. */
  internalReview: boolean
}

export interface Client {
  _id: string
  name: string
  brandName: string
  logo: string | null
  contact: { name: string; email: string; phone: string }
  services: string[]
  /** Populated on list and detail; a plain id in a PATCH response. */
  accountManager: { _id: string; name: string; email: string } | null
  startDate: string
  notes: string
  timezone: string
  status: ClientStatus
  statusChangedAt?: string
  contract: Contract
  showAnalytics: boolean
  rev: number
  updatedBy?: UpdatedBy
  createdAt: string
  updatedAt: string
  /** D69, derived live. */
  health: { health: Health; reasons: string[] }
}

export interface ClientDetail extends Client {
  logoUrl: string | null
  /** Manager+ on a client that isn't archived. */
  canManage: boolean
}

export interface ClientInput {
  name: string
  brandName: string
  logo?: string | null
  contact?: { name: string; email: string; phone: string }
  services?: string[]
  accountManager?: string | null
  startDate?: string
  notes?: string
  timezone?: string
  contract?: Partial<Contract>
}

export type ClientPage = Page<Client> & { counts: Record<ClientStatus, number> }

export interface AccessRow {
  _id: string
  user: { _id: string; name: string; email: string }
  membership?: { role: AgencyRole; titles: string[]; departments: string[]; status: string }
  createdAt: string
}

export interface ClientMember {
  _id: string
  role: ClientRole
  status: 'active' | 'disabled'
  createdAt: string
  user: { _id: string; name: string; email: string; lastLoginAt?: string }
}

export const clientsApi = {
  list: (query: string) => api<ClientPage>(`/clients?${query}`),
  get: (id: string) => api<{ client: ClientDetail }>(`/clients/${id}`),
  create: (body: ClientInput, idempotencyKey: string) => api<{ client: ClientDetail }>('/clients', { body, idempotencyKey }),
  update: (id: string, body: Partial<ClientInput> & { rev: number }) => api<{ client: ClientDetail }>(`/clients/${id}`, { method: 'PATCH', body }),
  action: (id: string, action: ClientAction) => api<{ client: ClientDetail }>(`/clients/${id}/${action}`, { method: 'POST' }),
  remove: (id: string) => api<void>(`/clients/${id}`, { method: 'DELETE' }),

  access: (id: string) => api<{ items: AccessRow[]; alwaysVisibleTo: { user: AccessRow['user']; role: AgencyRole }[] }>(`/clients/${id}/access`),
  grant: (id: string, userId: string) => api<{ ok: true }>(`/clients/${id}/access`, { body: { userId } }),
  revoke: (id: string, userId: string) => api<{ ok: true; wasAccountManager: boolean }>(`/clients/${id}/access/${userId}`, { method: 'DELETE' }),

  members: (id: string) => api<{ items: ClientMember[] }>(`/clients/${id}/members`),
  setMemberRole: (id: string, userId: string, role: ClientRole) => api<{ ok: true }>(`/clients/${id}/members/${userId}`, { method: 'PATCH', body: { role } }),
  removeMember: (id: string, userId: string) => api<{ ok: true }>(`/clients/${id}/members/${userId}`, { method: 'DELETE' }),
  invitations: (id: string) => api<Page<Invitation>>(`/clients/${id}/invitations?pageSize=100`),
  invite: (id: string, body: { email: string; role: ClientRole; message?: string }, idempotencyKey: string) =>
    api<{ invitation: Invitation }>(`/clients/${id}/invitations`, { body, idempotencyKey }),
}

export const clientKey = (id: string) => ['agency', 'clients', 'detail', id]
