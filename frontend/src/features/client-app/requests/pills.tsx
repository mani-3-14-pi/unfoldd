import { Pill, type Tone } from '@/components/ui/Pill'
import type { ClientRequest } from './api'

const tone: Record<ClientRequest['status'], Tone> = { open: 'amber', submitted: 'blue', completed: 'green', cancelled: 'gray' }

/** Needed / Submitted / Done, and "Overdue" when an open one is past its date. */
export function RequestStatusPill({ request: r }: { request: Pick<ClientRequest, 'status' | 'label' | 'overdue'> }) {
  return r.overdue ? <Pill tone="red">Overdue</Pill> : <Pill tone={tone[r.status]}>{r.label}</Pill>
}
