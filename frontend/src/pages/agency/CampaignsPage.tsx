import { PageHeader } from '@/components/PageHeader'
import { CampaignList } from '@/features/campaigns/CampaignList'

/** P32: every campaign across the clients this person can see. */
export function CampaignsPage() {
  return (
    <>
      <PageHeader title="Campaigns" description="Content grouped under one objective, with dates, a brief and progress." />
      <CampaignList />
    </>
  )
}
