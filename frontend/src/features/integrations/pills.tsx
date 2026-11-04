import { Pill } from '@/components/ui/Pill'
import type { Connection } from './api'
import { connectionStatusLabel, connectionStatusTone } from './labels'

export function ConnectionStatusPill({ status }: { status: Connection['status'] }) {
  return <Pill tone={connectionStatusTone[status]}>{connectionStatusLabel[status]}</Pill>
}
