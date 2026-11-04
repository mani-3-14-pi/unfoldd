import { Pill } from '@/components/ui/Pill'
import type { ClientStatus, Health } from './api'
import { clientStatusLabel, clientStatusTone, healthLabel, healthTone } from './labels'

export function ClientStatusPill({ status }: { status: ClientStatus }) {
  return <Pill tone={clientStatusTone[status]}>{clientStatusLabel[status]}</Pill>
}

export function HealthPill({ health, reasons }: { health: Health; reasons?: string[] }) {
  return (
    <span title={reasons?.join(' · ') || undefined}>
      <Pill tone={healthTone[health]}>{healthLabel[health]}</Pill>
    </span>
  )
}
