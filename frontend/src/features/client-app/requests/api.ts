import { api } from '@/lib/api'

// Needed From You (F53–F56, D35/D36): /api/client/requests.

export type ClientRequestStatus = 'open' | 'submitted' | 'completed' | 'cancelled'

export interface RequestFile {
  id: string
  name?: string
  mimeType?: string
  size?: number
  status?: string
  addedAt: string
  /** Submitted already: it may be in use, so it can't be removed (§6.6). */
  locked: boolean
}

export interface ClientRequest {
  id: string
  title: string
  description: string
  why: string
  due: string
  priority: 'low' | 'normal' | 'high' | 'urgent'
  status: ClientRequestStatus
  /** Needed · Submitted · Done. */
  label: string
  overdue: boolean
  /** Set when the agency asked for something else ("need something else"). */
  returnNote: string
  response: string
  submittedAt: string | null
  files: RequestFile[]
}

export const clientRequestsApi = {
  list: () => api<{ items: ClientRequest[] }>('/client/requests'),
  get: (id: string) => api<{ request: ClientRequest }>(`/client/requests/${id}`),
  /** Attaches a file already uploaded with purpose `request`; it joins the library (D36). */
  attach: (id: string, file: string) => api<{ request: ClientRequest }>(`/client/requests/${id}/files`, { body: { file } }),
  detach: (id: string, file: string) => api<void>(`/client/requests/${id}/files/${file}`, { method: 'DELETE' }),
  submit: (id: string, response: string, idempotencyKey: string) => api<{ request: ClientRequest }>(`/client/requests/${id}/submit`, { body: { response }, idempotencyKey }),
  fileUrl: (file: string) => api<{ url: string }>(`/files/${file}/download`),
}

export const clientRequestKey = (id: string) => ['client', 'requests', id]
