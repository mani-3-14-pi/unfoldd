import { useQuery } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router'
import { EmptyState } from '@/components/ui/Card'
import { Pill } from '@/components/ui/Pill'
import { campaignStatusLabel, clientCampaignsApi } from '@/features/client-app/campaigns/api'
import { ProgressBar } from '@/features/client-app/campaigns/ProgressBar'
import { ClientPageHeader } from '@/features/client-app/ClientPageHeader'
import { errorMessage } from '@/lib/errors'
import { formatDate } from '@/lib/format'

/** F63: the brand's campaigns, with how far each has got. */
export function ClientCampaignsPage() {
  const query = useQuery({ queryKey: ['client', 'campaigns', 'list'], queryFn: clientCampaignsApi.list })

  return (
    <>
      <ClientPageHeader title="Campaigns" back={{ to: '/c/more', label: 'More' }} />
      {query.isPending ? (
        <div className="h-40 animate-pulse rounded-2xl bg-surface-input" />
      ) : query.isError ? (
        <EmptyState title="Couldn’t load campaigns">{errorMessage(query.error)}</EmptyState>
      ) : query.data.items.length === 0 ? (
        <EmptyState title="No campaigns yet">Campaigns your agency runs for you show up here.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {query.data.items.map((c) => (
            <li key={c._id}>
              <Link to={`/c/campaigns/${c._id}`} className="flex items-center gap-3 rounded-2xl border border-border bg-white p-4 hover:bg-surface">
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[15px] font-medium">{c.name}</span>
                    <Pill tone={c.status === 'active' ? 'green' : c.status === 'completed' ? 'indigo' : 'gray'}>{campaignStatusLabel[c.status]}</Pill>
                  </span>
                  {(c.startDate || c.endDate) && (
                    <span className="mt-0.5 block text-xs text-text-3">
                      {formatDate(c.startDate)} – {formatDate(c.endDate)}
                    </span>
                  )}
                  <span className="mt-2.5 block">
                    <ProgressBar progress={c.progress} />
                  </span>
                </span>
                <ChevronRight size={18} className="shrink-0 text-text-4" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
