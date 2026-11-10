// Calls to the Unfoldd API (backend/). The session is an httpOnly cookie; Vite proxies /api in dev.

export class ApiError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; idempotent?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {}
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'
  if (init.idempotent) headers['Idempotency-Key'] = crypto.randomUUID()
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      credentials: 'same-origin',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
  } catch {
    throw new ApiError(0, 'offline', 'Cannot reach the server. Check your connection and try again.')
  }
  if (res.status === 204) return undefined as T
  const data = res.headers.get('content-type')?.includes('application/json') ? await res.json() : null
  if (!res.ok) {
    if (!data?.error) throw new ApiError(res.status, 'offline', 'Cannot reach the server. Check your connection and try again.')
    throw new ApiError(res.status, data.error.code, data.error.message)
  }
  return data as T
}

// ---- Types (the parts of the backend responses this app uses) ----

export interface Me {
  context: 'agency' | 'client'
  user: { id: string; name: string; email: string }
  agency: { id: string; name: string }
  client?: { id: string; name: string; brandName?: string }
  role: string
  contexts: { agencies: unknown[]; clients: { clientId: string; name: string }[] }
}

export interface ContentCard {
  id: string
  title: string
  platform: string
  format: string
  publishDate: string | null
  status: { bucket: string | null; label: string; delayed: boolean }
  versionNumber: number | null
  cover: { url: string | null } | null
  updatedAt: string
}

export interface ContentFile {
  id: string
  name?: string
  mimeType?: string
  url: string | null
}

export interface ContentDetail {
  id: string
  title: string
  platform: string
  format: string
  publishDate: string | null
  status: { bucket: string | null; label: string; delayed: boolean }
  state: string
  approved: { by: string; at: string } | null
  version: { _id: string; number: number; caption: string; hashtags: string[]; files: ContentFile[] } | null
  decisions: { _id: string; decision: string; by: { name: string }; versionNumber: number; note: string; createdAt: string }[]
  can: { comment: boolean; decide: boolean }
}

export interface Message {
  _id: string
  author: { id: string; name: string; side: 'agency' | 'client' }
  body: string
  voice?: { file: string; durationMs: number; transcript?: string; transcriptStatus?: 'pending' | 'done' | 'failed' }
  createdAt: string
}

/** A recorded voice note, already uploaded, sent with a comment or reply. */
export type VoiceInput = { file: string; durationMs: number }

/** A mark drawn on the creative. Points are 0–1 on the slide, so they fit any screen. */
export interface Shape {
  type: 'pen' | 'circle' | 'rect' | 'arrow' | 'highlight' | 'text'
  points: { x: number; y: number }[]
  color?: string
  width?: number
  text?: string
}

/** Where a comment points: a slide, a moment of a video, and what was drawn there. */
export interface Anchor {
  versionFile?: string | null
  timeMs?: number | null
  shapes?: Shape[]
}

export interface Thread {
  _id: string
  /** The version the comment is on. */
  version: string
  kind: 'feedback' | 'discussion'
  pin: number | null
  status: string | null
  draft: boolean
  anchor?: Anchor | null
  author: { id: string; name: string; side: 'agency' | 'client' }
  messages: Message[]
  createdAt: string
}

export interface ClientRequest {
  id: string
  title: string
  description: string
  why: string
  due: string
  priority: string
  status: 'open' | 'submitted' | 'completed' | 'cancelled'
  label: string
  overdue: boolean
  returnNote: string
  response: string
}

// ---- Endpoints ----

export const auth = {
  login: (email: string, password: string) =>
    api<{ ok?: true; context?: 'client' | 'agency'; mfa?: 'setup' | 'verify' }>('/auth/login', { body: { email, password } }),
  logout: () => api<void>('/auth/logout', { method: 'POST' }),
  me: () => api<Me>('/auth/me'),
  switchClient: (clientId: string) => api<void>('/auth/switch', { body: { clientId } }),
}

export const content = {
  list: (bucket?: string, sort: 'updated' | 'publish_date' = 'updated') =>
    api<{ items: ContentCard[]; counts: Record<string, number> }>(`/client/content?${bucket ? `status=${bucket}&` : ''}sort=${sort}&pageSize=50`),
  get: (id: string) => api<{ content: ContentDetail }>(`/client/content/${id}`),
  threads: (id: string) => api<{ items: Thread[] }>(`/client/content/${id}/threads`),
  /** A new comment is a draft only the writer sees until it is sent (or sent along with a decision). */
  addComment: (id: string, versionId: string, body: string, extra: { voice?: VoiceInput; anchor?: Anchor } = {}) =>
    api<{ thread: Thread }>(`/client/content/${id}/threads`, { body: { versionId, body, ...extra }, idempotent: true }),
  reply: (id: string, threadId: string, body: string, voice?: VoiceInput) =>
    api<{ message: Message }>(`/client/content/${id}/threads/${threadId}/messages`, { body: { body, voice } }),
  sendFeedback: (id: string, versionId: string) =>
    api<{ submitted: number }>(`/client/content/${id}/review/submit`, { body: { versionId }, idempotent: true }),
  approve: (id: string, versionId: string, expectedState: string, note: string) =>
    api<{ content: ContentDetail }>(`/client/content/${id}/approve`, {
      body: { versionId, expectedState, note, confirm: false, drafts: 'post_as_messages' },
      idempotent: true,
    }),
  requestChanges: (id: string, versionId: string, expectedState: string, note: string) =>
    api<{ content: ContentDetail }>(`/client/content/${id}/request-changes`, { body: { versionId, expectedState, note, confirm: false }, idempotent: true }),
}

