import { Pill } from '@/components/ui/Pill'
import type { BannerState } from './api'
import { bannerStateLabel, bannerStateTone } from './labels'

export function BannerStatePill({ state }: { state: BannerState }) {
  return <Pill tone={bannerStateTone[state]}>{bannerStateLabel[state]}</Pill>
}
