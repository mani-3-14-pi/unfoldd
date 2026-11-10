import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlarmClock, CalendarCheck, ClipboardCheck, Hammer, Hourglass, ThumbsDown, TriangleAlert } from 'lucide-react'
import { Link } from 'react-router'
import { EmptyState, StatCard } from '@/components/ui/Card'
import { Pill } from '@/components/ui/Pill'
import { Switch } from '@/components/ui/Switch'
import { useAgencySession } from '@/features/agency/session'
import { HealthPill } from '@/features/clients/pills'
import { dashboardApi, dashboardKey, type Dashboard } from '@/features/dashboard/api'
import { DashCard } from '@/features/dashboard/DashCard'
import { GetStarted } from '@/features/dashboard/GetStarted'
import { UpcomingContent, UpcomingMeetings } from '@/features/dashboard/Upcoming'
import { useLiveDashboard } from '@/features/dashboard/useLiveDashboard'
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
  // No polling: the server pushes a change event and the dashboard refetches (useLiveDashboard).
  const query = useQuery({ queryKey: dashboardKey(mine), queryFn: () => dashboardApi.get(mine) })
  useLiveDashboard()

  return (
    <>
      <header className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1>
            <span className="block text-xs font-semibold tracking-[0.06em] text-text-2 uppercase">
              {greeting()}! Welcome, {s.user.name.split(' ')[0]}
            </span>
            <span className="mt-2 block font-display text-[34px] leading-[1.08] font-extrabold tracking-[-0.03em] sm:text-[44px]">
              Here’s what’s
              <br />
              happening <span className="text-brand-hover">today.</span>
            </span>
          </h1>
          <p className="mt-2 text-[15px] text-text-2">
            A quick look at what’s happening across your clients at <span className="font-medium text-text">{s.agency.name}</span>.
          </p>
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
          <Overview data={query.data} mine={mine} />
        )}
      </div>
    </>
  )
}

function Overview({ data: d, mine }: { data: Dashboard; mine: boolean }) {
  const m = d.metrics
  /** The content list behind a number, narrowed to "mine" when the dashboard is. */
  const content = (states: string) => `/app/content?state=${states}${mine ? '&mine=true' : ''}`
  const brand = (id: string) => d.clients.find((c) => c.id === id)?.brandName ?? ''
  const notOnTrack = d.clients.filter((c) => c.health !== 'on_track')

  return (
    <>
      <section aria-label="Overview" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Awaiting review" value={m.awaitingReview} icon={ClipboardCheck} tone="indigo" note="internal" to="/app/review" />
        <StatCard label="Awaiting approval" value={m.awaitingApproval} icon={Hourglass} tone="amber" note="with clients" to={content('client_review')} />
        <StatCard label="In production" value={m.inProduction} icon={Hammer} tone="blue" to={content('in_production')} />
        {/* Overdue tasks and approvals together: they're listed one by one under Needs attention. */}
        <StatCard label="Overdue" value={m.overdue} icon={AlarmClock} tone={m.overdue ? 'red' : 'gray'} />
        <StatCard label="Changes requested" value={m.changesRequested} icon={ThumbsDown} tone={m.changesRequested ? 'red' : 'gray'} to={content('changes_requested')} />
        <StatCard label="Ready to schedule" value={m.readyToSchedule} icon={CalendarCheck} tone="green" to={content('approved')} />
        <StatCard label="Scheduled" value={m.scheduled} icon={CalendarCheck} tone="green" to={content('scheduled,publishing')} />
        <StatCard label="Clients needing attention" value={notOnTrack.length} icon={TriangleAlert} tone={notOnTrack.length ? 'amber' : 'gray'} note={`of ${d.clients.length}`} to="/app/clients" />
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <UpcomingMeetings brand={brand} />
        <UpcomingContent mine={mine} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <DashCard title="Needs attention" description="Most urgent first." action={<span className="grid h-7 min-w-7 place-items-center rounded-full bg-surface-input px-2 text-xs font-medium">{d.needsAttention.total}</span>}>
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
        </DashCard>

        <DashCard title="Waiting on clients" description="Sent for approval, oldest first." viewAll={content('client_review')}>
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
        </DashCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <DashCard title="Team workload" description="Active tasks against each person’s capacity." viewAll="/app/team" className="xl:col-span-2">
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
        </DashCard>

        <DashCard title="Client health" viewAll="/app/clients">
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
        </DashCard>
      </div>

      <DashCard title="Recent activity" viewAll="/app/activity">
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
      </DashCard>
    </>
  )
}

/** "Good morning" until noon, "Good afternoon" until 5 pm, then "Good evening", in the viewer's time. */
function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

const rank = (h: string) => (h === 'blocked' ? 0 : h === 'needs_attention' ? 1 : 2)
