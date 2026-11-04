import { api } from '@/lib/api'
import type { Page } from '@/types/api'

// Brand DNA, references and creative guidelines (Flow 3, P21–P26): /api/clients/:id/brand, /api/clients/:id/guidelines.

export const CLIENT_SECTIONS = ['intro', 'personality', 'likes', 'dislikes'] as const
export const AGENCY_SECTIONS = ['audience', 'positioning', 'tone', 'visualIdentity'] as const
export type BrandSection = (typeof CLIENT_SECTIONS)[number] | (typeof AGENCY_SECTIONS)[number]
export const ONBOARDING_STEPS = ['intro', 'personality', 'likes', 'dislikes', 'references', 'assets'] as const
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]
export const SOCIALS = ['instagram', 'facebook', 'linkedin', 'youtube', 'x', 'tiktok'] as const
export const ASSET_CATEGORIES = ['brand', 'photography', 'video', 'documents', 'fonts', 'product', 'existing_creatives', 'other'] as const
export type AssetCategory = (typeof ASSET_CATEGORIES)[number]

export interface IntroData {
  whatWeDo: string
  standFor: string
  audience: string
  offerings: { name: string; description: string }[]
  website: string
  socials: Record<(typeof SOCIALS)[number], string> & { other: string[] }
}
export interface PersonalityData {
  /** D42: axis key → 0–100, a continuous slider between two poles. */
  axes: Record<string, number>
  keywords: string
}
export interface TasteData {
  tags: string[]
  note: string
}
export interface AudienceData {
  primary: string
  secondary: string
  age: string
  location: string
  behaviour: string
  interests: string
}
export interface TextData {
  text: string
}

/** One section with its own `rev`: two people editing different sections never conflict (D41). */
export interface Section<T = Record<string, unknown>> {
  data: Partial<T>
  rev: number
  updatedBy?: { id: string; name: string; side: 'agency' | 'client' }
  updatedAt?: string
}

export interface Onboarding {
  steps: { key: OnboardingStep; completedAt: string | null }[]
  done: number
  total: number
  percent: number
  /** P16 "Assets — 2 remaining": the agency's open asset requests. */
  assetRequestsOpen: number
  mode: 'wizard' | 'hub'
  completedAt: string | null
}

export interface Brand {
  sections: Record<BrandSection, Section>
  onboarding: Onboarding
  meta: {
    personalityAxes: { key: string; left: string; right: string }[]
    styleTags: string[]
  }
}

export interface BrandReference {
  _id: string
  sentiment: 'like' | 'dislike' | 'neutral'
  image: string | null
  imageUrl: string | null
  link: string
  note: string
  category: string
  addedBy: { id: string; name: string; side: 'agency' | 'client' }
  createdAt: string
}

export interface Guidelines {
  dos: string[]
  donts: string[]
  tone: string
  visualDirection: string
  contentRules: string
  platformRules: Record<string, string>
  rev: number
  updatedBy?: { id: string; name: string }
  updatedAt: string
}

export interface BrandHistoryEntry {
  _id: string
  actor: { name?: string; type: string }
  message: string
  meta?: { section?: string }
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  createdAt: string
}

export const brandApi = {
  get: (client: string) => api<{ brand: Brand }>(`/clients/${client}/brand`),
  saveSection: (client: string, section: BrandSection, rev: number, data: unknown) =>
    api<{ section: Section }>(`/clients/${client}/brand/sections/${section}`, { method: 'PUT', body: { rev, data } }),
  history: (client: string, query: string) => api<Page<BrandHistoryEntry>>(`/clients/${client}/brand/history?${query}`),
  requestUpdate: (client: string, body: { section: BrandSection; note: string; due?: string }) => api<unknown>(`/clients/${client}/brand/request-update`, { body }),
  assetRequest: (client: string, body: { title: string; description: string; uploadCategory: AssetCategory }) =>
    api<unknown>(`/clients/${client}/brand/asset-requests`, { body }),

  references: (client: string) => api<{ items: BrandReference[] }>(`/clients/${client}/brand/references`),
  addReference: (client: string, body: { sentiment: BrandReference['sentiment']; image?: string; link: string; note: string; category: string }) =>
    api<{ reference: BrandReference }>(`/clients/${client}/brand/references`, { body }),
  removeReference: (client: string, id: string) => api<void>(`/clients/${client}/brand/references/${id}`, { method: 'DELETE' }),

  guidelines: (client: string) => api<{ guidelines: Guidelines }>(`/clients/${client}/guidelines`),
  saveGuidelines: (client: string, body: Partial<Omit<Guidelines, 'updatedBy' | 'updatedAt'>> & { rev: number }) =>
    api<{ guidelines: Guidelines }>(`/clients/${client}/guidelines`, { method: 'PUT', body }),
}

export const brandKey = (client: string) => ['agency', 'brand', client]
