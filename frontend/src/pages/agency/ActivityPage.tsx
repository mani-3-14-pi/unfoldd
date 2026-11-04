import { PageHeader } from '@/components/PageHeader'
import { ActivityFeed } from '@/features/workspace/ActivityFeed'

/** P151–P153: the agency's activity log, limited to the clients the signed-in person can see. */
export function ActivityPage() {
  return (
    <>
      <PageHeader title="Activity" description="Who did what, and when. You see activity for the clients you have access to." />
      <ActivityFeed />
    </>
  )
}
