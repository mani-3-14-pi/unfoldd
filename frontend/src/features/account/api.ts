import { api } from '@/lib/api'

// The signed-in person's own account (P156): /api/me. The same for agency and client people.

export interface Profile {
  _id: string
  name: string
  email: string
  /** Empty = use the browser's. */
  timezone?: string
  lastLoginAt?: string
  twoFactorEnabled?: boolean
  createdAt?: string
}

export interface DeviceSession {
  _id: string
  ip?: string
  userAgent?: string
  createdAt: string
  expiresAt: string
  agency?: string | null
  client?: string | null
  /** The browser you're using now. */
  current: boolean
}

export const accountApi = {
  profile: () => api<{ profile: Profile }>('/me/profile'),
  updateProfile: (body: { name?: string; timezone?: string }) => api<{ profile: Profile }>('/me/profile', { method: 'PATCH', body }),
  changePassword: (body: { currentPassword: string; newPassword: string }) => api<void>('/me/password', { body }),
  sessions: () => api<{ items: DeviceSession[] }>('/me/sessions'),
  endSession: (id: string) => api<void>(`/me/sessions/${id}`, { method: 'DELETE' }),
  endOthers: () => api<{ revoked: number }>('/me/sessions/revoke-others', { method: 'POST' }),
}

export const profileKey = ['agency', 'account', 'profile'] as const
export const devicesKey = ['agency', 'account', 'sessions'] as const

/** "Chrome on Windows" from a user-agent string, good enough to recognise a device. */
export function describeAgent(ua = '') {
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'A browser'
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : ''
  return os ? `${browser} on ${os}` : browser
}
