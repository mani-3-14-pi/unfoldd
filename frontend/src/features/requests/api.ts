import { api } from '@/lib/api'
import type { Priority } from '@/features/content/api'
import type { Page, UpdatedBy } from '@/types/api'

// Needed From You (Flow 9, P90–P93): /api/requests. Overdue is derived on the server (D35).

export const REQUEST_STATUSES = ['draft', 'open', 'submitted', 'completed', 'cancelled'] as const
export type RequestStatus = (typeof REQUEST_STATUSES)[number]
export type RequestAction = 'publish' | 'complete' | 'reopen' | 'cancel'

/** Where the client's uploads land in their resource library (D36). */
export const FILE_CATEGORIES = ['brand', 'photography', 'video', 'documents', 'fonts', 'product', 'existing_creatives', 'other'] as const
export type FileCategory = (typeof FILE_CATEGORIES)[number]

export interface RequestFile {
  file: string
  addedBy?: { id: string; name: string }
  addedAt: string
  /** Once submitted, the client can't remove it. */
  submittedAt: string | null
  info?: { _id: string; name: string; mimeType: string; size: number; status: string; category: string }
}

export interface ClientRequest {
  _id: string
  client: string
  campaign: string | null
  content: string | null
  source: 'manual' | 'brand_dna' | 'asset' | 'meeting' | 'template'
  title: string
  description: string
  why: string
  /** Date-only, in the client's timezone. */
  due: string
  priority: Priority
  uploadCategory: FileCategory
  status: RequestStatus
  statusChangedAt: string
  files: RequestFile[]
  response: string
  returnNote: string
  viewedAt: string | null
  submittedAt: string | null
  submittedBy?: { id: string; name: string }
  completedAt: string | null
  overdue: boolean
  rev: number
  updatedBy?: UpdatedBy
  createdAt: string
}

export interface RequestInput {
  title: string
  description?: string
  why?: string
  due?: string
  priority?: Priority
  uploadCategory?: FileCategory
  campaign?: string | null
  content?: string | null
}

export const requestsApi = {
  list: (query: string) => api<Page<ClientRequest>>(`/requests?${query}`),
  get: (id: string) => api<{ request: ClientRequest }>(`/requests/${id}`),
  create: (body: RequestInput & { client: string; template?: string; draft?: boolean }, idempotencyKey: string) =>
    api<{ request: ClientRequest }>('/requests', { body, idempotencyKey }),
  update: (id: string, body: Partial<RequestInput> & { rev: number }) => api<{ request: ClientRequest }>(`/requests/${id}`, { method: 'PATCH', body }),
  action: (id: string, action: RequestAction, note = '') => api<{ request: ClientRequest }>(`/requests/${id}/${action}`, { body: { note } }),
}

export const requestKey = (id: string) => ['agency', 'requests', 'detail', id]
