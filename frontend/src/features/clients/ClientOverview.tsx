import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  ChevronRight,
  Circle,
  Eye,
  FileText,
  Megaphone,
  Send,
  Video,
} from 'lucide-react'
import { Link } from 'react-router'
import { Card, EmptyState, StatCard } from '@/components/ui/Card'
import { campaignsApi } from '@/features/campaigns/api'
import { CampaignStatusPill, ProgressBar } from '@/features/campaigns/pills'
import { contentApi, type ContentState } from '@/features/content/api'
import { formatLabel, platformLabel } from '@/features/content/labels'
import { StatePill } from '@/features/content/pills'
import { formatIcon, platformTint } from '@/features/content/tiles'
import { meetingsApi } from '@/features/meetings/api'
import { meetingPlatformLabel } from '@/features/meetings/labels'
import { tasksApi } from '@/features/tasks/api'
import { isOverdue, todayString } from '@/features/tasks/labels'
import { TaskStatusPill } from '@/features/tasks/pills'
import { cn } from '@/lib/cn'
import { formatDate, plural } from '@/lib/format'
import { timezoneLabel } from '@/lib/timezones'
import type { ClientDetail } from './api'

const dayFmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit' })
const monthFmt = new Intl.DateTimeFormat('en-GB', { month: 'short' })
const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' })
const shortFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })

const OPEN_TASKS = 'todo,in_progress,in_review'

/** A date-only due date as "Today", "Tomorrow" or "6 Nov". */
function dueLabel(due: string, today: string) {
  if (!due) return 'No due date'
  if (due === today) return 'Today'
  const [y, m, d] = today.split('-').map(Number)
  const t = new Date(y, m - 1, d + 1)
  const tomorrow = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
  if (due === tomorrow) return 'Tomorrow'
  const [dy, dm, dd] = due.split('-').map(Number)
  return shortFmt.format(new Date(dy, dm - 1, dd))
}

function ViewAll({ to, label = 'View all' }: { to: string; label?: string }) {
  return (
    <Link to={to} className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-text-2 hover:text-text">
      {label} <ArrowRight size={14} />
    </Link>
  )
}

function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3 px-5 py-4">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-11 animate-pulse rounded-lg bg-surface-input" />
      ))}
    </div>
  )
}

