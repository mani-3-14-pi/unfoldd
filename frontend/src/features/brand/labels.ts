import type { AssetCategory, BrandReference, BrandSection, OnboardingStep } from './api'

export const sectionLabel: Record<BrandSection, string> = {
  intro: 'Brand introduction',
  personality: 'Personality',
  likes: 'Likes',
  dislikes: 'Dislikes',
  audience: 'Audience',
  positioning: 'Positioning',
  tone: 'Tone of voice',
  visualIdentity: 'Visual identity',
}

export const sectionHint: Partial<Record<BrandSection, string>> = {
  audience: 'Primary and secondary audience, age, location, behaviour, interests.',
  positioning: 'Where the brand sits against others, and why it wins.',
  tone: 'How the brand sounds: words to use, words to avoid.',
  visualIdentity: 'Colours, type, photography and layout direction.',
}

export const stepLabel: Record<OnboardingStep, string> = {
  intro: 'Brand introduction',
  personality: 'Personality',
  likes: 'Likes',
  dislikes: 'Dislikes',
  references: 'References',
  assets: 'Brand assets',
}

export const sentimentLabel: Record<BrandReference['sentiment'], string> = { like: 'Like', dislike: 'Dislike', neutral: 'Reference' }

export const assetCategoryLabel: Record<AssetCategory, string> = {
  brand: 'Brand',
  photography: 'Photography',
  video: 'Video',
  documents: 'Documents',
  fonts: 'Fonts',
  product: 'Product',
  existing_creatives: 'Existing creatives',
  other: 'Other',
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
export const tagLabel = (tag: string) => cap(tag.replace(/_/g, ' '))

/** D42 preview: "Leans playful", "Balanced", by how far the slider sits from the middle. */
export function leaning(value: number | undefined, left: string, right: string) {
  if (value == null) return 'Not set'
  if (Math.abs(value - 50) < 8) return 'Balanced'
  const pole = value < 50 ? left : right
  const strength = Math.abs(value - 50) >= 35 ? 'Strongly' : 'Leans'
  return `${strength} ${pole.toLowerCase()}`
}
