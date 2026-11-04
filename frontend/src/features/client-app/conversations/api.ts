import { api } from '@/lib/api'

// Conversations (F66/F67, D18/D19): the General thread plus contextual ones, client-visible only.

export interface Conversation {
  id: string
  context: { type: string; id: string | null }
  visibility: 'client'
  messageCount: number
  lastMessageAt: string | null
  last: { body: string; author: { name: string; side: 'agency' | 'client' }; at: string } | null
}

export interface ConversationMessage {
  _id: string
  author: { id: string; name: string; side: 'agency' | 'client' }
  body: string
  createdAt: string
}

export const clientConversationsApi = {
  list: () => api<{ items: Conversation[] }>('/client/conversations'),
  /** 50 at a time, oldest first; `before` pages further back. */
  messages: (threadId: string, before?: string) =>
    api<{ items: ConversationMessage[] }>(`/client/conversations/${threadId}/messages${before ? `?before=${encodeURIComponent(before)}` : ''}`),
  post: (threadId: string, body: string) => api<{ message: ConversationMessage }>(`/client/conversations/${threadId}/messages`, { body: { body } }),
}

/** What a conversation is about, from its context. */
export const conversationContextLabel: Record<string, string> = {
  client_general: 'General',
  content: 'Content',
  content_plan: 'Content plan',
  campaign: 'Campaign',
  meeting: 'Meeting',
  request: 'Request',
  task: 'Task',
}
