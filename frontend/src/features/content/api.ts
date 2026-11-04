import { api } from '@/lib/api'
import type { Page, UpdatedBy } from '@/types/api'

// Agency side of content (Flow 5, 7, 8): /api/content and /api/feedback.

/** §6.1: the one content state machine. Every other status is derived from it on the server. */
export const CONTENT_STATES = [
  'planned',
  'in_production',
  'internal_review',
  'ready_for_client',
  'client_review',
  'changes_requested',
  'approved',
  'scheduled',
  'publishing',
  'published',
  'cancelled',
] as const
export type ContentState = (typeof CONTENT_STATES)[number]

export const PLATFORMS = ['instagram', 'facebook', 'linkedin', 'youtube', 'tiktok', 'x', 'pinterest', 'website', 'other'] as const
export type Platform = (typeof PLATFORMS)[number]
export const FORMATS = ['feed_4x5', 'square_1x1', 'story_9x16', 'landscape_16x9', 'carousel', 'video', 'reel', 'linkedin', 'other'] as const
export type Format = (typeof FORMATS)[number]
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
export type Priority = (typeof PRIORITIES)[number]
export type ApprovalStatus = 'not_sent' | 'sent' | 'viewed' | 'changes_requested' | 'approved'
export const SHIFT_REASONS = ['client_delay', 'agency_delay', 'strategy_change', 'missed_slot', 'platform_issue', 'other'] as const
export type ShiftReason = (typeof SHIFT_REASONS)[number]

export interface VersionFile {
  /** The slide's own id: feedback anchors point here, never at an index (D11). */
  _id: string
  file: string
  width?: number
  height?: number
  durationMs?: number
}

export interface Version {
  _id: string
  number: number
  files: VersionFile[]
  caption: string
  hashtags: string[]
  changeNote: string
  createdBy: { id: string; name: string }
  /** Set at the first submit; after that a change is a new version. */
  lockedAt: string | null
  sentToClientAt: string | null
  firstViewedAt: string | null
  firstViewedBy?: { id: string; name: string }
  withdrawnAt: string | null
  createdAt: string
}

export interface ReviewDecision {
  _id: string
  version: string
  versionNumber: number
  scope: 'internal' | 'client'
  decision: 'approved' | 'changes_requested' | 'pulled'
  by: { id: string; name: string }
  note: string
  createdAt: string
}

export interface PublishJob {
  _id: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'unknown' | 'cancelled'
  account: { kind: string; id: string | null; label: string }
  error: string
  externalUrl: string
  attempts: number
  scheduledBy?: { id: string; name: string }
}

/** Fields shared by the list row and the full record. */
interface ContentBase {
  _id: string
  client: string
  title: string
  platform: Platform
  format: Format
  owner: string | null
  reviewer: string | null
  priority: Priority
  due: string
  publishDate: string | null
  state: ContentState
  stateChangedAt: string
  currentVersion: string | null
  updatedAt: string
  createdAt: string
}

export interface ContentRow extends ContentBase {
  clientInfo?: { _id: string; name: string; brandName: string }
  ownerInfo?: { _id: string; name: string }
  version?: { number: number; sentToClientAt: string | null; firstViewedAt: string | null }
  approvalStatus: ApprovalStatus
}

export interface ContentDetail extends ContentBase {
  idea: string
  concept: string
  objective: string
  brief: string
  collaborators: string[]
  campaign: string | null
  plan: string | null
  sendAt: string | null
  revisionLimit: number | null
  approvedVersion: string | null
  approvedAt: string | null
  approvedBy?: { id: string; name: string }
  clientVisibleAt: string | null
  externalUrl: string
  publishedAt: string | null
  publishedBy?: { id: string; name: string }
  rev: number
  updatedBy?: UpdatedBy
  versions: Version[]
  decisions: ReviewDecision[]
  publishJob: PublishJob | null
  derived: {
    approvalStatus: ApprovalStatus
    clientStatus: { bucket: string | null; label: string; delayed: boolean }
    revisions: { used: number; included: number; over: boolean }
    timing: { neededBy: string; daysRemaining: number; atRisk: boolean; overdueForApproval: boolean } | null
  }
}

