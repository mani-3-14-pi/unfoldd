import { api } from '@/lib/api'
import type { Anchor, Format, Message, Platform, Thread, Version } from '@/features/content/api'
import type { SlideMedia } from '@/features/content/CreativeViewer'
import type { Page } from '@/types/api'

// The Client App's content (F15–F45): /api/client/content. A client sees content only once it was sent (D64),
// only sent versions, and only `client` feedback (D20).

/** F16/F17 filter buckets, in the order the client sees them (D03). */
export const CLIENT_BUCKETS = ['review_required', 'in_progress', 'changes_requested', 'approved', 'scheduled', 'published', 'cancelled'] as const
export type ClientBucket = (typeof CLIENT_BUCKETS)[number]

/** What the client sees instead of the agency's state (§6.2). `delayed` = neutral "Publishing delayed" (D65). */
export interface ClientStatus {
  bucket: ClientBucket | null
  label: string
  delayed: boolean
}

export interface ClientFile {
  id: string
  name?: string
  mimeType?: string
  width?: number | null
  height?: number | null
  durationMs?: number | null
  /** Signed, short-lived; null when storage isn't set up or the file isn't ready. */
  url: string | null
}

export interface ClientContentCard {
  id: string
  title: string
  platform: Platform
  format: Format
  publishDate: string | null
  status: ClientStatus
  versionNumber: number | null
  cover: ClientFile | null
  updatedAt: string
}

export interface ClientVersion {
  id: string
  number: number
  caption: string
  hashtags: string[]
  sentToClientAt: string | null
  withdrawnAt: string | null
  isCurrent: boolean
  files: ClientFile[]
}

export interface ClientDecision {
  _id: string
  decision: 'approved' | 'changes_requested' | 'pulled'
  by: { name: string }
  versionNumber: number
  note: string
  createdAt: string
}

export interface ClientContentDetail {
  id: string
  title: string
  platform: Platform
  format: Format
  publishDate: string | null
  status: ClientStatus
  /** Echoed back as `expectedState` on decisions (D07). */
  state: string
  approved: { by: string; at: string } | null
  published: { at: string; url: string } | null
  /** The version the client should look at: the current one once sent, else the last one they saw. */
  version: (Omit<ClientVersion, 'id'> & { _id: string }) | null
  versions: { id: string; number: number; sentToClientAt: string; withdrawnAt: string | null }[]
  decisions: ClientDecision[]
  delay: { reviewPendingSince: string | null; approvalNeededBy: string | null; shiftedDays: number }
  revisions: { used: number; included: number }
  can: { comment: boolean; decide: boolean }
}

export interface ClientChecklistItem {
  _id: string
  text: string
  versionNumber: number
  done: boolean
  /** The client's own feedback pins this item came from. */
  pins: number[]
}

/** A 409 when someone else decided first (D07). */
export interface DecidedMeanwhile {
  state: string
  decision: { decision: 'approved' | 'changes_requested' | 'pulled'; by: string; at: string; versionNumber: number } | null
}

export interface DecisionInput {
  versionId: string
  expectedState: string
  confirm?: boolean
  note?: string
}

const key = () => crypto.randomUUID()

/** A recorded voice note sent with a comment or reply (feedback.service `buildMessage`). */
type VoiceInput = { file: string; durationMs: number }

export const clientContentApi = {
  list: (query: string) => api<Page<ClientContentCard> & { counts: Record<ClientBucket, number> }>(`/client/content?${query}`),
  get: (id: string) => api<{ content: ClientContentDetail }>(`/client/content/${id}`),
  /** Opening the current version counts as "viewed" for Admins and Approvers (D04). */
  version: (id: string, versionId: string) => api<{ version: ClientVersion }>(`/client/content/${id}/versions/${versionId}`),
  threads: (id: string) => api<{ items: Thread[] }>(`/client/content/${id}/threads`),
  checklist: (id: string) => api<{ items: ClientChecklistItem[] }>(`/client/content/${id}/checklist`),

  /** A comment goes into the person's pending review: only they see it until they send it (D14). */
  addDraft: (id: string, body: { versionId: string; body: string; anchor?: Anchor; voice?: VoiceInput }) =>
    api<{ thread: Thread }>(`/client/content/${id}/threads`, { body, idempotencyKey: key() }),
  editDraft: (id: string, threadId: string, body: { body?: string; anchor?: Anchor | null }) =>
    api<{ thread: Thread }>(`/client/content/${id}/threads/${threadId}`, { method: 'PATCH', body }),
  discardDraft: (id: string, threadId: string) => api<void>(`/client/content/${id}/threads/${threadId}`, { method: 'DELETE' }),
  /** D83: a draft written on a version that was replaced, moved to the current one. */
  copyToCurrent: (id: string, threadId: string) => api<{ thread: Thread }>(`/client/content/${id}/threads/${threadId}/copy-to-current`, { method: 'POST' }),
  reply: (id: string, threadId: string, body: { body: string; voice?: VoiceInput }) => api<{ message: Message }>(`/client/content/${id}/threads/${threadId}/messages`, { body }),
  reopen: (id: string, threadId: string) => api<{ thread: Thread }>(`/client/content/${id}/threads/${threadId}/reopen`, { method: 'POST' }),

  /** "Send feedback": the drafts go to the agency without a decision. */
  submit: (id: string, versionId: string) => api<{ submitted: number }>(`/client/content/${id}/review/submit`, { body: { versionId }, idempotencyKey: key() }),
  approve: (id: string, body: DecisionInput & { drafts?: 'discard' | 'post_as_messages' }) =>
    api<{ content: ClientContentDetail }>(`/client/content/${id}/approve`, { body: { confirm: false, note: '', ...body }, idempotencyKey: key() }),
  /** Request changes in review, or pull an approval before publishing starts (D08). */
  requestChanges: (id: string, body: DecisionInput) =>
    api<{ content: ClientContentDetail }>(`/client/content/${id}/request-changes`, { body: { confirm: false, note: '', ...body }, idempotencyKey: key() }),
}

export const clientContentKey = (id: string) => ['client', 'content', 'detail', id]
export const clientThreadsKey = (id: string) => ['client', 'content', 'threads', id]

/** The shape the shared CreativeViewer takes, plus the signed media for its slides. */
export function toViewer(v: ClientVersion): { version: Version; media: Record<string, SlideMedia> } {
  return {
    version: {
      _id: v.id,
      number: v.number,
      files: v.files.map((f) => ({ _id: f.id, file: f.id, width: f.width ?? undefined, height: f.height ?? undefined, durationMs: f.durationMs ?? undefined })),
      caption: v.caption,
      hashtags: v.hashtags,
      changeNote: '',
      createdBy: { id: '', name: '' },
      lockedAt: null,
      sentToClientAt: v.sentToClientAt,
      firstViewedAt: null,
      withdrawnAt: v.withdrawnAt,
      createdAt: v.sentToClientAt ?? '',
    },
    media: Object.fromEntries(v.files.map((f) => [f.id, { url: f.url, name: f.name, mimeType: f.mimeType }])),
  }
}
