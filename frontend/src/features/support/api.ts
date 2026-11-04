import { api } from '@/lib/api'
import type { Page } from '@/types/api'

// Support tickets to the Unfoldd team (P161–P163, D67 "Report issue"): /api/support. You see only your own.

export const TICKET_CATEGORIES = ['bug', 'question', 'account', 'billing', 'feature_request', 'other'] as const
export type TicketCategory = (typeof TICKET_CATEGORIES)[number]
export type TicketStatus = 'open' | 'in_progress' | 'waiting_on_user' | 'resolved'

export interface Ticket {
  _id: string
  category: TicketCategory
  subject: string
  status: TicketStatus
  messages: { from: 'user' | 'support'; author: { id: string; name: string }; body: string; at: string }[]
  lastMessageAt: string
  resolvedAt: string | null
  createdAt: string
}

export const supportApi = {
  list: (query: string) => api<Page<Ticket>>(`/support/tickets?${query}`),
  get: (id: string) => api<{ ticket: Ticket }>(`/support/tickets/${id}`),
  create: (body: { category: TicketCategory; subject: string; message: string; context?: { url?: string } }, idempotencyKey: string) =>
    api<{ ticket: Ticket }>('/support/tickets', { body, idempotencyKey }),
  reply: (id: string, body: string) => api<{ ticket: Ticket }>(`/support/tickets/${id}/messages`, { body: { body } }),
}
