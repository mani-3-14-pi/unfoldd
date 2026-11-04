import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Building2, CirclePause, Clock, TrendingUp } from 'lucide-react'
import { Link } from 'react-router'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/Button'
import { buttonClass } from '@/components/ui/buttonClass'
import { Card, EmptyState, StatCard } from '@/components/ui/Card'
import { adminApi, PLANS } from '@/features/admin/api'
import { useAgencyActions } from '@/features/admin/useAgencyActions'
import { actionLabel, planLabel } from '@/features/admin/labels'
import { errorMessage } from '@/lib/errors'
import { timeAgo } from '@/lib/format'

export function OverviewPage() {
  const query = useQuery({ queryKey: ['admin', 'overview'], queryFn: adminApi.overview })
  const actions = useAgencyActions()

  if (query.isPending) return <PageHeader title="Overview" />
  if (query.isError) return <EmptyState title="Couldn’t load the overview">{errorMessage(query.error)}</EmptyState>

  const o = query.data
  const change = o.signups.last7 - o.signups.prev7
  const activeTotal = Object.values(o.activePlans).reduce((a, b) => a + b, 0)

  return (
    <>
      <PageHeader title="Overview" description="What’s happening across every agency on Unfoldd." />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total agencies" value={o.agencies.total} icon={Building2} tone="green" note={`${o.agencies.byStatus.active} active`} />
        <StatCard label="Waiting for approval" value={o.agencies.byStatus.pending} icon={Clock} tone="amber" note={o.autoApprove ? 'auto-approve on' : undefined} />
        <StatCard label="Suspended" value={o.agencies.byStatus.suspended} icon={CirclePause} tone="red" />
        <StatCard
          label="Signups, last 7 days"
          value={o.signups.last7}
          icon={TrendingUp}
          tone="indigo"
          note={change === 0 ? 'same as the week before' : `${change > 0 ? '+' : '−'}${Math.abs(change)} vs the week before`}
        />
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card
          title="Waiting for approval"
          description="Oldest first"
          action={
            <Link to="/admin/approvals" className={buttonClass('ghost', 'sm')}>
              View all <ArrowRight size={14} />
            </Link>
          }
        >
          {o.pending.length === 0 ? (
            <EmptyState title="You’re all caught up">No agencies are waiting for approval.</EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {o.pending.map((a) => (
                <li key={a._id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <Link to={`/admin/agencies/${a._id}`} className="block truncate text-[13px] font-semibold hover:underline">
                      {a.name}
                    </Link>
                    <div className="truncate text-xs text-text-3">
                      {[a.email, a.country, a.teamSize && `${a.teamSize} people`].filter(Boolean).join(' · ')} · signed up {timeAgo(a.createdAt)}
                    </div>
                  </div>
                  <Button size="sm" onClick={() => actions.run('reject', { ...a, status: 'pending' })}>
                    Reject
                  </Button>
                  <Button size="sm" variant="primary" onClick={() => actions.run('approve', { ...a, status: 'pending' })}>
                    Approve
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Active agencies by plan" description={`${activeTotal} active agencies`}>
          <ul className="flex flex-col gap-3 px-5 py-4">
            {PLANS.map((p) => {
              const n = o.activePlans[p]
              return (
                <li key={p}>
                  <Link to={`/admin/subscriptions?plan=${p}`} className="group block">
                    <div className="flex justify-between text-[13px]">
                      <span className="group-hover:underline">{planLabel[p]}</span>
                      <span className="text-text-3">{n}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 rounded-full bg-[#edecf0]">
                      <div className="h-full rounded-full bg-brand" style={{ width: activeTotal ? `${(n / activeTotal) * 100}%` : 0 }} />
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        </Card>
      </div>

      <Card
        className="mt-6"
        title="Recent activity"
        action={
          <Link to="/admin/activity" className={buttonClass('ghost', 'sm')}>
            Full log <ArrowRight size={14} />
          </Link>
        }
      >
        <ul className="divide-y divide-border">
          {o.recentActivity.map((a) => (
            <li key={a._id} className="flex items-start gap-4 px-5 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-[13px]">{a.message}</div>
                <div className="text-xs text-text-3">{actionLabel(a.action)}</div>
              </div>
              <time className="shrink-0 text-xs text-text-4" dateTime={a.createdAt}>
                {timeAgo(a.createdAt)}
              </time>
            </li>
          ))}
          {o.recentActivity.length === 0 && <EmptyState title="No activity yet" />}
        </ul>
      </Card>
      {actions.dialog}
    </>
  )
}
