import { api } from '@/lib/api'
import type { UpdatedBy } from '@/types/api'

// The banner manager (D52) for the client app's Home banner (F12): /api/banners.

export const BANNER_STATES = ['draft', 'scheduled', 'live', 'ended'] as const
export type BannerState = (typeof BANNER_STATES)[number]

export interface Banner {
  _id: string
  client: string
  image: string | null
  imageUrl: string | null
  headline: string
  text: string
  /** The CTA opens a page inside the client app (`/c/...`). */
  cta: { label: string; link: string }
  startAt: string | null
  endAt: string | null
  order: number
  /** Auto banners come from events (e.g. a plan sent) and can only be ended. */
  source: 'manual' | 'auto'
  publishedAt: string | null
  endedAt: string | null
  /** Derived on the server from the dates. */
  state: BannerState
  createdBy?: { id: string; name: string }
  rev: number
  updatedBy?: UpdatedBy
  createdAt: string
}

export interface BannerInput {
  headline: string
  text?: string
  image?: string | null
  /** null removes the button. */
  cta?: { label: string; link: string } | null
  startAt?: string | null
  endAt?: string | null
}

export const bannersApi = {
  list: (client?: string) => api<{ items: Banner[] }>(`/banners${client ? `?client=${client}` : ''}`),
  create: (body: BannerInput & { client: string; publish: boolean }, idempotencyKey: string) => api<{ banner: Banner }>('/banners', { body, idempotencyKey }),
  update: (id: string, body: Partial<BannerInput> & { rev: number }) => api<{ banner: Banner }>(`/banners/${id}`, { method: 'PATCH', body }),
  publish: (id: string) => api<{ banner: Banner }>(`/banners/${id}/publish`, { method: 'POST' }),
  end: (id: string) => api<{ banner: Banner }>(`/banners/${id}/end`, { method: 'POST' }),
  remove: (id: string) => api<void>(`/banners/${id}`, { method: 'DELETE' }),
  reorder: (client: string, ids: string[]) => api<{ ok: true }>('/banners/order', { method: 'PUT', body: { client, ids } }),
}

export const bannersKey = ['agency', 'banners'] as const
