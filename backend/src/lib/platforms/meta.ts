import { env } from '../../config/env.ts'
import { call, fullCaption, isVideo, json, PublishError, type ConnectableAccount, type Metrics, type PlatformProvider, type PostInput } from './types.ts'

/*
 * Meta Graph API: Facebook Pages and Instagram professional accounts, through one Facebook Login.
 * Pages give a page access token; an IG account linked to a page publishes with that page's token.
 * Docs: developers.facebook.com/docs/instagram-platform/content-publishing and /docs/pages-api.
 * Needs app review for the publish permissions before it works for other people's accounts.
 */

const graph = (path: string) => `https://graph.facebook.com/${env.META_GRAPH_VERSION}/${path.replace(/^\//, '')}`

const SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'read_insights',
  'business_management',
  'instagram_basic',
  'instagram_content_publish',
  'instagram_manage_insights',
]

const configured = () => !!(env.META_APP_ID && env.META_APP_SECRET)

function authorizeUrl({ state, redirectUri }: { state: string; redirectUri: string }) {
  const q = new URLSearchParams({ client_id: env.META_APP_ID!, redirect_uri: redirectUri, state, scope: SCOPES.join(','), response_type: 'code' })
  return `https://www.facebook.com/${env.META_GRAPH_VERSION}/dialog/oauth?${q}`
}

/** Code → long-lived user token → every page (and its linked IG account) the person manages. */
async function connect({ code, redirectUri }: { code: string; redirectUri: string }): Promise<ConnectableAccount[]> {
  const short = await json(await call(graph(`oauth/access_token?${new URLSearchParams({ client_id: env.META_APP_ID!, client_secret: env.META_APP_SECRET!, redirect_uri: redirectUri, code })}`)))
  const long = await json(
    await call(graph(`oauth/access_token?${new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: env.META_APP_ID!, client_secret: env.META_APP_SECRET!, fb_exchange_token: short.access_token })}`)),
  )
  const pages = await json(await call(graph(`me/accounts?${new URLSearchParams({ fields: 'id,name,access_token,instagram_business_account{id,username,name}', access_token: long.access_token, limit: '100' })}`)))
  const accounts: ConnectableAccount[] = []
  for (const p of pages.data ?? []) {
    // Page tokens obtained from a long-lived user token don't expire.
    const tokens = { accessToken: p.access_token, expiresAt: null, scopes: SCOPES }
    accounts.push({ platform: 'facebook', externalId: p.id, name: p.name, tokens })
    const ig = p.instagram_business_account
    if (ig) accounts.push({ platform: 'instagram', externalId: ig.id, name: ig.name ?? ig.username, handle: ig.username, tokens, meta: { pageId: p.id } })
  }
  return accounts
}

async function check({ externalId, tokens }: { externalId: string; tokens: { accessToken: string } }) {
  await call(graph(`${externalId}?${new URLSearchParams({ fields: 'id', access_token: tokens.accessToken })}`))
}

const post = (path: string, params: Record<string, string>, final = false) =>
  call(graph(path), { method: 'POST', body: new URLSearchParams(params), final }).then((r) => json(r))

/** IG video containers process asynchronously; wait until FINISHED (or give up as retryable, nothing posted yet). */
async function waitForContainer(id: string, token: string) {
  for (let i = 0; i < 60; i++) {
    const s = await json(await call(graph(`${id}?${new URLSearchParams({ fields: 'status_code', access_token: token })}`)))
    if (s.status_code === 'FINISHED') return
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new PublishError('failed', `Instagram couldn't process the media (${s.status_code}).`)
    await new Promise((r) => setTimeout(r, 5000))
  }
  throw new PublishError('retryable', 'Instagram is still processing the media.')
}

