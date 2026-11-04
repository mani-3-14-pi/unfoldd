import { api } from '@/lib/api'
import type { Collection, FileCategory, LibraryFile } from '@/features/library/api'
import type { Page } from '@/types/api'

// The client's resource library (F64/F65, D39): /api/client/library and /api/files, client-visible files only.

export const clientLibraryApi = {
  overview: () => api<{ categories: Record<FileCategory, number>; collections: Collection[] }>('/client/library'),
  files: (query: string) => api<Page<LibraryFile>>(`/files?${query}`),
  organise: (fileId: string, body: { collection?: string | null; category?: FileCategory }) => api<unknown>(`/client/library/files/${fileId}`, { method: 'PATCH', body }),
  download: (id: string, inline = false) => api<{ url: string }>(`/files/${id}/download${inline ? '?inline=true' : ''}`),
  remove: (id: string) => api<void>(`/files/${id}`, { method: 'DELETE' }),
}

export const clientLibraryKey = ['client', 'library'] as const
