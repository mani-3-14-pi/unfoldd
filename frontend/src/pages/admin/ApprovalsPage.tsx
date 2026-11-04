import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { PageHeader } from '@/components/PageHeader'
import { adminApi } from '@/features/admin/api'
import { AgenciesList } from '@/features/admin/AgenciesList'

export function ApprovalsPage() {
  const settings = useQuery({ queryKey: ['admin', 'settings'], queryFn: adminApi.settings })
  const auto = settings.data?.settings.signups.autoApprove

  return (
    <>
      <PageHeader
        title="Approvals"
        description="Agencies that signed up and are waiting for you. They can’t log in until they’re approved."
      />
      {auto && (
        <p className="mb-4 rounded-lg border border-blue-soft bg-[#f4f7fc] px-4 py-3 text-[13px] text-blue-ink">
          Auto-approve is on, so new signups skip this queue. Agencies already here still need a decision.{' '}
          <Link to="/admin/settings" className="font-medium underline">
            Change in settings
          </Link>
        </p>
      )}
      <AgenciesList lockedStatus="pending" />
    </>
  )
}
