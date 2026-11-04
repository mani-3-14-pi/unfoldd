import { env } from '../../config/env.ts'
import { bytesOf, call, fullCaption, isImage, json, PublishError, type PlatformProvider, type Tokens } from './types.ts'

/*
 * X (Twitter) API v2 with OAuth 2.0 + PKCE. Docs: docs.x.com/x-api/posts/manage-tweets and /media.
 * Posting needs a paid API tier. Images upload with the v2 media endpoint; videos (chunked upload) go manual.
 */

const SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'media.write', 'offline.access']

const basic = () => `Basic ${Buffer.from(`${env.X_CLIENT_ID}:${env.X_CLIENT_SECRET}`).toString('base64')}`

const tokensFrom = (t: any): Tokens => ({
  accessToken: t.access_token,
  refreshToken: t.refresh_token ?? null,
  expiresAt: t.expires_in ? new Date(Date.now() + t.expires_in * 1000) : null,
  scopes: typeof t.scope === 'string' ? t.scope.split(' ') : SCOPES,
})

async function token(params: Record<string, string>) {
  const res = await call('https://api.x.com/2/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basic() },
    body: new URLSearchParams({ ...params, client_id: env.X_CLIENT_ID! }),
  })
  return tokensFrom(await json(res))
}

const auth = (t: Tokens) => ({ Authorization: `Bearer ${t.accessToken}` })

export const x: PlatformProvider = {
  key: 'x',
  label: 'X',
  formats: ['square_1x1', 'landscape_16x9', 'feed_4x5', 'other'],
  configured: () => !!(env.X_CLIENT_ID && env.X_CLIENT_SECRET),
  authorizeUrl: ({ state, redirectUri, codeChallenge }) =>
    `https://x.com/i/oauth2/authorize?${new URLSearchParams({ response_type: 'code', client_id: env.X_CLIENT_ID!, redirect_uri: redirectUri, scope: SCOPES.join(' '), state, code_challenge: codeChallenge!, code_challenge_method: 'S256' })}`,
  async connect({ code, redirectUri, codeVerifier }) {
    const tokens = await token({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: codeVerifier! })
    const me = await json(await call('https://api.x.com/2/users/me', { headers: auth(tokens) }))
    return [{ platform: 'x' as const, externalId: me.data.id, name: me.data.name, handle: me.data.username, tokens }]
  },
  refresh: (t) => {
    if (!t.refreshToken) throw new PublishError('auth', 'X access expired. Reconnect the account.')
    return token({ grant_type: 'refresh_token', refresh_token: t.refreshToken })
  },
  async check({ tokens }) {
    await call('https://api.x.com/2/users/me', { headers: auth(tokens) })
  },
  async publish({ tokens }, input) {
    const images = input.media.filter(isImage)
    if (input.media.length > images.length) throw new PublishError('failed', 'Video posts to X aren’t supported yet. Publish this one by hand.')
    const mediaIds: string[] = []
    for (const m of images.slice(0, 4)) {
      const form = new FormData()
      form.append('media', new Blob([new Uint8Array(await bytesOf(m))], { type: m.mimeType }), m.name || 'image')
      form.append('media_category', 'tweet_image')
      const up = await json(await call('https://api.x.com/2/media/upload', { method: 'POST', headers: auth(tokens), body: form }))
      mediaIds.push(up.data?.id ?? up.media_id_string)
    }
    const text = fullCaption(input).slice(0, 280)
    const res = await json(
      await call('https://api.x.com/2/tweets', {
        method: 'POST',
        final: true,
        headers: { ...auth(tokens), 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, ...(mediaIds.length ? { media: { media_ids: mediaIds } } : {}) }),
      }),
    )
    return { externalId: res.data.id, url: `https://x.com/i/web/status/${res.data.id}` }
  },
  async metrics({ tokens }, id) {
    const res = await json(await call(`https://api.x.com/2/tweets/${encodeURIComponent(id)}?tweet.fields=public_metrics`, { headers: auth(tokens) }))
    const m = res.data?.public_metrics ?? {}
    return { impressions: m.impression_count, likes: m.like_count, comments: m.reply_count, shares: (m.retweet_count ?? 0) + (m.quote_count ?? 0), saves: m.bookmark_count }
  },
}
