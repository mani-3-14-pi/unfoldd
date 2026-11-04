import { Pill } from '@/components/ui/Pill'
import type { TicketStatus } from './api'
import { ticketStatusLabel, ticketStatusTone } from './labels'

export function TicketStatusPill({ status }: { status: TicketStatus }) {
  return <Pill tone={ticketStatusTone[status]}>{ticketStatusLabel[status]}</Pill>
}