const instagram: PlatformProvider = {
  key: 'instagram',
  label: 'Instagram',
  formats: ['feed_4x5', 'square_1x1', 'story_9x16', 'carousel', 'reel', 'video'],
  configured,
  authorizeUrl,
  connect,
  check,
  async publish({ externalId, tokens }, input: PostInput) {
    const token = tokens.accessToken
    const caption = fullCaption(input)
    if (!input.media.length) throw new PublishError('failed', 'Instagram posts need an image or a video.')
    let creationId: string
    if (input.media.length > 1) {
      // Carousel: one container per item, then the carousel container.
      const children: string[] = []
      for (const m of input.media.slice(0, 10)) {
        const child = await post(`${externalId}/media`, isVideo(m) ? { media_type: 'VIDEO', video_url: m.url, is_carousel_item: 'true', access_token: token } : { image_url: m.url, is_carousel_item: 'true', access_token: token })
        if (isVideo(m)) await waitForContainer(child.id, token)
        children.push(child.id)
      }
      creationId = (await post(`${externalId}/media`, { media_type: 'CAROUSEL', children: children.join(','), caption, access_token: token })).id
    } else {
      const m = input.media[0]
      const story = input.format === 'story_9x16'
      const params: Record<string, string> = isVideo(m)
        ? { media_type: story ? 'STORIES' : 'REELS', video_url: m.url, caption, access_token: token }
        : story
          ? { media_type: 'STORIES', image_url: m.url, access_token: token }
          : { image_url: m.url, caption, access_token: token }
      creationId = (await post(`${externalId}/media`, params)).id
      if (isVideo(m)) await waitForContainer(creationId, token)
    }
    const published = await post(`${externalId}/media_publish`, { creation_id: creationId, access_token: token }, true)
    const info = await json(await call(graph(`${published.id}?${new URLSearchParams({ fields: 'permalink', access_token: token })}`))).catch(() => ({}))
    return { externalId: published.id, url: (info as any).permalink ?? '' }
  },
  async metrics({ tokens }, mediaId): Promise<Metrics> {
    const res = await json(await call(graph(`${mediaId}/insights?${new URLSearchParams({ metric: 'reach,views,likes,comments,shares,saved', access_token: tokens.accessToken })}`)))
    const v = (name: string) => res.data?.find((d: any) => d.name === name)?.values?.[0]?.value
    return { reach: v('reach'), views: v('views'), impressions: v('views'), likes: v('likes'), comments: v('comments'), shares: v('shares'), saves: v('saved') }
  },
}

const facebook: PlatformProvider = {
  key: 'facebook',
  label: 'Facebook',
  formats: ['feed_4x5', 'square_1x1', 'landscape_16x9', 'carousel', 'video', 'reel', 'other'],
  configured,
  authorizeUrl,
  connect,
  check,
  async publish({ externalId, tokens }, input) {
    const token = tokens.accessToken
    const message = fullCaption(input)
    let id: string
    if (!input.media.length) {
      id = (await post(`${externalId}/feed`, { message, access_token: token }, true)).id
    } else if (input.media.length === 1 && isVideo(input.media[0])) {
      id = (await post(`${externalId}/videos`, { file_url: input.media[0].url, description: message, access_token: token }, true)).id
    } else if (input.media.length === 1) {
      id = (await post(`${externalId}/photos`, { url: input.media[0].url, caption: message, access_token: token }, true)).post_id
    } else {
      // Several photos: upload unpublished, then one feed post with all of them.
      const ids: string[] = []
      for (const m of input.media.filter((x) => !isVideo(x)).slice(0, 10)) ids.push((await post(`${externalId}/photos`, { url: m.url, published: 'false', access_token: token })).id)
      const params: Record<string, string> = { message, access_token: token }
      ids.forEach((mid, i) => (params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: mid })))
      id = (await post(`${externalId}/feed`, params, true)).id
    }
    const info = await json(await call(graph(`${id}?${new URLSearchParams({ fields: 'permalink_url', access_token: token })}`))).catch(() => ({}))
    return { externalId: id, url: (info as any).permalink_url ?? '' }
  },
  async metrics({ tokens }, postId) {
    const res = await json(await call(graph(`${postId}?${new URLSearchParams({ fields: 'shares,reactions.summary(total_count),comments.summary(total_count)', access_token: tokens.accessToken })}`)))
    const insights = await json(await call(graph(`${postId}/insights?${new URLSearchParams({ metric: 'post_impressions,post_impressions_unique,post_clicks', access_token: tokens.accessToken })}`))).catch(() => ({ data: [] }))
    const v = (name: string) => (insights as any).data?.find((d: any) => d.name === name)?.values?.[0]?.value
    return { impressions: v('post_impressions'), reach: v('post_impressions_unique'), linkClicks: v('post_clicks'), likes: res.reactions?.summary?.total_count, comments: res.comments?.summary?.total_count, shares: res.shares?.count }
  },
}

export const metaProviders = { instagram, facebook }
