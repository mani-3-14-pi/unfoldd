import { api } from '@/lib/api'
import type { Contract } from '@/features/clients/api'
import type { Page } from '@/types/api'

// The agency itself: profile and workspace settings (P01, P03, P154), its activity feed, and notifications.

export const AGENCY_TYPES = ['creative', 'social_media', 'digital_marketing', 'branding', 'content', 'performance', 'pr', 'full_service', 'freelancer', 'other'] as const
export type AgencyType = (typeof AGENCY_TYPES)[number]
export const TEAM_SIZES = ['1-5', '6-15', '16-50', '51-200', '200+'] as const

export const agencyTypeLabel: Record<AgencyType, string> = {
  creative: 'Creative',
  social_media: 'Social media',
  digital_marketing: 'Digital marketing',
  branding: 'Branding',
  content: 'Content',
  performance: 'Performance',
  pr: 'PR',
  full_service: 'Full service',
  freelancer: 'Freelancer',
  other: 'Other',
}

export interface AgencyProfile {
  id: string
  slug: string
  status: string
  name: string
  logo: string | null
  logoUrl: string | null
  description: string
  type: AgencyType | ''
  services: string[]
  website: string
  email: string
  phone: string
  contactName: string
  country: string
  teamSize: string
  timezone: string
  /** Copied into each new client's contract (Flow 1, step 2). */
  clientDefaults: Contract
  rev: number
  updatedAt: string
}

export type ProfileUpdate = Partial<Omit<AgencyProfile, 'id' | 'slug' | 'status' | 'logoUrl' | 'rev' | 'updatedAt'>> & { rev: number }

export interface AgencyActivity {
  _id: string
  action: string
  actor: { type: 'platform_admin' | 'agency_user' | 'client_user' | 'system'; id?: string; name?: string }
  impersonator?: { id: string; name: string }
  client?: string
  visibility: 'internal' | 'client'
  target?: { type: string; id?: string; label?: string }
  message: string
  createdAt: string
}

export const NOTIFICATION_CATEGORIES = ['invites', 'security', 'team', 'clients', 'reviews', 'feedback', 'requests', 'meetings', 'publishing'] as const
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number]

export interface AppNotification {
  id: string
  category: NotificationCategory
  event: string
  title: string
  body?: string
  link?: string
  urgent: boolean
  readAt: string | null
  createdAt: string
}

export interface NotificationPref {
  category: NotificationCategory
  /** Invitations and security alerts can't be switched off (D68). */
  mandatory: boolean
  email: boolean
  push: boolean
}

export const notificationCategoryLabel: Record<NotificationCategory, { label: string; hint: string }> = {
  invites: { label: 'Invitations', hint: 'Invitations accepted, declined or asked for again' },
  security: { label: 'Security', hint: 'Sign-ins, ownership and access changes' },
  team: { label: 'Team', hint: 'People joining, leaving or changing role' },
  clients: { label: 'Clients', hint: 'Client access and client people' },
  reviews: { label: 'Reviews and approvals', hint: 'Content waiting on you, approvals and change requests' },
  feedback: { label: 'Feedback', hint: 'New client feedback and replies' },
  requests: { label: 'Requests', hint: 'Uploads and answers from clients' },
  meetings: { label: 'Meetings', hint: 'Upcoming meetings and shared summaries' },
  publishing: { label: 'Publishing', hint: 'Scheduled, published and failed posts' },
}

export const workspaceApi = {
  profile: () => api<{ agency: AgencyProfile }>('/agency'),
  updateProfile: (body: ProfileUpdate) => api<{ agency: AgencyProfile }>('/agency', { method: 'PATCH', body }),
  activity: (query: string) => api<Page<AgencyActivity>>(`/agency/activity?${query}`),

  notifications: (query: string) => api<Page<AppNotification>>(`/notifications?${query}`),
  unreadCount: () => api<{ count: number }>('/notifications/unread-count'),
  markRead: (id: string) => api<{ readAt: string }>(`/notifications/${id}/read`, { method: 'POST' }),
  markAllRead: () => api<{ updated: number }>('/notifications/read-all', { method: 'POST' }),
  preferences: () => api<{ channels: ('email' | 'push')[]; items: NotificationPref[] }>('/notifications/preferences'),
  updatePreferences: (items: Pick<NotificationPref, 'category' | 'email' | 'push'>[]) =>
    api<{ channels: ('email' | 'push')[]; items: NotificationPref[] }>('/notifications/preferences', { method: 'PUT', body: { items } }),
}

export const profileKey = ['agency', 'profile'] as const
export const unreadKey = ['agency', 'notifications', 'unread'] as const
