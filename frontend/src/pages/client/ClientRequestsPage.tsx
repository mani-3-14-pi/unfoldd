import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Inbox } from 'lucide-react'
import { Link } from 'react-router'
import { EmptyState } from '@/components/ui/Card'
import { ClientPageHeader, ClientRow } from '@/features/client-app/ClientPageHeader'
import { clientRequestsApi, type ClientRequestStatus } from '@/features/client-app/requests/api'
import { RequestStatusPill } from '@/features/client-app/requests/pills'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { formatDate } from '@/lib/format'

const TABS: { value: ClientRequestStatus; label: string }[] = [
  { value: 'open', label: 'Needed' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'completed', label: 'Done' },
]

/** F53: Needed From You, as a checklist: what the agency needs, what you've sent, what's done. */
export function ClientRequestsPage() {
  const [tab, setTab] = useState<ClientRequestStatus>('open')
  const query = useQuery({ queryKey: ['client', 'requests', 'list'], queryFn: clientRequestsApi.list })
  const items = query.data?.items ?? []
  const shown = items.filter((r) => r.status === tab)
  const count = (s: ClientRequestStatus) => items.filter((r) => r.status === s).length

  return (
    <>
      <ClientPageHeader title="Needed from you" description="Files and answers your agency needs to keep the work moving." />
      <div role="tablist" aria-label="Status" className="mb-4 grid grid-cols-3 gap-1 rounded-xl bg-surface-input p-1">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={tab === t.value}
            onClick={() => setTab(t.value)}
            className={cn('h-10 rounded-lg text-[13px]', tab === t.value ? 'bg-white font-semibold shadow-sm' : 'text-text-2')}
          >
            {t.label}
            {query.isSuccess && count(t.value) > 0 && <span className="ml-1.5 text-text-4">{count(t.value)}</span>}
          </button>
        ))}
      </div>

      {query.isPending ? (
        <div className="h-40 animate-pulse rounded-2xl bg-surface-input" />
      ) : query.isError ? (
        <EmptyState title="Couldn’t load requests">{errorMessage(query.error)}</EmptyState>
      ) : shown.length === 0 ? (
        <EmptyState title={tab === 'open' ? 'Nothing needed right now' : tab === 'submitted' ? 'Nothing waiting on your agency' : 'Nothing done yet'}>
          {tab === 'open' ? 'You’re all caught up.' : undefined}
        </EmptyState>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-white">
          {shown.map((r) => (
            <li key={r.id}>
              <Link to={`/c/requests/${r.id}`} className="block hover:bg-surface">
                <ClientRow
                  icon={<Inbox size={20} />}
                  title={r.title}
                  detail={[r.due && `Due ${formatDate(r.due)}`, r.files.length > 0 && `${r.files.length} file${r.files.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ') || undefined}
                  end={
                    <span className="flex shrink-0 items-center gap-1.5">
                      <RequestStatusPill request={r} />
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
