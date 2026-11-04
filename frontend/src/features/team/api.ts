import { api } from '@/lib/api'
import type { AgencyRole } from '@/features/agency/api'
import type { Invitation } from '@/features/invitations/api'
import type { Page } from '@/types/api'

// Team members (P130–P135) and agency invitations: /api/agency/members, /api/agency/invitations.

export const MEMBER_STATUSES = ['active', 'disabled'] as const
export type MemberStatus = (typeof MEMBER_STATUSES)[number]

export interface TeamMember {
  _id: string
  role: AgencyRole
  canPublish: boolean
  titles: string[]
  departments: string[]
  /** D56: maximum active tasks. */
  capacity: number
  status: MemberStatus
  createdAt: string
  user: { _id: string; name: string; email: string; lastLoginAt?: string }
  /** Clients this person is assigned to. Owner and Admin see every client regardless. */
  clientCount: number
}

export interface MemberUpdate {
  role?: Exclude<AgencyRole, 'owner'>
  canPublish?: boolean
  titles?: string[]
  departments?: string[]
  capacity?: number
}

/** Clients whose account manager just lost access (rule §12.11). */
export type NeedsReassignment = { _id: string; name: string; brandName: string }[]

export const teamApi = {
  members: (query: string) => api<Page<TeamMember>>(`/agency/members?${query}`),
  update: (userId: string, body: MemberUpdate) => api<{ member: TeamMember }>(`/agency/members/${userId}`, { method: 'PATCH', body }),
  disable: (userId: string) => api<{ needsReassignment: NeedsReassignment }>(`/agency/members/${userId}/disable`, { method: 'POST' }),
  enable: (userId: string) => api<unknown>(`/agency/members/${userId}/enable`, { method: 'POST' }),
  remove: (userId: string) => api<{ needsReassignment: NeedsReassignment }>(`/agency/members/${userId}`, { method: 'DELETE' }),
  transferOwnership: (userId: string) => api<{ ok: true }>('/agency/transfer-ownership', { body: { userId } }),

  invitations: (query: string) => api<Page<Invitation>>(`/agency/invitations?${query}`),
  invite: (body: { email: string; role: string; message?: string }, idempotencyKey: string) =>
    api<{ invitation: Invitation }>('/agency/invitations', { body, idempotencyKey }),
}

/** Every active team member, for pickers (account manager, client access). Teams stay well under 100. */
export const activeTeamQuery = {
  queryKey: ['agency', 'team', 'members', 'active-all'],
  queryFn: () => teamApi.members('status=active&pageSize=100&sort=name'),
  staleTime: 60_000,
}
