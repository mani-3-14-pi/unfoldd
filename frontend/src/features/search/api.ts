import { api } from '@/lib/api'

// Search (P148–P150, F82): GET /api/search. The server scopes every type like its list, so results are always
// things the person can open, with links into the app they're in (/app/… or /c/…).

export const SEARCH_TYPES = ['clients', 'content', 'campaigns', 'plans', 'tasks', 'requests', 'meetings', 'files', 'people'] as const
export type SearchType = (typeof SEARCH_TYPES)[number]

export interface SearchResult {
  id: string
  title: string
  subtitle: string
  link: string
}

export interface SearchGroup {
  type: SearchType
  items: SearchResult[]
}

export const searchApi = {
  search: (q: string) => api<{ groups: SearchGroup[] }>(`/search?${new URLSearchParams({ q, limit: '5' })}`),
}

/** Which app is searching: decides the cache key, and the server answers for the session's own app anyway. */
export type SearchApp = 'agency' | 'client'

export const searchKey = (app: SearchApp, q: string) => [app, 'search', q]

export const MIN_QUERY = 2
