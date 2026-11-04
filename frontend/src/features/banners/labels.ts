import type { Tone } from '@/components/ui/Pill'
import type { BannerState } from './api'

export const bannerStateLabel: Record<BannerState, string> = { draft: 'Draft', scheduled: 'Scheduled', live: 'Live', ended: 'Ended' }
export const bannerStateTone: Record<BannerState, Tone> = { draft: 'gray', scheduled: 'blue', live: 'green', ended: 'gray' }