export const files = {
  /** Creates the file record, PUTs the bytes to storage, then asks the server to check they arrived. */
  upload: async (file: File, purpose: 'attachment' | 'request' | 'library') => {
    const created = await api<{ file: { id: string }; upload: { url: string; method: 'PUT'; headers: Record<string, string> } }>('/files', {
      body: { name: file.name, mimeType: file.type || 'application/octet-stream', size: file.size, purpose },
      idempotent: true,
    })
    let put: Response
    try {
      put = await fetch(created.upload.url, { method: 'PUT', headers: created.upload.headers, body: file })
    } catch {
      throw new ApiError(0, 'upload_failed', 'The upload failed. Check your connection and try again.')
    }
    if (!put.ok) throw new ApiError(put.status, 'upload_failed', 'The upload was rejected. Try again.')
    const { file: done } = await api<{ file: { id: string; status: string; error?: string } }>(`/files/${created.file.id}/complete`, { method: 'POST' })
    if (done.status === 'failed') throw new ApiError(422, 'upload_failed', done.error ?? 'The upload failed. Try again.')
    return done
  },
  /** A short-lived link to play or view a file. */
  url: (id: string) => api<{ url: string; expiresAt: string }>(`/files/${id}/download?inline=true`),
}

export const requests = {
  list: () => api<{ items: ClientRequest[] }>('/client/requests'),
  submit: (id: string, response: string) => api<{ request: ClientRequest }>(`/client/requests/${id}/submit`, { body: { response }, idempotent: true }),
}

// ---- Brand DNA ----

/** The six onboarding steps, in order. The first four are also the sections the client edits. */
export type OnboardingStep = 'intro' | 'personality' | 'likes' | 'dislikes' | 'references' | 'assets'
export type ClientSection = 'intro' | 'personality' | 'likes' | 'dislikes'

export interface IntroData {
  whatWeDo: string
  standFor: string
  audience: string
  offerings: { name: string; description: string }[]
  website: string
  socials: { instagram: string; facebook: string; linkedin: string; youtube: string; x: string; tiktok: string; other: string[] }
}
export interface PersonalityData {
  axes: Record<string, number>
  keywords: string
}
export interface StyleData {
  tags: string[]
  note: string
}

export interface BrandSectionState<T = Record<string, unknown>> {
  data: Partial<T>
  rev: number
  updatedBy?: { name: string; side: 'agency' | 'client' }
  updatedAt?: string
}

export interface Onboarding {
  steps: { key: OnboardingStep; completedAt: string | null }[]
  done: number
  total: number
  percent: number
  assetRequestsOpen: number
  mode: 'wizard' | 'hub'
}

export interface Brand {
  sections: {
    intro: BrandSectionState<IntroData>
    personality: BrandSectionState<PersonalityData>
    likes: BrandSectionState<StyleData>
    dislikes: BrandSectionState<StyleData>
    audience: BrandSectionState<Record<string, string>>
    positioning: BrandSectionState<{ text: string }>
    tone: BrandSectionState<{ text: string }>
    visualIdentity: BrandSectionState<{ text: string }>
  }
  onboarding: Onboarding
  meta: { personalityAxes: { key: string; left: string; right: string }[]; styleTags: string[] }
}

export interface BrandReference {
  _id: string
  sentiment: 'like' | 'dislike' | 'neutral'
  link: string
  note: string
  imageUrl: string | null
  addedBy: { id: string; name: string; side: 'agency' | 'client' }
  createdAt: string
}

export interface AssetRequest {
  _id: string
  title: string
  status: 'open' | 'submitted' | 'completed'
}

export const brand = {
  /** A section nobody has filled yet comes back without `data` (the database drops empty objects). */
  get: async () => {
    const { brand: b } = await api<{ brand: Brand }>('/client/brand')
    const sections = Object.fromEntries(Object.entries(b.sections ?? {}).map(([k, s]) => [k, { ...s, data: s?.data ?? {}, rev: s?.rev ?? 1 }]))
    return { brand: { ...b, sections: sections as unknown as Brand['sections'] } }
  },
  save: <T>(section: ClientSection, rev: number, data: T) =>
    api<{ section: BrandSectionState<T> }>(`/client/brand/sections/${section}`, { method: 'PUT', body: { rev, data } }),
  onboarding: () => api<{ onboarding: Onboarding; assetRequests: AssetRequest[] }>('/client/brand/onboarding'),
  /** Marks a step done ("Done" or "Nothing to add"); doing it twice is harmless. */
  complete: (step: OnboardingStep) => api<{ onboarding: Onboarding }>(`/client/brand/onboarding/${step}/complete`, { method: 'POST' }),
  references: () => api<{ items: BrandReference[] }>('/client/brand/references'),
  addReference: (sentiment: BrandReference['sentiment'], link: string, note: string) =>
    api<{ reference: BrandReference }>('/client/brand/references', { body: { sentiment, link, note }, idempotent: true }),
  removeReference: (id: string) => api<void>(`/client/brand/references/${id}`, { method: 'DELETE' }),
}

/** Roles that may edit the Brand DNA (the backend's `editBrand`). Viewers only read it. */
export const canEditBrand = (role: string) => ['admin', 'approver', 'contributor'].includes(role)

export interface InviteInfo {
  status: 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired'
  kind: 'agency' | 'client'
  email: string
  role: string
  message: string
  invitedBy: string | null
  expiresAt: string
  agency: { name: string } | null
  client: { name: string; brandName: string } | null
  accountExists: boolean
}

export const invites = {
  get: (token: string) => api<InviteInfo>(`/invitations/${encodeURIComponent(token)}`),
  /** Creates the account (name + password) or, for an existing login, checks its password. Signs in either way. */
  accept: (token: string, password: string, name?: string) =>
    api<{ ok: true; mfa?: string }>(`/invitations/${encodeURIComponent(token)}/accept`, { body: { password, name }, idempotent: true }),
}
