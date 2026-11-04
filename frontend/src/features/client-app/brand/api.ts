import { api } from '@/lib/api'
import type { Brand, BrandReference, Onboarding, OnboardingStep, Section } from '@/features/brand/api'

// The client's own Brand DNA and onboarding (Flow 3, F02–F10): /api/client/brand. Shapes are shared with the
// agency side (features/brand/api.ts); the client edits only its own four sections (D41).

export const CLIENT_EDITABLE = ['intro', 'personality', 'likes', 'dislikes'] as const
export type ClientEditableSection = (typeof CLIENT_EDITABLE)[number]

export interface AssetRequest {
  _id: string
  title: string
  status: 'open' | 'submitted' | 'completed'
  uploadCategory: string
}

export const clientBrandApi = {
  get: () => api<{ brand: Brand }>('/client/brand'),
  saveSection: (section: ClientEditableSection, rev: number, data: unknown) =>
    api<{ section: Section }>(`/client/brand/sections/${section}`, { method: 'PUT', body: { rev, data } }),
  onboarding: () => api<{ onboarding: Onboarding; assetRequests: AssetRequest[] }>('/client/brand/onboarding'),
  complete: (step: OnboardingStep) => api<{ onboarding: Onboarding }>(`/client/brand/onboarding/${step}/complete`, { method: 'POST' }),

  references: (sentiment?: BrandReference['sentiment']) => api<{ items: BrandReference[] }>(`/client/brand/references${sentiment ? `?sentiment=${sentiment}` : ''}`),
  addReference: (body: { sentiment: BrandReference['sentiment']; image?: string; link: string; note: string; category: string }) =>
    api<{ reference: BrandReference }>('/client/brand/references', { body }),
  removeReference: (id: string) => api<void>(`/client/brand/references/${id}`, { method: 'DELETE' }),
}

export const clientBrandKey = ['client', 'brand'] as const
export const clientOnboardingKey = ['client', 'brand', 'onboarding'] as const
export const clientReferencesKey = ['client', 'brand', 'references'] as const
