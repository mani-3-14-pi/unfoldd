import { Pill } from '@/components/ui/Pill'
import type { RequestStatus } from './api'
import { requestStatusLabel, requestStatusTone } from './labels'

export function RequestStatusPill({ status, overdue }: { status: RequestStatus; overdue?: boolean }) {
  if (overdue) return <Pill tone="red">Overdue</Pill>
  return <Pill tone={requestStatusTone[status]}>{requestStatusLabel[status]}</Pill>
}
