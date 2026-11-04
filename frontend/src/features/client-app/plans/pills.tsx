import { Pill, type Tone } from '@/components/ui/Pill'
import type { PlanStatus } from './api'

const tone: Record<PlanStatus, Tone> = { sent: 'amber', approved: 'green', changes_requested: 'red' }

/** The server's client label ("Review Required" …) in the status colour. */
export function PlanStatusPill({ status, label }: { status: PlanStatus; label: string }) {
  return <Pill tone={tone[status]}>{label}</Pill>
}
