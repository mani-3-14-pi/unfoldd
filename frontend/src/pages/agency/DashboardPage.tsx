import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlarmClock, CalendarCheck, ClipboardCheck, Hammer, Hourglass, ThumbsDown, TriangleAlert } from 'lucide-react'
import { Link } from 'react-router'
import { Card, EmptyState, StatCard } from '@/components/ui/Card'
import { Pill } from '@/components/ui/Pill'
import { Switch } from '@/components/ui/Switch'
import { useAgencySession } from '@/features/agency/session'
import { HealthPill } from '@/features/clients/pills'
import { dashboardApi, dashboardKey, type Dashboard } from '@/features/dashboard/api'
import { GetStarted } from '@/features/dashboard/GetStarted'
import { attentionLabel, severityTone, workloadLabel, workloadTone } from '@/features/dashboard/labels'
import { versionLabel } from '@/features/content/labels'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { formatDate, timeAgo } from '@/lib/format'

/**
 * P05–P10: the agency's command centre. Numbers, Needs Attention, pending client approvals, team workload,
 * client health and recent activity, all computed live from the source data (D51).
 */
export function DashboardPage() {
  const s = useAgencySession()
  const [mine, setMine] = useState(false)
  const query = useQuery({ queryKey: dashboardKey(mine), queryFn: () => dashboardApi.get(mine), refetchInterval: 60_000 })

  return (
    <>
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[13px] text-text-3">{s.agency.name}</p>
          <h1 className="mt-1 font-serif text-4xl text-brand">Welcome, {s.user.name.split(' ')[0]}</h1>
        </div>
        <label className="flex items-center gap-2 text-xs text-text-2">
          <Switch label="Only my work" checked={mine} onChange={setMine} />
          Only my reviews and tasks
        </label>
      </header>

      <div className="flex flex-col gap-6">
        <GetStarted />
        {query.isPending ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl bg-surface-input" />
            ))}
          </div>
        ) : query.isError ? (
          <EmptyState title="Couldn’t load the dashboard">{errorMessage(query.error)}</EmptyState>
        ) : (
          <Overview data={query.data} />
        )}
      </div>
    </>
  )
}

