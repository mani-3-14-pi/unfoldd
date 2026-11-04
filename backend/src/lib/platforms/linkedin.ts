import { env } from '../../config/env.ts'
import { bytesOf, call, fullCaption, isImage, json, PublishError, type PlatformProvider, type Tokens } from './types.ts'

/*
 * LinkedIn company pages through the versioned REST API (Posts + Images APIs).
 * Docs: learn.microsoft.com/linkedin/marketing/community-management/shares/posts-api.
 * Needs the Community Management API product on the LinkedIn app. Video posts aren't supported here yet
 * (they need multi-part uploads); those go manual.
 */

const SCOPES = ['openid', 'profile', 'w_member_social', 'r_organization_social', 'w_organization_social', 'rw_organization_admin']

const rest = (path: string) => `https://api.linkedin.com/rest/${path.replace(/^\//, '')}`
const headers = (token: string, extra: Record<string, string> = {}) => ({
  Authorization: `Bearer ${token}`,
  'LinkedIn-Version': env.LINKEDIN_API_VERSION,
  'X-Restli-Protocol-Version': '2.0.0',
  ...extra,
})

const tokensFrom = (t: any): Tokens => ({
  accessToken: t.access_token,
  refreshToken: t.refresh_token ?? null,
  expiresAt: t.expires_in ? new Date(Date.now() + t.expires_in * 1000) : null,
  scopes: typeof t.scope === 'string' ? t.scope.split(/[ ,]/) : SCOPES,
})

async function token(params: Record<string, string>) {
  const res = await call('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...params, client_id: env.LINKEDIN_CLIENT_ID!, client_secret: env.LINKEDIN_CLIENT_SECRET! }),
  })
  return tokensFrom(await json(res))
}

async function uploadImage(owner: string, accessToken: string, url: string, mimeType: string) {
  const init = await json(
    await call(rest('images?action=initializeUpload'), {
      method: 'POST',
      headers: headers(accessToken, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ initializeUploadRequest: { owner } }),
    }),
  )
  const body = await bytesOf({ url, mimeType, size: 0, name: '' })
  await call(init.value.uploadUrl, { method: 'PUT', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': mimeType }, body: new Uint8Array(body) })
  return init.value.image as string
}

export const linkedin: PlatformProvider = {
  key: 'linkedin',
  label: 'LinkedIn',
  formats: ['linkedin', 'feed_4x5', 'square_1x1', 'landscape_16x9', 'carousel', 'other'],
  configured: () => !!(env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET),
  authorizeUrl: ({ state, redirectUri }) =>
    `https://www.linkedin.com/oauth/v2/authorization?${new URLSearchParams({ response_type: 'code', client_id: env.LINKEDIN_CLIENT_ID!, redirect_uri: redirectUri, state, scope: SCOPES.join(' ') })}`,
  async connect({ code, redirectUri }) {
    const tokens = await token({ grant_type: 'authorization_code', code, redirect_uri: redirectUri })
    // Pages the person administers.
    const acls = await json(await call(rest('organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED'), { headers: headers(tokens.accessToken) }))
    const accounts = []
    for (const el of acls.elements ?? []) {
      const urn: string = el.organization
      const id = urn.split(':').pop()!
      const org = await json(await call(rest(`organizations/${id}`), { headers: headers(tokens.accessToken) })).catch(() => ({}))
      accounts.push({ platform: 'linkedin' as const, externalId: urn, name: (org as any).localizedName ?? `Organization ${id}`, handle: (org as any).vanityName, tokens })
    }
    return accounts
  },
  refresh: (t) => {
    if (!t.refreshToken) throw new PublishError('auth', 'LinkedIn access expired. Reconnect the page.')
    return token({ grant_type: 'refresh_token', refresh_token: t.refreshToken })
  },
  async check({ externalId, tokens }) {
    await call(rest(`organizations/${externalId.split(':').pop()}`), { headers: headers(tokens.accessToken) })
  },
  async publish({ externalId, tokens }, input) {
    const images = input.media.filter(isImage)
    if (input.media.length > images.length) throw new PublishError('failed', 'Video posts to LinkedIn aren’t supported yet. Publish this one by hand.')
    const ids: string[] = []
    for (const m of images.slice(0, 20)) ids.push(await uploadImage(externalId, tokens.accessToken, m.url, m.mimeType))
    const content = ids.length === 1 ? { media: { id: ids[0], title: input.title } } : ids.length > 1 ? { multiImage: { images: ids.map((id) => ({ id })) } } : undefined
    const res = await call(rest('posts'), {
      method: 'POST',
      final: true,
      headers: headers(tokens.accessToken, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        author: externalId,
        commentary: fullCaption(input),
        visibility: 'PUBLIC',
        distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
        ...(content ? { content } : {}),
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false,
      }),
    })
    const urn = res.headers.get('x-restli-id') ?? ''
    return { externalId: urn, url: urn ? `https://www.linkedin.com/feed/update/${urn}` : '' }
  },
  async metrics({ tokens }, urn) {
    const s = await json(await call(rest(`socialActions/${encodeURIComponent(urn)}`), { headers: headers(tokens.accessToken) }))
    return { likes: s.likesSummary?.totalLikes, comments: s.commentsSummary?.aggregatedTotalComments }
  },
}
