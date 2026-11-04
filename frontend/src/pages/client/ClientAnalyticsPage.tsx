import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { BarChart3, ChevronRight, FileBarChart, LoaderCircle } from 'lucide-react'
import { Link } from 'react-router'
import { EmptyState } from '@/components/ui/Card'
import { PlatformBreakdown, TopPosts, TotalsGrid } from '@/features/analytics/AnalyticsView'
import { defaultPeriod } from '@/features/analytics/labels'
import { PeriodPicker } from '@/features/analytics/PeriodPicker'
import { clientAnalyticsApi } from '@/features/client-app/analytics/api'
import { useClientSpace } from '@/features/client-app/space'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { formatDate } from '@/lib/format'

/**
 * F75–F79: how the published posts did, and the reports the agency shared (D53). Only when the agency has
 * switched analytics on for this client (D47); otherwise a calm note instead.
 */
export function ClientAnalyticsPage() {
  const space = useClientSpace()
  const [period, setPeriod] = useState(defaultPeriod)
  const on = !!space.data?.client.showAnalytics
  const data = useQuery({
    queryKey: ['client', 'analytics', period.from, period.to],
    queryFn: () => clientAnalyticsApi.period(period.from, period.to),
    enabled: on,
    placeholderData: keepPreviousData,
  })
  const reports = useQuery({ queryKey: ['client', 'analytics', 'reports'], queryFn: clientAnalyticsApi.reports })

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="font-serif text-[32px] leading-tight text-brand">Analytics</h1>
      </header>

      {space.isPending ? (
        <div className="grid place-items-center py-16 text-text-3">
          <LoaderCircle className="animate-spin" />
        </div>
      ) : !on ? (
        <section className="flex flex-col items-center gap-2 rounded-2xl bg-surface-input px-6 py-10 text-center">
          <BarChart3 size={26} className="text-text-3" />
          <h2 className="text-[15px] font-semibold">Not switched on yet</h2>
          <p className="max-w-sm text-[13px] text-text-3">{space.data?.agency.name ?? 'Your agency'} will turn on post analytics here when it’s ready. Shared reports still show below.</p>
        </section>
      ) : (
        <>
          <PeriodPicker from={period.from} to={period.to} onChange={setPeriod} />
          {data.isPending ? (
            <div className="grid place-items-center py-16 text-text-3">
              <LoaderCircle className="animate-spin" />
            </div>
          ) : data.isError ? (
            <EmptyState title="Couldn’t load analytics">{errorMessage(data.error)}</EmptyState>
          ) : (
            <div className={cn('flex flex-col gap-5 transition-opacity', data.isPlaceholderData && 'opacity-60')}>
              <TotalsGrid totals={data.data.totals} />
              {data.data.totals.posts === 0 ? (
                <EmptyState title="Nothing published in this period">Pick a longer period.</EmptyState>
              ) : (
                <>
                  <PlatformBreakdown platforms={data.data.platforms} />
                  <TopPosts posts={data.data.topPosts} linkContent={false} />
                </>
              )}
            </div>
          )}
        </>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Reports</h2>
        {reports.isPending ? null : reports.isError ? (
          <p className="text-[13px] text-negative">{errorMessage(reports.error)}</p>
        ) : reports.data.items.length === 0 ? (
          <p className="rounded-2xl bg-surface-input px-4 py-5 text-center text-[13px] text-text-3">Reports your agency shares with you show up here.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-2xl border border-border bg-white">
            {reports.data.items.map((r) => (
              <li key={r._id}>
                <Link to={`/c/reports/${r._id}`} className="flex items-center gap-3 px-4 py-4 hover:bg-surface">
                  <FileBarChart size={19} className="shrink-0 text-brand" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold">{r.title}</span>
                    <span className="block text-xs text-text-3">
                      {formatDate(r.period.from)} – {formatDate(r.period.to)}
                      {r.sharedAt && ` · shared ${formatDate(r.sharedAt)}`}
                    </span>
                  </span>
                  <ChevronRight size={17} className="shrink-0 text-text-4" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
