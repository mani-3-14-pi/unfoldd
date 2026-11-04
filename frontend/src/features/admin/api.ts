import { api } from '@/lib/api'
import type { Page } from '@/types/api'

// Platform (super) admin API: /api/admin/*. Session is the httpOnly `uf_admin` cookie.

export const AGENCY_STATUSES = ['pending', 'active', 'suspended', 'rejected'] as const
export type AgencyStatus = (typeof AGENCY_STATUSES)[number]
export const PLANS = ['trial', 'starter', 'growth', 'scale', 'enterprise'] as const
export type Plan = (typeof PLANS)[number]
export const SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due', 'cancelled'] as const
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number]
export const TEAM_SIZES = ['1-5', '6-15', '16-50', '51-200', '200+'] as const
export const MEMBER_ROLES = ['owner', 'admin', 'manager', 'member'] as const
export const MEMBER_STATUSES = ['active', 'disabled'] as const
export const ACTOR_TYPES = ['platform_admin', 'agency_user', 'system'] as const

export type { Page }

export interface Admin {
  id: string
  username: string
  name: string
}

export interface Subscription {
  plan: Plan
  status: SubscriptionStatus
  seats: number
  startedAt?: string
  renewsAt?: string
  notes?: string
}

export interface Agency {
  _id: string
  name: string
  slug: string
  email: string
  phone: string
  website: string
  country: string
  teamSize: string
  status: AgencyStatus
  statusReason: string
  statusChangedAt?: string
  approvedAt?: string
  createdAt: string
  owner?: { _id: string; name: string; email: string; lastLoginAt?: string }
  memberCount: number
  subscription: Subscription
}

export interface AgencyDetail extends Agency {
  activeSessions: number
}

export interface Member {
  _id: string
  role: (typeof MEMBER_ROLES)[number]
  status: (typeof MEMBER_STATUSES)[number]
  createdAt: string
  user: { _id: string; name: string; email: string; lastLoginAt?: string }
}

export interface Activity {
  _id: string
  action: string
  actor: { type: (typeof ACTOR_TYPES)[number]; id?: string; name?: string }
  impersonator?: { id: string; name: string }
  agency: { _id: string; name: string } | null
  target?: { type: string; id?: string; label?: string }
  message: string
  meta?: Record<string, unknown>
  ip?: string
  userAgent?: string
  createdAt: string
}

export interface Settings {
  signups: { enabled: boolean; autoApprove: boolean }
  supportSessionMinutes: number
  updatedAt?: string
}

export interface Overview {
  agencies: { total: number; byStatus: Record<AgencyStatus, number> }
  signups: { last7: number; prev7: number; last30: number }
  activePlans: Record<Plan, number>
  pending: Pick<Agency, '_id' | 'name' | 'email' | 'country' | 'teamSize' | 'createdAt'>[]
  recentActivity: Pick<Activity, '_id' | 'action' | 'message' | 'actor' | 'createdAt'>[]
  autoApprove: boolean
}

export type AgencyAction = 'approve' | 'reject' | 'suspend' | 'reactivate'

export type AgencyPage = Page<Agency> & { counts: Record<AgencyStatus, number>; facets: { countries: string[] } }
export type SubscriptionRow = Pick<Agency, '_id' | 'name' | 'slug' | 'email' | 'status' | 'subscription'>
export type SubscriptionPage = Page<SubscriptionRow> & {
  summary: { byPlan: Record<Plan, number>; byStatus: Record<SubscriptionStatus, number> }
}
export type ActivityPage = Page<Activity> & { facets: { actions: string[]; agency: { _id: string; name: string } | null } }

export const adminApi = {
  me: () => api<{ admin: Admin }>('/admin/auth/me'),
  /** 2FA is mandatory for platform admins: the password only opens a challenge. */
  /** With 2FA on (MFA_REQUIRED) the password only opens a challenge; with it off the session opens at once. */
  login: (body: { username: string; password: string }) =>
    api<{ mfa: 'setup' | 'verify'; challenge: string } | { admin: Admin }>('/admin/auth/login', { body }),
  mfaSetup: (challenge: string) => api<{ secret: string; otpauthUrl: string }>('/admin/auth/2fa/setup', { body: { challenge } }),
  mfaVerify: (body: { challenge: string; code?: string; backupCode?: string }) =>
    api<{ admin: Admin; backupCodes?: string[] }>('/admin/auth/2fa/verify', { body }),
  logout: () => api<void>('/admin/auth/logout', { method: 'POST' }),
  changePassword: (body: { currentPassword: string; newPassword: string }) => api<void>('/admin/auth/password', { body }),

  overview: () => api<Overview>('/admin/overview'),
  agencies: (query: string) => api<AgencyPage>(`/admin/agencies?${query}`),
  agency: (id: string) => api<{ agency: AgencyDetail }>(`/admin/agencies/${id}`),
  members: (id: string, query: string) => api<Page<Member>>(`/admin/agencies/${id}/members?${query}`),
  agencyAction: (id: string, action: AgencyAction, reason?: string) =>
    api<{ agency: Agency }>(`/admin/agencies/${id}/${action}`, { body: { reason } }),
  impersonate: (id: string) => api<{ url: string }>(`/admin/agencies/${id}/impersonate`, { method: 'POST' }),
  updateSubscription: (id: string, body: Omit<Subscription, 'startedAt'>) =>
    api<{ agency: Agency }>(`/admin/agencies/${id}/subscription`, { method: 'PATCH', body }),

  subscriptions: (query: string) => api<SubscriptionPage>(`/admin/subscriptions?${query}`),
  activity: (query: string) => api<ActivityPage>(`/admin/activity?${query}`),
  settings: () => api<{ settings: Settings }>('/admin/settings'),
  updateSettings: (body: Omit<Settings, 'updatedAt'>) => api<{ settings: Settings }>('/admin/settings', { method: 'PUT', body }),
}

export const adminMeKey = ['admin', 'me'] as const
