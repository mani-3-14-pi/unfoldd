import { api } from '@/lib/api'

// Communication (Flow 11, D17–D20): /api/clients/:id/conversations.

export type ContextType = 'content' | 'content_plan' | 'campaign' | 'task' | 'meeting' | 'request' | 'client_general'

export interface Conversation {
  id: string
  context: { type: ContextType; id: string | null }
  /** Internal and client conversations are separate threads, never one toggle (D20). */
  visibility: 'internal' | 'client'
  messageCount: number
  lastMessageAt: string | null
  last: { body: string; author: { name: string; side: 'agency' | 'client' }; at: string } | null
}

export interface ConversationMessage {
  _id: string
  author: { id: string; name: string; side: 'agency' | 'client' }
  body: string
  voice?: { file: string | null; durationMs?: number; transcript?: string }
  createdAt: string
}

export const conversationsApi = {
  list: (client: string) => api<{ items: Conversation[] }>(`/clients/${client}/conversations`),
  /** 50 at a time, oldest first; `before` pages further back. */
  messages: (client: string, thread: string, before?: string) =>
    api<{ items: ConversationMessage[] }>(`/clients/${client}/conversations/${thread}/messages${before ? `?before=${encodeURIComponent(before)}` : ''}`),
  post: (client: string, thread: string, body: string) =>
    api<{ message: ConversationMessage }>(`/clients/${client}/conversations/${thread}/messages`, { body: { body } }),
}

export const conversationsKey = (client: string) => ['agency', 'conversations', client]
