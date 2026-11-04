import type { Tone } from '@/components/ui/Pill'
import type { FileCategory, RequestStatus } from './api'

export const requestStatusLabel: Record<RequestStatus, string> = { draft: 'Draft', open: 'Waiting on client', submitted: 'Submitted', completed: 'Done', cancelled: 'Cancelled' }
export const requestStatusTone: Record<RequestStatus, Tone> = { draft: 'gray', open: 'amber', submitted: 'blue', completed: 'green', cancelled: 'gray' }

export const fileCategoryLabel: Record<FileCategory, string> = {
  brand: 'Brand assets',
  photography: 'Photography',
  video: 'Video',
  documents: 'Documents',
  fonts: 'Fonts',
  product: 'Product',
  existing_creatives: 'Existing creatives',
  other: 'Other',
}

export const requestSourceLabel = { manual: '', brand_dna: 'From Brand DNA', asset: 'Onboarding asset', meeting: 'From a meeting', template: 'From a template' } as const
