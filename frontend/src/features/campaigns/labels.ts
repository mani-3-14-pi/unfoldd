import type { Tone } from '@/components/ui/Pill'
import type { CampaignAction, CampaignStatus } from './api'

export const campaignStatusLabel: Record<CampaignStatus, string> = { planning: 'Planning', active: 'Active', completed: 'Completed', archived: 'Archived' }
export const campaignStatusTone: Record<CampaignStatus, Tone> = { planning: 'blue', active: 'green', completed: 'indigo', archived: 'gray' }

/** Which actions each status allows (backend CAMPAIGN_TRANSITIONS, §6.11). */
export const campaignActionsFor = (status: CampaignStatus): CampaignAction[] =>
  ({ planning: ['activate', 'archive'], active: ['complete', 'archive'], completed: ['activate', 'archive'], archived: ['restore'] })[status] as CampaignAction[]

export const campaignActionLabel: Record<CampaignAction, string> = { activate: 'Mark active', complete: 'Mark completed', archive: 'Archive', restore: 'Restore' }