/** P17: what's happening for one client, with every block linking to the full list behind it. */
export function ClientOverview({ client: c }: { client: ClientDetail }) {
  const base = `/app/clients/${c._id}`
  const health = c.status !== 'archived' && c.health && c.health.health !== 'on_track' ? c.health : null

  // One request gives the per-state counts and the most recently updated content.
  const content = useQuery({
    queryKey: ['agency', 'content', 'list', 'client-overview', c._id],
    queryFn: () => contentApi.list(new URLSearchParams({ client: c._id, pageSize: '10' }).toString()),
  })
  const counts = content.data?.counts
  const count = (...states: ContentState[]) => (counts ? states.reduce((n, s) => n + (counts[s] ?? 0), 0) : '–')
  const total = counts ? Object.entries(counts).reduce((n, [s, k]) => (s === 'cancelled' ? n : n + k), 0) : '–'
  const stateLink = (states: string) => `${base}/content?state=${states}`

  return (
    <div className="flex flex-col gap-6">
      {health && (
        <section className={`flex gap-3 rounded-xl border px-5 py-4 ${health.health === 'blocked' ? 'border-red-soft bg-[#fdf3f3] text-red-ink' : 'border-amber-soft bg-[#fdf8f1] text-amber-ink'}`}>
          <AlertTriangle size={18} className="mt-px shrink-0" />
          <div>
            <h2 className="text-[13px] font-semibold">{health.health === 'blocked' ? 'Blocked' : 'Needs attention'}</h2>
            <ul className="mt-1 list-disc pl-4 text-[13px]">
              {health.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section aria-label="Content overview" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total content" value={total} icon={FileText} tone="green" note="not counting cancelled" to={`${base}/content`} />
        <StatCard label="Published" value={count('published')} icon={Send} tone="indigo" to={stateLink('published')} />
        <StatCard label="Awaiting client review" value={count('client_review')} icon={Eye} tone="red" note="with the client" to={stateLink('client_review')} />
        <StatCard label="Scheduled" value={count('scheduled', 'publishing')} icon={CalendarClock} tone="amber" note="ready to go live" to={stateLink('scheduled,publishing')} />
      </section>

      <div className="grid gap-6 xl:grid-cols-3">
        <ActiveCampaigns clientId={c._id} base={base} />
        <OpenTasks clientId={c._id} />
        <ClientInformation client={c} />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="Recent content" description="Most recently updated first." action={<ViewAll to={`${base}/content`} />} className="xl:col-span-2">
          {content.isPending ? (
            <Loading />
          ) : !content.data || content.data.items.length === 0 ? (
            <EmptyState title="No content yet">Posts, reels and carousels for this client show up here.</EmptyState>
          ) : (
            <ul className="grid grid-cols-2 gap-3 px-5 py-4 sm:grid-cols-3 lg:grid-cols-5">
              {content.data.items.slice(0, 5).map((item) => {
                const Icon = formatIcon[item.format]
                return (
                  <li key={item._id} className="min-w-0">
                    <Link to={`/app/content/${item._id}`} className="group block">
                      <span className={cn('relative grid aspect-[4/3] place-items-center rounded-xl bg-gradient-to-br', platformTint[item.platform])}>
                        <Icon size={28} strokeWidth={1.5} />
                        <span className="absolute bottom-2 left-2 rounded-md bg-white/85 px-1.5 py-0.5 text-[10px] font-medium text-text-2">{platformLabel[item.platform]}</span>
                      </span>
                      <span className="mt-2 block truncate text-[13px] font-semibold group-hover:underline">{item.title}</span>
                      <span className="block truncate text-xs text-text-3">
                        {item.publishDate ? `${shortFmt.format(new Date(item.publishDate))} · ${formatLabel[item.format]}` : formatLabel[item.format]}
                      </span>
                      <span className="mt-1.5 block">
                        <StatePill state={item.state} />
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
        <NextMeeting clientId={c._id} base={base} />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="Internal notes" description="Only your team sees these." className="xl:col-span-2">
          <p className="px-5 py-4 text-[13px] whitespace-pre-line text-text-2">{c.notes || 'No notes yet.'}</p>
        </Card>
        <Card title="Contract">
          <dl className="px-5 py-3">
            <InfoRow label="Revisions included">{`${plural(c.contract.revisionsIncluded, 'round')} per post`}</InfoRow>
            <InfoRow label="Approval needed">{`${plural(c.contract.approvalLeadHours, 'hour')} before publishing`}</InfoRow>
            <InfoRow label="Internal review">{c.contract.internalReview ? 'On: a manager approves before the client sees it' : 'Off: work goes straight to the client'}</InfoRow>
          </dl>
        </Card>
      </div>
    </div>
  )
}

function ActiveCampaigns({ clientId, base }: { clientId: string; base: string }) {
  const query = useQuery({
    queryKey: ['agency', 'campaigns', 'list', 'client-overview', clientId],
    queryFn: () => campaignsApi.list(new URLSearchParams({ client: clientId, status: 'planning,active', pageSize: '10' }).toString()),
  })
  const items = query.data?.items ?? []
  return (
    <Card title="Active campaigns" action={<ViewAll to={`${base}/campaigns`} />}>
      {query.isPending ? (
        <Loading />
      ) : items.length === 0 ? (
        <EmptyState title="No active campaigns">Campaigns being planned or running show up here.</EmptyState>
      ) : (
        <ul className="divide-y divide-border">
          {items.slice(0, 4).map((k) => (
            <li key={k._id}>
              <Link to={`/app/campaigns/${k._id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-[#f6f5f6]">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-amber-soft text-amber-ink">
                  <Megaphone size={20} strokeWidth={1.7} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold">{k.name}</span>
                  <span className="block truncate text-xs text-text-3">
                    {k.startDate ? `${formatDate(k.startDate)}${k.endDate ? ` – ${formatDate(k.endDate)}` : ''}` : 'No dates yet'}
                  </span>
                  {k.progress.total > 0 && (
                    <span className="mt-1.5 block">
                      <ProgressBar progress={k.progress} compact />
                    </span>
                  )}
                </span>
                <CampaignStatusPill status={k.status} />
                <ChevronRight size={16} className="shrink-0 text-text-4" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function OpenTasks({ clientId }: { clientId: string }) {
  const query = useQuery({
    queryKey: ['agency', 'tasks', 'list', 'client-overview', clientId],
    queryFn: () => tasksApi.list(new URLSearchParams({ client: clientId, status: OPEN_TASKS, pageSize: '25' }).toString()),
  })
  const today = todayString()
  // Soonest due first; tasks without a due date go last.
  const items = [...(query.data?.items ?? [])].sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999')).slice(0, 5)
  return (
    <Card title="Upcoming tasks" action={<ViewAll to={`/app/tasks?client=${clientId}`} />}>
      {query.isPending ? (
        <Loading />
      ) : items.length === 0 ? (
        <EmptyState title="No open tasks">Tasks for this client show up here.</EmptyState>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((t) => {
            const late = isOverdue(t, today)
            return (
              <li key={t._id}>
                <Link to={`/app/tasks/${t._id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-[#f6f5f6]">
                  <Circle size={17} strokeWidth={1.6} className="shrink-0 text-text-4" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{t.title}</span>
                    <span className="block truncate text-xs text-text-3">{t.ownerInfo?.name ?? 'Unassigned'}</span>
                  </span>
                  <span className={cn('shrink-0 text-xs', late ? 'font-medium text-red-ink' : t.due === today ? 'text-negative' : 'text-text-3')}>
                    {late ? `Overdue · ${dueLabel(t.due, today)}` : dueLabel(t.due, today)}
                  </span>
                  <span className="hidden shrink-0 2xl:block">
                    <TaskStatusPill status={t.status} />
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 py-1.5">
      <dt className="text-xs text-text-3">{label}</dt>
      <dd className="text-[13px] break-words">{children || children === 0 ? children : '—'}</dd>
    </div>
  )
}

/** The client's details and main contact in one card, as label/value rows. */
function ClientInformation({ client: c }: { client: ClientDetail }) {
  return (
    <Card title="Client information">
      <dl className="px-5 py-3">
        <InfoRow label="Brand">{c.brandName}</InfoRow>
        <InfoRow label="Company">{c.name}</InfoRow>
        <InfoRow label="Services">{c.services.join(', ')}</InfoRow>
        <InfoRow label="Account manager">{c.accountManager?.name ?? <span className="text-amber-ink">Not assigned</span>}</InfoRow>
        <InfoRow label="Primary contact">{c.contact.name}</InfoRow>
        <InfoRow label="Email">
          {c.contact.email && (
            <a href={`mailto:${c.contact.email}`} title={c.contact.email} className="block truncate hover:underline">
              {c.contact.email}
            </a>
          )}
        </InfoRow>
        <InfoRow label="Phone">{c.contact.phone}</InfoRow>
        <InfoRow label="Client since">{c.startDate ? formatDate(c.startDate) : ''}</InfoRow>
        <InfoRow label="Timezone">{timezoneLabel(c.timezone)}</InfoRow>
        <InfoRow label="Added">{formatDate(c.createdAt)}</InfoRow>
      </dl>
    </Card>
  )
}

function NextMeeting({ clientId, base }: { clientId: string; base: string }) {
  // One "now" per mount, so the query key doesn't change on every render.
  const [now] = useState(() => new Date().toISOString())
  const query = useQuery({
    queryKey: ['agency', 'meetings', 'list', 'client-overview', clientId, now],
    queryFn: () => meetingsApi.list(new URLSearchParams({ client: clientId, status: 'scheduled', from: now, pageSize: '10' }).toString()),
  })
  const [next, ...later] = query.data?.items ?? []
  return (
    <Card title="Next meeting" action={<ViewAll to={`${base}/meetings`} />}>
      {query.isPending ? (
        <Loading rows={1} />
      ) : !next ? (
        <EmptyState title="No meeting scheduled">Meetings booked with this client show up here.</EmptyState>
      ) : (
        <div className="flex flex-col gap-4 px-5 py-4">
          <div className="flex items-center gap-4">
            <span className="grid size-14 shrink-0 place-content-center rounded-xl bg-green-soft text-center text-green-ink">
              <span className="font-display text-xl leading-none font-bold">{dayFmt.format(new Date(next.startAt))}</span>
              <span className="mt-0.5 text-[10px] font-medium uppercase">{monthFmt.format(new Date(next.startAt))}</span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{next.title}</span>
              <span className="block text-xs text-text-3">
                {timeFmt.format(new Date(next.startAt))} – {timeFmt.format(new Date(next.endAt))}
              </span>
            </span>
            <Video size={20} strokeWidth={1.7} className="shrink-0 text-blue-ink" aria-label={meetingPlatformLabel[next.platform]} />
          </div>
          <p className="text-xs text-text-3">
            {meetingPlatformLabel[next.platform]} · {plural(next.participants.agency.length + next.participants.client.length, 'person', 'people')}
            {later.length > 0 && ` · ${plural(later.length, 'more meeting')} after this`}
          </p>
          <Link to={`/app/meetings/${next._id}`} className="inline-flex h-9 items-center justify-center rounded-lg border border-[#e6e5e8] bg-white px-3 text-xs font-medium hover:bg-[#f6f6f7]">
            View agenda
          </Link>
        </div>
      )}
    </Card>
  )
}
