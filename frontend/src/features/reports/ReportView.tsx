import { Card, EmptyState } from '@/components/ui/Card'
import { PlatformBreakdown, TopPosts, TotalsGrid } from '@/features/analytics/AnalyticsView'
import type { Report } from './api'

/** A report as the client will see it: only the chosen sections, from the frozen snapshot. */
export function ReportView({ report: r }: { report: Report }) {
  const s = r.snapshot
  if (!s) return <EmptyState title="No data in this report">Refresh it to take a new snapshot.</EmptyState>
  const has = (section: Report['sections'][number]) => r.sections.includes(section)
  return (
    <div className="flex flex-col gap-6">
      {has('summary') && <TotalsGrid totals={s.totals} />}
      {has('delivery') && (
        <Card title="Delivery" description="What was produced and approved in the period.">
          <div className="grid grid-cols-3 divide-x divide-border">
            {[
              { label: 'Posts published', value: s.delivery.published },
              { label: 'Approvals', value: s.delivery.approvals },
              { label: 'Rounds of changes', value: s.delivery.revisionRounds },
            ].map((d) => (
              <div key={d.label} className="px-5 py-4">
                <div className="text-xs text-text-3">{d.label}</div>
                <div className="mt-1 text-2xl font-semibold">{d.value}</div>
              </div>
            ))}
          </div>
        </Card>
      )}
      {has('platforms') && <PlatformBreakdown platforms={s.platforms} />}
      {has('top_posts') && <TopPosts posts={s.topPosts} />}
      {has('notes') && r.notes && (
        <Card title="Notes">
          <p className="px-5 py-4 text-[13px] whitespace-pre-line text-text-2">{r.notes}</p>
        </Card>
      )}
    </div>
  )
}
