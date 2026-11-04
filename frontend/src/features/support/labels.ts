import type { Tone } from '@/components/ui/Pill'
import type { TicketCategory, TicketStatus } from './api'

export const categoryLabel: Record<TicketCategory, string> = {
  bug: 'Something’s broken',
  question: 'Question',
  account: 'My account',
  billing: 'Billing',
  feature_request: 'Idea or request',
  other: 'Other',
}

export const ticketStatusLabel: Record<TicketStatus, string> = {
  open: 'Open',
  in_progress: 'Being looked at',
  waiting_on_user: 'Waiting on you',
  resolved: 'Resolved',
}
export const ticketStatusTone: Record<TicketStatus, Tone> = { open: 'blue', in_progress: 'indigo', waiting_on_user: 'amber', resolved: 'green' }