function Overview({ data: d }: { data: Dashboard }) {
  const m = d.metrics
  const brand = (id: string) => d.clients.find((c) => c.id === id)?.brandName ?? ''
  const notOnTrack = d.clients.filter((c) => c.health !== 'on_track')

  return (
    <>
      <section aria-label="Overview" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Awaiting review" value={m.awaitingReview} icon={ClipboardCheck} tone="indigo" note="internal" />
        <StatCard label="Awaiting approval" value={m.awaitingApproval} icon={Hourglass} tone="amber" note="with clients" />
        <StatCard label="In production" value={m.inProduction} icon={Hammer} tone="blue" />
        <StatCard label="Overdue" value={m.overdue} icon={AlarmClock} tone={m.overdue ? 'red' : 'gray'} />
        <StatCard label="Changes requested" value={m.changesRequested} icon={ThumbsDown} tone={m.changesRequested ? 'red' : 'gray'} />
        <StatCard label="Ready to schedule" value={m.readyToSchedule} icon={CalendarCheck} tone="green" />
        <StatCard label="Scheduled" value={m.scheduled} icon={CalendarCheck} tone="green" />
        <StatCard label="Clients needing attention" value={notOnTrack.length} icon={TriangleAlert} tone={notOnTrack.length ? 'amber' : 'gray'} note={`of ${d.clients.length}`} />
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card title="Needs attention" description="Most urgent first." action={<span className="grid h-7 min-w-7 place-items-center rounded-full bg-surface-input px-2 text-xs font-medium">{d.needsAttention.total}</span>}>
          {d.needsAttention.items.length === 0 ? (
            <EmptyState title="All caught up">Nothing is late, at risk or waiting on your team.</EmptyState>
          ) : (
            <ul className="max-h-[440px] divide-y divide-border overflow-y-auto">
              {d.needsAttention.items.map((a) => (
                <li key={`${a.kind}-${a.entity.id}`}>
                  <Link to={a.link} className="flex items-center gap-3 px-5 py-3 hover:bg-[#f6f5f6]">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold">{a.title}</span>
                      <span className="block truncate text-xs text-text-3">
                        {a.client.brandName}
                        {a.at && ` · ${timeAgo(a.at)}`}
                      </span>
                    </span>
                    <Pill tone={severityTone[a.severity]}>{attentionLabel[a.kind]}</Pill>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Waiting on clients" description="Sent for approval, oldest first.">
          {d.pendingApprovals.length === 0 ? (
            <EmptyState title="Nothing with clients">Content sent for review shows up here.</EmptyState>
          ) : (
            <ul className="max-h-[440px] divide-y divide-border overflow-y-auto">
              {d.pendingApprovals.map((p) => (
                <li key={p._id}>
                  <Link to={`/app/content/${p._id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-[#f6f5f6]">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold">{p.title}</span>
                      <span className="block truncate text-xs text-text-3">
                        {brand(p.client)}
                        {p.versionNumber ? ` · ${versionLabel(p.versionNumber)}` : ''}
                        {p.publishDate && ` · publishes ${formatDate(p.publishDate)}`}
                      </span>
                    </span>
                    <span className="flex flex-col items-end gap-1">
                      <Pill tone={p.viewed ? 'indigo' : 'blue'}>{p.viewed ? 'Viewed' : 'Not opened'}</Pill>
                      <span className="text-[11px] text-text-4">sent {timeAgo(p.sentAt)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="Team workload" description="Active tasks against each person’s capacity." className="xl:col-span-2">
          {d.workload.length === 0 ? (
            <EmptyState title="No one on the team yet" />
          ) : (
            <ul className="divide-y divide-border">
              {d.workload.map((w) => (
                <li key={w.user._id} className="flex items-center gap-4 px-5 py-3">
                  <span className="w-40 min-w-0 shrink-0">
                    <span className="block truncate text-[13px] font-medium">{w.user.name}</span>
                    <span className="block truncate text-xs text-text-3">{w.titles.join(', ') || w.departments.join(', ') || '—'}</span>
                  </span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-input" role="img" aria-label={`${w.load}% of capacity`}>
                    <span
                      className={cn('block h-full rounded-full', w.status === 'overloaded' ? 'bg-red-dot' : w.status === 'at_capacity' ? 'bg-amber-dot' : 'bg-green-dot')}
                      style={{ width: `${Math.min(100, w.load)}%` }}
                    />
                  </span>
                  <span className="w-16 shrink-0 text-right text-xs text-text-2">
                    {w.activeTasks} / {w.capacity}
                  </span>
                  <span className="w-28 shrink-0 text-right">
                    <Pill tone={workloadTone[w.status]}>{workloadLabel[w.status]}</Pill>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Client health">
          {d.clients.length === 0 ? (
            <EmptyState title="No clients yet" />
          ) : (
            <ul className="max-h-[400px] divide-y divide-border overflow-y-auto">
              {[...d.clients]
                .sort((a, b) => rank(a.health) - rank(b.health) || a.brandName.localeCompare(b.brandName))
                .map((c) => (
                  <li key={c.id}>
                    <Link to={`/app/clients/${c.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-[#f6f5f6]">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold">{c.brandName}</span>
                        {c.reasons.length > 0 && <span className="block truncate text-xs text-text-3">{c.reasons.join(' · ')}</span>}
                      </span>
                      <HealthPill health={c.health} reasons={c.reasons} />
                    </Link>
                  </li>
                ))}
            </ul>
          )}
        </Card>
      </div>

      <Card
        title="Recent activity"
        action={
          <Link to="/app/activity" className="text-xs font-medium text-brand hover:underline">
            See all
          </Link>
        }
      >
        {d.recentActivity.length === 0 ? (
          <EmptyState title="Nothing yet" />
        ) : (
          <ul className="divide-y divide-border">
            {d.recentActivity.map((a) => (
              <li key={a._id} className="flex items-baseline gap-3 px-5 py-2.5">
                <span className="min-w-0 flex-1 text-[13px]">{a.message}</span>
                <time className="shrink-0 text-xs text-text-4">{timeAgo(a.createdAt)}</time>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}

const rank = (h: string) => (h === 'blocked' ? 0 : h === 'needs_attention' ? 1 : 2)
