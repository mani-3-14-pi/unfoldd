import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarClock, ChevronRight, ClipboardCheck, Inbox, LayoutGrid, PartyPopper, Video } from 'lucide-react'
import { Link } from 'react-router'
import { Card, EmptyState } from '@/components/ui/Card'
import { Pill } from '@/components/ui/Pill'
import { useClientSession } from '@/features/agency/session'
import { clientHomeApi, clientHomeKey, type AttentionItem, type ClientHome } from '@/features/client-app/home/api'
import { attentionTone, bucketTone, formatDay, meetingPlatformLabel, todayIn } from '@/features/client-app/home/labels'
import { platformLabel } from '@/features/content/labels'
import type { Platform } from '@/features/content/api'
import { errorMessage } from '@/lib/errors'
import { timeAgo } from '@/lib/format'
import { formatInZone } from '@/lib/zonedTime'

/**
 * F11 Client Home (D50): greeting → banner → one Needs Attention list, sorted by when it's needed →
 * next meeting → upcoming content. Everything is computed live by the server (D51).
 */
export function ClientHomePage() {
  const s = useClientSession()
  const home = useQuery({ queryKey: clientHomeKey, queryFn: clientHomeApi.home, refetchInterval: 60_000 })

  if (home.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <div className="h-10 w-2/3 animate-pulse rounded-lg bg-surface-input" />
        <div className="h-32 animate-pulse rounded-2xl bg-surface-input" />
        <div className="h-48 animate-pulse rounded-2xl bg-surface-input" />
      </div>
    )
  }
  if (home.isError) return <EmptyState title="Couldn’t load your home">{errorMessage(home.error)}</EmptyState>

  const h = home.data
  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="text-[13px] text-text-3">{s.client.brandName}</p>
        <h1 className="mt-1 font-serif text-[32px] leading-tight text-brand">
          Good {h.greeting.partOfDay}, {h.greeting.name}
        </h1>
      </header>

      {h.banners.length > 0 && <Banners banners={h.banners} />}
      <NeedsAttention home={h} tz={s.client.timezone} />
      {h.nextMeeting && <NextMeetingCard meeting={h.nextMeeting} tz={s.client.timezone} />}
      <Upcoming home={h} tz={s.client.timezone} />
    </div>
  )
}

/** F12: live banners from the agency, swiped sideways when there are several. */
function Banners({ banners }: { banners: ClientHome['banners'] }) {
  return (
    <section aria-label="From your agency" className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1">
      {banners.map((b) => (
        <Link
          key={b._id}
          to={`/c/banners/${b._id}`}
          className="auth-gradient flex min-h-32 w-[85%] max-w-md shrink-0 snap-start flex-col justify-between rounded-2xl p-5 text-white shadow-sm sm:w-[70%]"
        >
          <span>
            <span className="block text-lg leading-snug font-semibold">{b.headline}</span>
            {b.text && <span className="mt-1 line-clamp-2 block text-[13px] text-white/85">{b.text}</span>}
          </span>
          <span className="mt-3 inline-flex items-center gap-1 self-start rounded-full bg-white/18 px-3 py-1.5 text-xs font-semibold">
            {b.cta?.label || 'Open'} <ChevronRight size={14} />
          </span>
        </Link>
      ))}
    </section>
  )
}

/** F14/F15: one merged list (D50), soonest first. Empty means all caught up. */
function NeedsAttention({ home: h, tz }: { home: ClientHome; tz: string }) {
  const [now] = useState(() => Date.now())
  const today = todayIn(tz, now)

  if (h.needsAttention.allCaughtUp) {
    return (
      <section className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-surface px-6 py-8 text-center">
        <span className="grid size-12 place-items-center rounded-2xl bg-green-soft text-green-ink">
          <PartyPopper size={24} />
        </span>
        <h2 className="text-base font-semibold">You’re all caught up</h2>
        <p className="text-[13px] text-text-3">Nothing needs you right now. We’ll let you know when something does.</p>
      </section>
    )
  }

  const detail = (a: AttentionItem) => {
    if (a.kind === 'request') {
      if (!a.due) return 'Needed from you'
      const day = a.due.slice(0, 10)
      return day < today ? `Overdue since ${formatDay(day)}` : `Due ${formatDay(day)}`
    }
    if (a.kind === 'plan') return a.since ? `Sent ${timeAgo(a.since)}` : 'Waiting for your review'
    return a.due ? `Approval needed by ${formatInZone(a.due, tz, { withViewer: false })}` : a.since ? `Review pending since ${timeAgo(a.since)}` : ''
  }
  const overdue = (a: AttentionItem) => (a.kind === 'request' ? !!a.due && a.due.slice(0, 10) < today : !!a.due && new Date(a.due).getTime() < now)
  const icon = { review: ClipboardCheck, plan: LayoutGrid, request: Inbox }

  return (
    <Card title="Needs your attention" action={<span className="grid h-7 min-w-7 place-items-center rounded-full bg-[#e5484d] px-2 text-xs font-semibold text-white">{h.needsAttention.total}</span>}>
      <ul className="divide-y divide-border">
        {h.needsAttention.items.map((a) => {
          const Icon = icon[a.kind]
          return (
            <li key={`${a.kind}-${a.id}`}>
              <Link to={a.link} className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-[#f6f5f6]">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-input text-text-2">
                  <Icon size={19} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium">{a.title}</span>
                  <span className={overdue(a) ? 'block truncate text-xs font-medium text-negative' : 'block truncate text-xs text-text-3'}>{detail(a)}</span>
                </span>
                <Pill tone={attentionTone[a.kind]}>{a.label}</Pill>
              </Link>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

function NextMeetingCard({ meeting: m, tz }: { meeting: NonNullable<ClientHome['nextMeeting']>; tz: string }) {
  return (
    <Card title="Next meeting">
      <div className="flex items-center gap-3 px-4 py-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-blue-soft text-blue-ink">
          <Video size={19} />
        </span>
        <Link to={`/c/meetings/${m._id}`} className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium">{m.title}</span>
          <span className="block truncate text-xs text-text-3">
            {formatInZone(m.startAt, tz)} · {meetingPlatformLabel[m.platform ?? 'other'] ?? 'Online'}
          </span>
        </Link>
        {m.joinUrl && (
          <a href={m.joinUrl} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center rounded-xl bg-brand px-4 text-[13px] font-semibold text-white hover:bg-brand-hover">
            Join
          </a>
        )}
      </div>
    </Card>
  )
}

function Upcoming({ home: h, tz }: { home: ClientHome; tz: string }) {
  return (
    <Card
      title="Coming up"
      description="Approved and scheduled posts."
      action={
        <Link to="/c/calendar" className="text-xs font-medium text-brand hover:underline">
          Calendar
        </Link>
      }
    >
      {h.upcomingContent.length === 0 ? (
        <div className="flex items-center gap-2 px-4 py-6 text-[13px] text-text-3">
          <CalendarClock size={16} /> Nothing scheduled yet.
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {h.upcomingContent.map((c) => (
            <li key={c._id}>
              <Link to={`/c/content/${c._id}`} className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-[#f6f5f6]">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium">{c.title}</span>
                  <span className="block truncate text-xs text-text-3">
                    {platformLabel[c.platform as Platform] ?? c.platform} · {formatInZone(c.publishDate, tz, { withViewer: false })}
                  </span>
                </span>
                <Pill tone={bucketTone[c.status.bucket ?? ''] ?? 'gray'}>{c.status.delayed ? 'Publishing delayed' : c.status.label}</Pill>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
