import { api } from '@/lib/api'

// Connecting a client's social accounts for publishing and analytics (P157, D66): /api/integrations.

export interface PlatformInfo {
  key: string
  label: string
  /** built = works here; possible = could be added; limited = the platform restricts it. */
  status: 'built' | 'possible' | 'limited'
  notes: string
  /** The server has this platform's app credentials. */
  configured: boolean
  formats: string[]
}

export interface Connection {
  _id: string
  platform: string
  externalId: string
  name: string
  handle: string
  status: 'active' | 'expired' | 'error' | 'disconnected'
  lastError: string
  lastCheckedAt: string | null
  tokenExpiresAt: string | null
  connectedBy?: { id: string; name: string }
  createdAt: string
}

export interface FoundAccount {
  platform: string
  externalId: string
  name: string
  handle?: string
}

/** One sign-in covers Instagram and Facebook (Meta); the others are their own app. */
export const appOf = (platform: string) => (platform === 'instagram' || platform === 'facebook' ? 'meta' : platform)

export const integrationsApi = {
  platforms: () => api<{ items: PlatformInfo[] }>('/integrations/platforms'),
  connections: (client: string) => api<{ items: Connection[] }>(`/integrations/connections?client=${client}`),
  authorize: (app: string, client: string) => api<{ url: string }>(`/integrations/${app}/authorize`, { body: { client } }),
  pending: (state: string) => api<{ client: string; accounts: FoundAccount[] }>(`/integrations/pending/${encodeURIComponent(state)}`),
  connect: (state: string, accounts: { platform: string; externalId: string }[]) =>
    api<{ connections: Connection[] }>(`/integrations/pending/${encodeURIComponent(state)}`, { body: { accounts } }),
  check: (id: string) => api<{ ok: boolean; error?: string }>(`/integrations/connections/${id}/check`, { method: 'POST' }),
  disconnect: (id: string) => api<void>(`/integrations/connections/${id}`, { method: 'DELETE' }),
}

export const connectionsKey = (client: string) => ['agency', 'integrations', 'connections', client]
