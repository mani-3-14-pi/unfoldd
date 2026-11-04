import type { IntroData, PersonalityData, TasteData } from '@/features/brand/api'

// Starting values for each client-edited section, merged with whatever is already stored.

export const EMPTY_INTRO: IntroData = {
  whatWeDo: '',
  standFor: '',
  audience: '',
  offerings: [],
  website: '',
  socials: { instagram: '', facebook: '', linkedin: '', youtube: '', x: '', tiktok: '', other: [] },
}
export const EMPTY_PERSONALITY: PersonalityData = { axes: {}, keywords: '' }
export const EMPTY_TASTE: TasteData = { tags: [], note: '' }

/** Offerings need a name; empty rows left in the form aren't saved. */
export const cleanIntro = (d: IntroData): IntroData => ({ ...d, offerings: d.offerings.filter((o) => o.name.trim()) })

/** D72: Brand Introduction is done once these three are answered. */
export const introReady = (d: IntroData) => !!(d.whatWeDo.trim() && d.standFor.trim() && d.audience.trim())
