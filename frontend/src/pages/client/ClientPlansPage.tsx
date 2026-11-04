import { useQuery } from '@tanstack/react-query'
import { CalendarRange, ChevronRight } from 'lucide-react'
import { Link } from 'react-router'
import { EmptyState } from '@/components/ui/Card'
import { ClientPageHeader, ClientRow } from '@/features/client-app/ClientPageHeader'
import { clientPlansApi, monthLabel } from '@/features/client-app/plans/api'
import { PlanStatusPill } from '@/features/client-app/plans/pills'
import { errorMessage } from '@/lib/errors'
import { formatDate } from '@/lib/format'

/** F46: the monthly content plans the agency has sent, newest month first. */
export function ClientPlansPage() {
  const query = useQuery({ queryKey: ['client', 'plans', 'list'], queryFn: clientPlansApi.list })

  return (
    <>
      <ClientPageHeader title="Content plans" description="What your agency plans to make each month. Look it over, comment, then approve." back={{ to: '/c/more', label: 'More' }} />
      {query.isPending ? (
        <div className="h-40 animate-pulse rounded-2xl bg-surface-input" />
      ) : query.isError ? (
        <EmptyState title="Couldn’t load plans">{errorMessage(query.error)}</EmptyState>
      ) : query.data.items.length === 0 ? (
        <EmptyState title="No plans yet">When your agency sends a monthly plan, it shows up here.</EmptyState>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-white">
          {query.data.items.map((p) => (
            <li key={p.id}>
              <Link to={`/c/plans/${p.id}`} className="block hover:bg-surface">
                <ClientRow
                  icon={<CalendarRange size={20} />}
                  title={`${monthLabel(p.month)} plan`}
                  detail={p.sentAt ? `Sent ${formatDate(p.sentAt)}` : undefined}
                  end={
                    <span className="flex shrink-0 items-center gap-1.5">
                      <PlanStatusPill status={p.status} label={p.label} />
                      <ChevronRight size={18} className="text-text-4" />
                    </span>
                  }
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
