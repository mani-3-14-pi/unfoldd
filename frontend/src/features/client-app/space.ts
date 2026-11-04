import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

// The Client App's own space (F63, F71): GET /api/client. Every client-app query lives under ['client', …].

export type ClientCapability = 'approve' | 'feedback' | 'upload' | 'editBrand' | 'invite'

export interface ClientSpace {
  client: {
    _id: string
    name: string
    brandName: string
    logoUrl: string | null
    status: string
    timezone: string
    showAnalytics: boolean
    accountManager: { _id: string; name: string; email: string } | null
  }
  agency: { id: string; name: string; logoUrl: string | null }
  role: 'admin' | 'approver' | 'contributor' | 'viewer'
  /** What this person may do here (D47); the server checks again on every call. */
  can: Record<ClientCapability, boolean>
}

export const clientSpaceKey = ['client', 'space'] as const

export const clientSpaceApi = { get: () => api<ClientSpace>('/client') }

/** The client space: brand, agency, role and capabilities. Cached for the session. */
export function useClientSpace() {
  return useQuery({ queryKey: clientSpaceKey, queryFn: clientSpaceApi.get, staleTime: 5 * 60_000 })
}
