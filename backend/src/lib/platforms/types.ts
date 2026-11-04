/*
 * The contract every publishing integration implements (D27, D66, D79). Providers never touch the database;
 * the publish worker and the integration routes do.
 */

export interface Tokens {
  accessToken: string
  refreshToken?: string | null
  /** Null = doesn't expire (e.g. Meta page tokens). */
  expiresAt?: Date | null
  scopes?: string[]
}

/** One account the person can connect to a client: a Facebook page, an IG business account, a LinkedIn page … */
export interface ConnectableAccount {
  platform: PlatformKey
  externalId: string
  name: string
  handle?: string
  /** Tokens for this account specifically (page tokens differ from the user token on Meta). */
  tokens: Tokens
  meta?: Record<string, unknown>
}

export interface MediaItem {
  /** A signed URL the platform (or we) can fetch the file from. */
  url: string
  mimeType: string
  size: number
  name: string
}

export interface PostInput {
  format: string
  caption: string
  hashtags: string[]
  title: string
  media: MediaItem[]
}

export interface PostResult {
  externalId: string
  url: string
}

/** D58 minimum metric set. Missing ones stay undefined and show as "n/a". */
export interface Metrics {
  impressions?: number
  reach?: number
  views?: number
  likes?: number
  comments?: number
  shares?: number
  saves?: number
  linkClicks?: number
}

/**
 * How a publish failed, which decides what happens next (D79):
 *  - retryable: nothing was posted yet (upload/preparation failed); try again later.
 *  - failed:    the platform refused; a person fixes it and retries.
 *  - auth:      the connection needs reconnecting.
 *  - unknown:   we sent the post and don't know if it went out (timeout). Never retried automatically.
 */
export class PublishError extends Error {
  kind: 'retryable' | 'failed' | 'auth' | 'unknown'
  constructor(kind: PublishError['kind'], message: string) {
    super(message)
    this.kind = kind
  }
}

export interface PlatformProvider {
  key: PlatformKey
  label: string
  /** Formats it can publish; anything else must go manual. */
  formats: readonly string[]
  configured(): boolean
  authorizeUrl(input: { state: string; redirectUri: string; codeChallenge?: string }): string
  /** Exchanges the OAuth code and lists the accounts the person can connect. */
  connect(input: { code: string; redirectUri: string; codeVerifier?: string }): Promise<ConnectableAccount[]>
  refresh?(tokens: Tokens): Promise<Tokens>
  /** Cheap call proving the token still works (D27's 24-hour check). */
  check(account: { externalId: string; tokens: Tokens }): Promise<void>
  publish(account: { externalId: string; tokens: Tokens }, post: PostInput): Promise<PostResult>
  metrics?(account: { externalId: string; tokens: Tokens }, externalId: string): Promise<Metrics>
}

export const PLATFORM_KEYS = ['instagram', 'facebook', 'linkedin', 'youtube', 'x'] as const
export type PlatformKey = (typeof PLATFORM_KEYS)[number]

/** OAuth "app" behind each platform: Meta covers Instagram and Facebook in one sign-in. */
export const OAUTH_APPS = ['meta', 'linkedin', 'youtube', 'x'] as const
export type OAuthApp = (typeof OAUTH_APPS)[number]

// ── HTTP helper ──────────────────────────────────────────────────────────────

/**
 * fetch with a timeout that classifies failures. `final` marks the call that actually publishes: if it times
 * out or the server errors, the post may already be live, so the outcome is `unknown` (never auto-retried).
 */
export async function call(url: string, init: RequestInit & { final?: boolean; timeoutMs?: number } = {}) {
  const { final = false, timeoutMs = 60_000, ...rest } = init
  let res: Response
  try {
    res = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new PublishError(final ? 'unknown' : 'retryable', `${final ? 'No answer after sending' : 'Network error'}: ${msg}`)
  }
  if (res.ok) return res
  const body = (await res.text()).slice(0, 500)
  if (res.status === 401) throw new PublishError('auth', `The platform rejected the connection (401): ${body}`)
  if (res.status === 429) throw new PublishError(final ? 'unknown' : 'retryable', `Rate limited: ${body}`)
  if (res.status >= 500) throw new PublishError(final ? 'unknown' : 'retryable', `Platform error ${res.status}: ${body}`)
  throw new PublishError('failed', `Platform refused (${res.status}): ${body}`)
}

export const json = async <T = any>(res: Response) => (await res.json()) as T

/** Caption + hashtags as one text, as most platforms want it. */
export const fullCaption = (p: PostInput) => [p.caption, p.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ')].filter(Boolean).join('\n\n')

export const isVideo = (m: MediaItem) => m.mimeType.startsWith('video/')
export const isImage = (m: MediaItem) => m.mimeType.startsWith('image/')

export async function bytesOf(item: MediaItem) {
  const res = await call(item.url, { timeoutMs: 300_000 })
  return Buffer.from(await res.arrayBuffer())
}
