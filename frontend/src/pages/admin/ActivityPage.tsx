import { PageHeader } from '@/components/PageHeader'
import { ActivityList } from '@/features/admin/ActivityList'

export function ActivityPage() {
  return (
    <>
      <PageHeader
        title="Activity log"
        description="Everything platform admins, agency people and the system have done. Entries can’t be edited or deleted."
      />
      <ActivityList />
    </>
  )
}
