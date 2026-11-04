import { api } from '@/lib/api'
import type { Format, Platform } from '@/features/content/api'

// Campaigns in the client space (F63): /api/client/campaigns. No internal brief here.

export type ClientCampaignStatus = 'planning' | 'active' | 'completed' | 'archived'

export interface CampaignProgress {
  total: number
  approved: number
  published: number
  percent: number
}

export interface ClientCampaign {
  _id: string
  name: string
  objective?: string
  keyMessage?: string
  startDate?: string
  endDate?: string
  platforms?: Platform[]
  status: ClientCampaignStatus
  progress: CampaignProgress
}

export interface ClientCampaignDetail extends ClientCampaign {
  /** Only content the client can already see (D64). */
  content: { _id: string; title: string; platform: Platform; format: Format; publishDate: string | null }[]
}

export const clientCampaignsApi = {
  list: () => api<{ items: ClientCampaign[] }>('/client/campaigns'),
  get: (id: string) => api<{ campaign: ClientCampaignDetail }>(`/client/campaigns/${id}`),
}

export const campaignStatusLabel: Record<ClientCampaignStatus, string> = { planning: 'Planning', active: 'Active', completed: 'Completed', archived: 'Archived' }
