import { api } from '@/lib/api'
import type { ContentState, Format, Platform } from '@/features/content/api'
import type { Page, UpdatedBy } from '@/types/api'

// Campaigns (P32–P36): /api/campaigns. Progress is derived from the campaign's content on the server.

export const CAMPAIGN_STATUSES = ['planning', 'active', 'completed', 'archived'] as const
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number]
export type CampaignAction = 'activate' | 'complete' | 'archive' | 'restore'

export interface CampaignBrief {
  background: string
  strategy: string
  deliverables: string
  references: string
  successCriteria: string
}

export interface CampaignProgress {
  total: number
  approved: number
  published: number
  /** Published ÷ total. */
  percent: number
}

export interface Campaign {
  _id: string
  client: string
  name: string
  objective: string
  audience: string
  keyMessage: string
  /** Date-only, in the client's timezone. */
  startDate: string
  endDate: string
  platforms: Platform[]
  owner: string | null
  team: string[]
  /** Agency-internal; the client sees name, objective, key message, dates and progress. */
  brief: CampaignBrief
  status: CampaignStatus
  rev: number
  updatedBy?: UpdatedBy
  createdAt: string
  updatedAt: string
  progress: CampaignProgress
}

export interface CampaignContent {
  _id: string
  title: string
  state: ContentState
  platform: Platform
  format: Format
  publishDate: string | null
  owner: string | null
}

export type CampaignDetail = Campaign & { content: CampaignContent[] }

export interface CampaignInput {
  name: string
  objective?: string
  audience?: string
  keyMessage?: string
  startDate?: string
  endDate?: string
  platforms?: Platform[]
  owner?: string | null
  brief?: Partial<CampaignBrief>
}

export const campaignsApi = {
  list: (query: string) => api<Page<Campaign>>(`/campaigns?${query}`),
  get: (id: string) => api<{ campaign: CampaignDetail }>(`/campaigns/${id}`),
  create: (body: CampaignInput & { client: string; template?: string }, idempotencyKey: string) =>
    api<{ campaign: Campaign }>('/campaigns', { body, idempotencyKey }),
  update: (id: string, body: Partial<CampaignInput> & { rev: number }) => api<{ campaign: Campaign }>(`/campaigns/${id}`, { method: 'PATCH', body }),
  action: (id: string, action: CampaignAction) => api<{ campaign: Campaign }>(`/campaigns/${id}/${action}`, { method: 'POST' }),
}

export const campaignKey = (id: string) => ['agency', 'campaigns', 'detail', id]