/** `GET /content/:id` replaces `client` with the client's summary. */
export type ContentRecord = Omit<ContentDetail, 'client'> & {
  client: { _id: string; name: string; brandName: string; timezone: string; contract: { revisionsIncluded: number; approvalLeadHours: number; internalReview: boolean } }
}

export type ContentPage = Page<ContentRow> & { counts: Record<ContentState, number> }

export interface ContentInput {
  title: string
  platform: Platform
  format: Format
  idea?: string
  concept?: string
  objective?: string
  brief?: string
  owner?: string | null
  reviewer?: string | null
  priority?: Priority
  due?: string
  publishDate?: string | null
  revisionLimit?: number | null
}

export interface Shape {
  type: 'pen' | 'circle' | 'rect' | 'arrow' | 'highlight' | 'text'
  /** 0–1 coordinates on the slide (D12), so they fit any screen. */
  points: { x: number; y: number }[]
  color?: string
  width?: number
  text?: string
}

export interface Anchor {
  versionFile?: string | null
  timeMs?: number | null
  shapes?: Shape[]
}

export interface Message {
  _id: string
  author: { id: string; name: string; side: 'agency' | 'client' }
  body: string
  voice?: { file: string; durationMs: number; transcript: string; transcriptStatus: string; transcriptLabel: string }
  createdAt: string
}

export type ThreadStatus = 'open' | 'in_progress' | 'resolved'

export interface Thread {
  _id: string
  version: string | null
  versionNumber: number | null
  kind: 'feedback' | 'discussion'
  visibility: 'internal' | 'client'
  /** D75: client ① ②, internal I-1, I-2. Null on drafts. */
  pin: number | null
  anchor?: Anchor
  assignee: string | null
  status: ThreadStatus | null
  reopenedAt: string | null
  resolvedAt: string | null
  resolvedBy?: { id: string; name: string }
  resolvedInVersion?: { id: string; number: number }
  resolutionNote: string
  closedOnApproval: boolean
  author: { id: string; name: string; side: 'agency' | 'client' }
  submittedAt: string | null
  draft: boolean
  messages: Message[]
  createdAt: string
}

export interface InboxThread {
  _id: string
  content: string
  versionNumber: number | null
  visibility: 'internal' | 'client'
  pin: number | null
  status: ThreadStatus
  reopenedAt: string | null
  assignee: string | null
  author: { name: string; side: 'agency' | 'client' }
  submittedAt: string
  messageCount: number
  contentInfo?: { title: string; state: ContentState; platform: Platform }
  clientInfo?: { brandName: string }
  first?: { body: string; voice?: { file: string | null } }
}

export interface ChecklistItem {
  _id: string
  text: string
  suggestedText: string
  sourceThreads: string[]
  origin: 'ai' | 'human'
  status: 'suggested' | 'accepted' | 'removed'
  task: string | null
  done: boolean
}

export interface Checklist {
  version: { id: string; number: number }
  ai: { enabled: boolean; run: { status: 'queued' | 'running' | 'done' | 'failed' | 'skipped'; error?: string; suggestions: number; finishedAt?: string; model?: string } | null }
  items: ChecklistItem[]
}

export interface QueueItem {
  _id: string
  title: string
  client: string
  state: ContentState
  stateChangedAt: string
  publishDate: string | null
  owner: string | null
  reviewer: string | null
}

export interface Queues {
  awaitingReview: QueueItem[]
  readyForClient: QueueItem[]
  awaitingClient: QueueItem[]
  changesRequested: QueueItem[]
  readyToSchedule: QueueItem[]
}

export interface Connection {
  _id: string
  platform: string
  name: string
  status: 'active' | 'expired' | 'error' | 'disconnected'
}

export interface FileMeta {
  id: string
  name: string
  mimeType: string
  size: number
  status: 'uploading' | 'processing' | 'ready' | 'failed'
}

