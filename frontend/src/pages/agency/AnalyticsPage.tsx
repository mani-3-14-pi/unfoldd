import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { FileBarChart } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import { PageHeader } from '@/components/PageHeader'
import { buttonClass } from '@/components/ui/buttonClass'
import { EmptyState } from '@/components/ui/Card'
import { Select } from '@/components/ui/Field'
import { analyticsApi } from '@/features/analytics/api'
import { PlatformBreakdown, TopPosts, TotalsGrid } from '@/features/analytics/AnalyticsView'
import { defaultPeriod } from '@/features/analytics/labels'
import { PeriodPicker } from '@/features/analytics/PeriodPicker'
import { clientsApi } from '@/features/clients/api'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'

/**
 * P120–P125: one client's published posts and their numbers for a period. Only posts published through a
 * connected account have numbers; manual publishes show "n/a" (D58).
 */
export function AnalyticsPage() {
  const [params, setParams] = useSearchParams()
  const [fallback] = useState(defaultPeriod)
  const clients = useQuery({ queryKey: ['agency', 'clients', 'list', 'picker'], queryFn: () => clientsApi.list('pageSize=100&sort=name') })
  const client = params.get('client') || clients.data?.items[0]?._id || ''
  const from = params.get('from') || fallback.from
  const to = params.get('to') || fallback.to
  const set = (patch: Record<string, string>) => setParams((p) => ({ ...Object.fromEntries(p), ...patch }), { replace: true })

  const data = useQuery({
    queryKey: ['agency', 'analytics', client, from, to],
    queryFn: () => analyticsApi.period(client, from, to),
    enabled: !!client,
    placeholderData: keepPreviousData,
  })

  return (
    <>
      <PageHeader
        title="Analytics"
        description="How a client’s published posts did. Numbers update about twice a day."
        actions={
          <Link to={`/app/reports${client ? `?client=${client}` : ''}`} className={buttonClass('secondary')}>
            <FileBarChart size={15} /> Reports
          </Link>
        }
      />
      <div className="mb-6 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <Select aria-label="Client" value={client} onChange={(e) => set({ client: e.target.value })} className="w-full sm:w-64" disabled={clients.isPending}>
          {clients.data?.items.length === 0 && <option value="">No clients yet</option>}
          {clients.data?.items.map((c) => (
            <option key={c._id} value={c._id}>
              {c.brandName}
            </option>
          ))}
        </Select>
        <PeriodPicker from={from} to={to} onChange={(p) => set(p)} />
      </div>

      {!client ? (
        clients.isPending ? null : <EmptyState title="No clients yet">Analytics appear once a client’s posts are published.</EmptyState>
      ) : data.isPending ? (
        <div className="h-64" />
      ) : data.isError ? (
        <EmptyState title="Couldn’t load analytics">{errorMessage(data.error)}</EmptyState>
      ) : (
        <div className={cn('flex flex-col gap-6 transition-opacity', data.isPlaceholderData && 'opacity-60')}>
          <TotalsGrid totals={data.data.totals} />
          {data.data.totals.posts === 0 ? (
            <EmptyState title="Nothing published in this period">Pick a longer period, or publish some content first.</EmptyState>
          ) : (
            <>
              <PlatformBreakdown platforms={data.data.platforms} />
              <TopPosts posts={data.data.topPosts} />
            </>
          )}
          <p className="text-xs text-text-4">Dates are in the client’s timezone ({data.data.period.timezone.replace(/_/g, ' ')}).</p>
        </div>
      )}
    </>
  )
}
