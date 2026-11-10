// Small display helpers shared by the screens.

export const fmtDate = (iso: string | null | undefined, empty = 'No date') =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : empty

export const fmtDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—'

const PLATFORMS: Record<string, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  x: 'X',
  pinterest: 'Pinterest',
  website: 'Website',
  other: 'Other',
}

const FORMATS: Record<string, string> = {
  feed_4x5: 'Feed post',
  square_1x1: 'Square post',
  story_9x16: 'Story',
  landscape_16x9: 'Landscape',
  carousel: 'Carousel',
  video: 'Video',
  reel: 'Reel',
  linkedin: 'LinkedIn post',
  other: 'Other',
}

export const platformLabel = (p: string) => PLATFORMS[p] ?? p
export const formatLabel = (f: string) => FORMATS[f] ?? f.replace(/_/g, ' ')

/** "Playful" → title case for tags like `minimal`. */
export const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ')
