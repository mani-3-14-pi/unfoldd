import { PageHeader } from '@/components/PageHeader'
import { AgenciesList } from '@/features/admin/AgenciesList'

export function AgenciesPage() {
  return (
    <>
      <PageHeader title="Agencies" description="Every agency on Unfoldd. Open one to see its details, team, subscription and activity." />
      <AgenciesList />
    </>
  )
}
