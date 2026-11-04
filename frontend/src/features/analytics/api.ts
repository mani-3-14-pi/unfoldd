import { api } from '@/lib/api'

// Analytics (P120–P125, D58): /api/analytics. Numbers are the latest reading per published post.

/** D58: the agreed metric set. `null` means the platform doesn't provide it ("n/a"). */
export interface Metrics {
  impressions: number | null
  reach: number | null
  views: number | null
  likes: number | null
  comments: number | null
  shares: number | null
  saves: number | null
  linkClicks: number | null
  engagements: number | null
  /** Percent: engagements ÷ reach × 100. */
  engagementRate: number | null
}

export type Totals = Metrics & { posts: number }

export interface AnalyticsPost {
  _id: string
  title: string
  platform: string
  format: string
  publishedAt: string
  externalUrl: string
  metrics: Metrics | null
}

export interface Analytics {
  period: { from: string; to: string; timezone: string }
  totals: Totals
  platforms: (Totals & { platform: string; label: string })[]
  topPosts: AnalyticsPost[]
  posts: AnalyticsPost[]
}

export const analyticsApi = {
  period: (client: string, from: string, to: string) => api<Analytics>(`/analytics?${new URLSearchParams({ client, from, to })}`),
}
