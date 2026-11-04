import { env } from '../../config/env.ts'
import { bytesOf, call, isVideo, json, PublishError, type PlatformProvider, type Tokens } from './types.ts'

/*
 * YouTube Data API v3 with Google OAuth (offline access, so a refresh token is issued).
 * Docs: developers.google.com/youtube/v3/guides/uploading_a_video. Uploads are resumable; one video per post.
 * Unverified Google apps can only upload private videos until the app passes Google's audit.
 */

const SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly']

const tokensFrom = (t: any, previous?: Tokens): Tokens => ({
  accessToken: t.access_token,
  refreshToken: t.refresh_token ?? previous?.refreshToken ?? null,
  expiresAt: t.expires_in ? new Date(Date.now() + t.expires_in * 1000) : null,
  scopes: typeof t.scope === 'string' ? t.scope.split(' ') : SCOPES,
})

async function token(params: Record<string, string>) {
  const res = await call('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...params, client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET! }),
  })
  return json(res)
}

const auth = (t: Tokens) => ({ Authorization: `Bearer ${t.accessToken}` })

export const youtube: PlatformProvider = {
  key: 'youtube',
  label: 'YouTube',
  formats: ['video', 'reel', 'landscape_16x9', 'story_9x16'],
  configured: () => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
  authorizeUrl: ({ state, redirectUri }) =>
    `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID!, redirect_uri: redirectUri, response_type: 'code', scope: SCOPES.join(' '), access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state })}`,
  async connect({ code, redirectUri }) {
    const tokens = tokensFrom(await token({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }))
    const channels = await json(await call('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: auth(tokens) }))
    return (channels.items ?? []).map((c: any) => ({ platform: 'youtube' as const, externalId: c.id, name: c.snippet?.title ?? 'YouTube channel', handle: c.snippet?.customUrl, tokens }))
  },
  async refresh(t) {
    if (!t.refreshToken) throw new PublishError('auth', 'YouTube access expired. Reconnect the channel.')
    return tokensFrom(await token({ grant_type: 'refresh_token', refresh_token: t.refreshToken }), t)
  },
  async check({ tokens }) {
    await call('https://www.googleapis.com/youtube/v3/channels?part=id&mine=true', { headers: auth(tokens) })
  },
  async publish({ tokens }, input) {
    const video = input.media.find(isVideo)
    if (!video) throw new PublishError('failed', 'YouTube needs a video.')
    const tags = input.hashtags.map((h) => h.replace(/^#/, '')).slice(0, 30)
    const start = await call('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
      method: 'POST',
      headers: { ...auth(tokens), 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': video.mimeType },
      body: JSON.stringify({ snippet: { title: input.title.slice(0, 100), description: input.caption.slice(0, 5000), tags }, status: { privacyStatus: 'public', selfDeclaredMadeForKids: false } }),
    })
    const uploadUrl = start.headers.get('location')
    if (!uploadUrl) throw new PublishError('retryable', 'YouTube didn’t return an upload address.')
    const bytes = await bytesOf(video)
    // The upload completing is the moment the video exists: treat it as the final call.
    const done = await json(await call(uploadUrl, { method: 'PUT', final: true, timeoutMs: 30 * 60_000, headers: { 'Content-Type': video.mimeType }, body: new Uint8Array(bytes) }))
    return { externalId: done.id, url: `https://youtu.be/${done.id}` }
  },
  async metrics({ tokens }, videoId) {
    const res = await json(await call(`https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${encodeURIComponent(videoId)}`, { headers: auth(tokens) }))
    const s = res.items?.[0]?.statistics ?? {}
    const n = (v: unknown) => (v == null ? undefined : Number(v))
    return { views: n(s.viewCount), impressions: n(s.viewCount), likes: n(s.likeCount), comments: n(s.commentCount) }
  },
}
