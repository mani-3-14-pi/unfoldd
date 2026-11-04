import { api } from '@/lib/api'
import type { Page } from '@/types/api'

// The resource library (P27–P31, D39): one File object for every asset, organised by category and collection.

export const FILE_CATEGORIES = ['brand', 'photography', 'video', 'documents', 'fonts', 'product', 'existing_creatives', 'other'] as const
export type FileCategory = (typeof FILE_CATEGORIES)[number]

export interface LibraryFile {
  id: string
  client: string | null
  purpose: 'library' | 'request'
  name: string
  mimeType: string
  size: number
  status: 'uploading' | 'processing' | 'ready' | 'failed'
  category: FileCategory
  /** The collection the file is filed in, if any (a file is in at most one). */
  collection: string | null
  /** `client` files are shared with the client; `internal` ones only with the team. */
  visibility: 'internal' | 'client'
  uploadedBy?: { id: string; name: string; side: 'agency' | 'client' }
  createdAt: string
}

export interface Collection {
  _id: string
  name: string
  description: string
  visibility: 'internal' | 'client'
  fileCount: number
}

export const libraryApi = {
  overview: (client: string) => api<{ categories: Record<FileCategory, number>; collections: Collection[] }>(`/clients/${client}/library`),
  files: (query: string) => api<Page<LibraryFile>>(`/files?${query}`),
  createCollection: (client: string, body: { name: string; description?: string; visibility: 'internal' | 'client' }) =>
    api<{ collection: Collection }>(`/clients/${client}/collections`, { body }),
  updateCollection: (client: string, id: string, body: { name?: string; description?: string; visibility?: 'internal' | 'client' }) =>
    api<{ collection: Collection }>(`/clients/${client}/collections/${id}`, { method: 'PATCH', body }),
  removeCollection: (client: string, id: string) => api<void>(`/clients/${client}/collections/${id}`, { method: 'DELETE' }),
  organise: (client: string, fileId: string, body: { collection?: string | null; category?: FileCategory; visibility?: 'internal' | 'client' }) =>
    api<unknown>(`/clients/${client}/library/files/${fileId}`, { method: 'PATCH', body }),
  download: (id: string) => api<{ url: string }>(`/files/${id}/download`),
  remove: (id: string) => api<void>(`/files/${id}`, { method: 'DELETE' }),
}

export const libraryKey = (client: string) => ['agency', 'library', client]