const post = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body })

export const contentApi = {
  list: (query: string) => api<ContentPage>(`/content?${query}`),
  queues: () => api<Queues>('/content/queues'),
  get: (id: string) => api<{ content: ContentRecord }>(`/content/${id}`),
  create: (body: ContentInput & { client: string; planned?: boolean }, idempotencyKey: string) =>
    api<{ content: ContentRecord }>('/content', { body, idempotencyKey }),
  update: (id: string, body: Partial<ContentInput> & { rev: number; shiftReason?: ShiftReason }) =>
    api<{ content: ContentRecord }>(`/content/${id}`, { method: 'PATCH', body }),

  uploadVersion: (
    id: string,
    body: { files: string[]; caption: string; hashtags: string[]; changeNote: string; resolves: string[]; resolutionNote: string },
    idempotencyKey: string,
  ) => api<{ versionId: string; number: number }>(`/content/${id}/versions`, { body, idempotencyKey }),

  startProduction: (id: string) => post(`/content/${id}/start-production`),
  submit: (id: string) => post(`/content/${id}/submit`),
  internalReview: (id: string, decision: 'approve' | 'approve_and_send' | 'request_changes', note: string) =>
    post(`/content/${id}/internal-review`, { decision, note }),
  send: (id: string, body: { sendAt?: string | null; note?: string }) => post(`/content/${id}/send`, body),
  continueEditing: (id: string) => post(`/content/${id}/continue-editing`),
  schedule: (id: string, publishDate: string, account: string | null) => post(`/content/${id}/schedule`, { publishDate, account }),
  unschedule: (id: string) => post(`/content/${id}/unschedule`),
  markPublished: (id: string, url: string) => post(`/content/${id}/mark-published`, { url }),
  retryPublish: (id: string) => post(`/content/${id}/retry-publish`),
  cancel: (id: string, note: string) => post(`/content/${id}/cancel`, { note }),
  restore: (id: string) => post(`/content/${id}/restore`),

  threads: (id: string) => api<{ items: Thread[] }>(`/content/${id}/threads`),
  comment: (id: string, body: { visibility: 'internal' | 'client'; body: string; anchor?: Anchor; assignee?: string | null }) =>
    api<{ thread: Thread }>(`/content/${id}/threads`, { body }),
  reply: (id: string, threadId: string, body: string) => api<{ message: Message }>(`/content/${id}/threads/${threadId}/messages`, { body: { body } }),
  updateThread: (id: string, threadId: string, body: { status?: ThreadStatus; assignee?: string | null; resolutionNote?: string }) =>
    api<{ thread: Thread }>(`/content/${id}/threads/${threadId}`, { method: 'PATCH', body }),
  threadToTask: (id: string, threadId: string) => post<{ task: { _id: string; title: string } }>(`/content/${id}/threads/${threadId}/task`),
  inbox: (query: string) => api<Page<InboxThread>>(`/feedback?${query}`),

  checklist: (id: string) => api<Checklist>(`/content/${id}/checklist`),
  runChecklist: (id: string) => post(`/content/${id}/checklist/run`),
  addChecklistItem: (id: string, text: string) => post<{ item: ChecklistItem }>(`/content/${id}/checklist/items`, { text }),
  updateChecklistItem: (id: string, itemId: string, body: { text?: string; status?: ChecklistItem['status'] }) =>
    api<{ item: ChecklistItem }>(`/content/${id}/checklist/items/${itemId}`, { method: 'PATCH', body }),
  checklistToTask: (id: string, itemId: string) => post<{ task: { _id: string; title: string } }>(`/content/${id}/checklist/items/${itemId}/task`),

  connections: (client: string) => api<{ items: Connection[] }>(`/integrations/connections?client=${client}`),
  file: (id: string) => api<{ file: FileMeta }>(`/files/${id}`),
  fileUrl: (id: string) => api<{ url: string; expiresAt: string }>(`/files/${id}/download?inline=true`),
}

export const contentKey = (id: string) => ['agency', 'content', 'detail', id]
