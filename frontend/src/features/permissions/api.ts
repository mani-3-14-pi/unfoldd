import { api } from '@/lib/api'

// P172–P174: what each role can do, as the server enforces it (/api/agency/permissions). Roles are fixed.

export interface Capability {
  key: string
  label: string
  roles: string[]
  /** A per-person switch that also grants it, e.g. "can publish". */
  flag?: string
}

export interface PermissionMatrix {
  agency: { roles: string[]; capabilities: Capability[] }
  client: { roles: string[]; capabilities: Capability[] }
  notes: string[]
}

export const permissionsApi = {
  matrix: () => api<PermissionMatrix>('/agency/permissions'),
}
