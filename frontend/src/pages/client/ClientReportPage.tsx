import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, LoaderCircle } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { EmptyState } from '@/components/ui/Card'
import { clientAnalyticsApi } from '@/features/client-app/analytics/api'
import { ReportView } from '@/features/reports/ReportView'
import { errorMessage } from '@/lib/errors'
import { formatDate } from '@/lib/format'

/** One shared report (D53): a frozen snapshot, so its numbers never change after it was shared. */
export function ClientReportPage() {
  const { id = '' } = useParams()
  const query = useQuery({ queryKey: ['client', 'analytics', 'reports', id], queryFn: () => clientAnalyticsApi.report(id) })

  return (
    <div className="flex flex-col gap-5">
      <Link to="/c/analytics" className="inline-flex items-center gap-1.5 self-start text-[13px] text-text-3 hover:text-text">
        <ArrowLeft size={15} /> Analytics
      </Link>
      {query.isPending ? (
        <div className="grid place-items-center py-16 text-text-3">
          <LoaderCircle className="animate-spin" />
        </div>
      ) : query.isError ? (
        <EmptyState title="Couldn’t open this report">{errorMessage(query.error)}</EmptyState>
      ) : (
        <>
          <header>
            <h1 className="font-serif text-[30px] leading-tight text-brand">{query.data.report.title}</h1>
            <p className="mt-1 text-[13px] text-text-3">
              {formatDate(query.data.report.period.from)} – {formatDate(query.data.report.period.to)}
              {query.data.report.sharedAt && ` · shared ${formatDate(query.data.report.sharedAt)}`}
            </p>
          </header>
          <ReportView report={query.data.report} />
        </>
      )}
    </div>
  )
}
