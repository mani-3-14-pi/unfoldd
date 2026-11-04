import { api } from '@/lib/api'

// Sign-in for agency and client people (one login, D43): /api/auth/*. Session is the httpOnly `uf_session` cookie.

export const AGENCY_ROLES = ['owner', 'admin', 'manager', 'member'] as const
export type AgencyRole = (typeof AGENCY_ROLES)[number]
export const CLIENT_ROLES = ['admin', 'approver', 'contributor', 'viewer'] as const
export type ClientRole = (typeof CLIENT_ROLES)[number]

export interface Contexts {
  agencies: { agencyId: string; name: string; role: AgencyRole }[]
  clients: { clientId: string; agencyId: string; brandName: string; name: string; agencyName: string; role: ClientRole; status: string }[]
}

interface SessionBase {
  user: { id: string; name: string; email: string }
  contexts: Contexts
}

export interface AgencySession extends SessionBase {
  context: 'agency'
  agency: { id: string; name: string; slug: string; status: string; timezone: string }
  role: AgencyRole
  canPublish: boolean
  /** Set when a platform admin opened this portal from the admin (support view). */
  support: { by: string; expiresAt: string } | null
}

export interface ClientSession extends SessionBase {
  context: 'client'
  agency: { id: string; name: string }
  client: { id: string; name: string; brandName: string; status: string; timezone: string }
  role: ClientRole
}

export type Session = AgencySession | ClientSession

/** Where a successful sign-in landed. */
export type SignedIn = { ok: true; context: 'agency' | 'client'; clientId?: string | null }
/** Agency owners sign in with 2FA: the password step hands out a challenge instead of a session. */
export type MfaChallenge = { mfa: 'setup' | 'verify'; challenge: string }

export interface SignupInput {
  name: string
  email: string
  password: string
  agencyName: string
  phone?: string
  website?: string
  country?: string
  teamSize?: string
}

export const sessionApi = {
  me: () => api<Session>('/auth/me'),
  login: (body: { email: string; password: string }) => api<SignedIn | MfaChallenge>('/auth/login', { body }),
  logout: () => api<void>('/auth/logout', { method: 'POST' }),
  switchTo: (body: { agencyId: string } | { clientId: string }) => api<SignedIn>('/auth/switch', { body }),
  signupConfig: () => api<{ enabled: boolean }>('/auth/signup-config'),
  signup: (body: SignupInput) => api<{ status: 'pending' } | ({ status: 'active' } & (MfaChallenge | SignedIn))>('/auth/signup', { body }),

  mfaSetup: (challenge: string) => api<{ secret: string; otpauthUrl: string }>('/auth/2fa/setup', { body: { challenge } }),
  mfaVerify: (body: { challenge: string; code?: string; backupCode?: string }) =>
    api<SignedIn & { backupCodes?: string[] }>('/auth/2fa/verify', { body }),
  backupCodes: (code: string) => api<{ backupCodes: string[] }>('/auth/2fa/backup-codes', { body: { code } }),
}

export const sessionKey = ['session', 'me'] as const

export const isMfa = (r: SignedIn | MfaChallenge): r is MfaChallenge => 'mfa' in r

/** Where to go after signing in: the agency portal or the client app. */
export const homeFor = (context: 'agency' | 'client') => (context === 'client' ? '/c' : '/app')
