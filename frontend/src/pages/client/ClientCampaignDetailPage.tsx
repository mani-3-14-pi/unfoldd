import { useQuery } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { EmptyState } from '@/components/ui/Card'
import { Details } from '@/components/ui/Details'
import { Pill } from '@/components/ui/Pill'
import { campaignStatusLabel, clientCampaignsApi } from '@/features/client-app/campaigns/api'
import { ProgressBar } from '@/features/client-app/campaigns/ProgressBar'
import { ClientPageHeader } from '@/features/client-app/ClientPageHeader'
import { formatLabel, platformLabel } from '@/features/content/labels'
import { errorMessage } from '@/lib/errors'
import { formatDate } from '@/lib/format'

/** F63: one campaign: what it's for, when it runs, and the content you can already see in it. */
export function ClientCampaignDetailPage() {
  const { id = '' } = useParams()
  const query = useQuery({ queryKey: ['client', 'campaigns', id], queryFn: () => clientCampaignsApi.get(id) })
  const back = { to: '/c/campaigns', label: 'Campaigns' }

  if (query.isPending) return <ClientPageHeader title="Campaign" back={back} />
  if (query.isError) {
    return (
      <>
        <ClientPageHeader title="Campaign" back={back} />
        <EmptyState title="Couldn’t open this campaign">{errorMessage(query.error)}</EmptyState>
      </>
    )
  }
  const c = query.data.campaign

  return (
    <>
      <ClientPageHeader
        back={back}
        title={c.name}
        description={c.startDate || c.endDate ? `${formatDate(c.startDate)} – ${formatDate(c.endDate)}` : undefined}
        action={<Pill tone={c.status === 'active' ? 'green' : c.status === 'completed' ? 'indigo' : 'gray'}>{campaignStatusLabel[c.status]}</Pill>}
      />
      <div className="flex flex-col gap-6">
        <section className="rounded-2xl border border-border bg-white">
          <Details
            className="sm:grid-cols-1"
            rows={[
              { label: 'Objective', value: c.objective },
              { label: 'Key message', value: c.keyMessage },
              { label: 'Platforms', value: c.platforms?.map((p) => platformLabel[p]).join(', ') },
            ]}
          />
          {c.progress && (
            <div className="border-t border-border px-5 py-4">
              <ProgressBar progress={c.progress} />
            </div>
          )}
        </section>

        <section className="flex flex-col gap-2.5">
          <h2 className="text-sm font-semibold">Content</h2>
          {c.content.length === 0 ? (
            <p className="rounded-2xl border border-border bg-white px-4 py-6 text-center text-[13px] text-text-3">Nothing to see yet. Content appears here once it’s sent to you.</p>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-white">
              {c.content.map((i) => (
                <li key={i._id}>
                  <Link to={`/c/content/${i._id}`} className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-surface">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium">{i.title}</span>
                      <span className="block truncate text-xs text-text-3">
                        {platformLabel[i.platform]} · {formatLabel[i.format]}
                        {i.publishDate && ` · ${formatDate(i.publishDate)}`}
                      </span>
                    </span>
                    <ChevronRight size={18} className="shrink-0 text-text-4" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  )
}
