import { PageHeader } from '@/components/PageHeader'
import { PlanList } from '@/features/plans/PlanList'

/** P37–P38: monthly content plans across the clients this person can see. */
export function PlansPage() {
  return (
    <>
      <PageHeader title="Content plans" description="A month of content per client, agreed with them before production." />
      <PlanList />
    </>
  )
}
