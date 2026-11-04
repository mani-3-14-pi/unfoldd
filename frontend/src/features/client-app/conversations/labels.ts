import { conversationContextLabel, type Conversation } from './api'

/** "General · Fern Studio" for the General thread, else what the conversation is attached to. */
export const conversationTitle = (c: Conversation, agency: string) =>
  c.context.type === 'client_general' ? `General · ${agency}` : `About a ${(conversationContextLabel[c.context.type] ?? 'topic').toLowerCase()}`
