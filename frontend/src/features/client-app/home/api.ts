import { api } from '@/lib/api'

// Client Home (F11–F15, D50): /api/client/home, and banner detail (F13): /api/client/banners/:id.

export interface HomeBanner {
  _id: string
  headline: string
  text?: string
  cta?: { label: string; link: string }
  endAt?: string | null
}

export interface AttentionItem {
  kind: 'review' | 'plan' | 'request'
  id: string
  title: string
  /** "Review Required" or "Needed". */
  label: string
  /** When the client is needed by (approval needed-by or request due), for sorting and display. */
  due: string | null
  /** Since when it has been waiting, when there's no due date. */
  since: string | null
  link: string
}

export interface UpcomingContent {
  _id: string
  title: string
  platform: string
  format: string
  publishDate: string
  state: string
  status: { bucket: string | null; label: string; delayed: boolean }
}

export interface NextMeeting {
  _id: string
  title: string
  startAt: string
  endAt: string
  platform?: string
  joinUrl?: string
}

export interface ClientHome {
  greeting: { name: string; partOfDay: 'morning' | 'afternoon' | 'evening' }
  banners: HomeBanner[]
  needsAttention: { total: number; items: AttentionItem[]; allCaughtUp: boolean }
  nextMeeting: NextMeeting | null
  upcomingContent: UpcomingContent[]
}

export interface BannerDetail extends HomeBanner {
  startAt?: string | null
  imageUrl: string | null
}

export const clientHomeApi = {
  home: () => api<ClientHome>('/client/home'),
  banner: (id: string) => api<{ banner: BannerDetail }>(`/client/banners/${id}`),
}

export const clientHomeKey = ['client', 'home'] as const
