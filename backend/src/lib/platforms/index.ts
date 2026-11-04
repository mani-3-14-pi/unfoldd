import { linkedin } from './linkedin.ts'
import { metaProviders } from './meta.ts'
import type { OAuthApp, PlatformKey, PlatformProvider } from './types.ts'
import { x } from './x.ts'
import { youtube } from './youtube.ts'

export * from './types.ts'

/** Every built-in publishing integration, by platform. */
export const PROVIDERS: Record<PlatformKey, PlatformProvider> = { ...metaProviders, linkedin, youtube, x }

/** One OAuth sign-in per app; Meta's covers both Instagram and Facebook. */
export const OAUTH_PROVIDER: Record<OAuthApp, PlatformProvider> = { meta: metaProviders.instagram, linkedin, youtube, x }
export const appOf = (platform: PlatformKey): OAuthApp => (platform === 'instagram' || platform === 'facebook' ? 'meta' : platform)

/** X needs PKCE; the others use a client secret only. */
export const usesPkce = (app: OAuthApp) => app === 'x'

/**
 * Platforms that could be added next, with what their APIs allow. They publish manually until built.
 * Kept as data so the portal can show "coming soon" honestly.
 */
export const PLATFORM_CATALOG = [
  { key: 'instagram', label: 'Instagram', status: 'built', notes: 'Feed, carousel, reels, stories, insights. Needs Meta app review.' },
  { key: 'facebook', label: 'Facebook Pages', status: 'built', notes: 'Text, photos, multi-photo, video, insights. Needs Meta app review.' },
  { key: 'linkedin', label: 'LinkedIn Pages', status: 'built', notes: 'Text and image posts, likes/comments. Video comes later. Needs Community Management API.' },
  { key: 'youtube', label: 'YouTube', status: 'built', notes: 'Video uploads and statistics. Public uploads need Google’s API audit.' },
  { key: 'x', label: 'X', status: 'built', notes: 'Text and image posts, public metrics. Needs a paid X API tier. Video comes later.' },
  { key: 'tiktok', label: 'TikTok', status: 'possible', notes: 'Content Posting API (direct post or drafts). Needs TikTok app audit.' },
  { key: 'threads', label: 'Threads', status: 'possible', notes: 'Threads API from Meta: text, image, video, carousel, insights.' },
  { key: 'pinterest', label: 'Pinterest', status: 'possible', notes: 'API v5: create pins on boards, pin analytics.' },
  { key: 'google_business', label: 'Google Business Profile', status: 'possible', notes: 'Local posts with photos and CTAs, basic insights.' },
  { key: 'bluesky', label: 'Bluesky', status: 'possible', notes: 'AT Protocol: text and images, open API, no review.' },
  { key: 'snapchat', label: 'Snapchat', status: 'limited', notes: 'Public Profile API, partner access only.' },
  { key: 'reddit', label: 'Reddit', status: 'limited', notes: 'API posting allowed but subreddit rules vary; usually manual.' },
] as const
