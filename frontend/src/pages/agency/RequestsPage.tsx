import { PageHeader } from '@/components/PageHeader'
import { RequestList } from '@/features/requests/RequestList'

/** P90: everything the agency is waiting on from clients. */
export function RequestsPage() {
  return (
    <>
      <PageHeader title="Requests" description="What you need from clients: files, answers and approvals, with due dates." />
      <RequestList />
    </>
  )
}
