import { Pill } from '@/components/ui/Pill'
import type { PlanStatus } from './api'
import { planStatusLabel, planStatusTone } from './labels'

export function PlanStatusPill({ status }: { status: PlanStatus }) {
  return <Pill tone={planStatusTone[status]}>{planStatusLabel[status]}</Pill>
}
