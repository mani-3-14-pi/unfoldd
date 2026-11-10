import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Video } from 'lucide-react'
import { Link } from 'react-router'
import { EmptyState } from '@/components/ui/Card'
import { CONTENT_STATES, contentApi } from '@/features/content/api'
import { formatLabel, platformLabel } from '@/features/content/labels'
import { StatePill } from '@/features/content/pills'
import { meetingPlatformLabel } from '@/features/meetings/labels'
import { meetingsApi } from '@/features/meetings/api'
import { formatIcon, platformTint } from '@/features/content/tiles'
import { cn } from '@/lib/cn'
import { DashCard } from './DashCard'

const dayFmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit' })
const monthFmt = new Intl.DateTimeFormat('en-GB', { month: 'short' })
const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' })
const shortFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()

/** "Today · 14:00", "Tomorrow · 09:30" or "12 Nov · 18:00", in the viewer's time. */
function when(value: string) {
  const d = new Date(value)
  const today = new Date()
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
  const day = sameDay(d, today) ? 'Today' : sameDay(d, tomorrow) ? 'Tomorrow' : shortFmt.format(d)
  return `${day} · ${timeFmt.format(d)}`
}

/** The next scheduled meetings across every client the viewer can see. */
export function UpcomingMeetings({ brand }: { brand: (clientId: string) => string }) {
  // One "now" per mount, so the query key doesn't change on every render.
  const [now] = useState(() => new Date().toISOString())
  const query = useQuery({
    queryKey: ['agency', 'meetings', 'list', 'dashboard', now],
    queryFn: () => meetingsApi.list(new URLSearchParams({ status: 'scheduled', from: now, pageSize: '10' }).toString()),
  })
  const items = query.data?.items.slice(0, 4) ?? []
  const today = new Date(now)

  return (
    <DashCard title="Upcoming meetings" viewAll="/app/meetings">
      {query.isPending ? (
        <div className="flex flex-col gap-3 px-5 pb-5">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-surface-input" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState title="No meetings coming up">Scheduled client meetings show up here.</EmptyState>
      ) : (
        <ul className="divide-y divide-border px-5 pb-2">
          {items.map((m) => {
            const start = new Date(m.startAt)
            return (
              <li key={m._id}>
                <Link to={`/app/meetings/${m._id}`} className="-mx-2 flex items-center gap-4 rounded-lg px-2 py-3 hover:bg-[#f6f5f6]">
                  <span className="grid size-12 shrink-0 place-content-center rounded-xl bg-indigo-soft text-center text-indigo-ink">
                    <span className="font-display text-lg leading-none font-bold">{dayFmt.format(start)}</span>
                    <span className="mt-0.5 text-[10px] font-medium uppercase">{monthFmt.format(start)}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">{m.title}</span>
                    <span className="flex items-center gap-2 truncate text-xs text-text-3">
                      {brand(m.client)}
                      {sameDay(start, today) && <span className="rounded bg-green-soft px-1.5 py-px text-[10px] font-medium text-green-ink">Today</span>}
                    </span>
                  </span>
                  <span className="hidden shrink-0 items-center gap-1.5 text-xs text-text-2 sm:flex">
                    <Video size={15} strokeWidth={1.8} className="text-blue-ink" aria-label={meetingPlatformLabel[m.platform]} />
                    {timeFmt.format(start)} – {timeFmt.format(new Date(m.endAt))}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </DashCard>
  )
}

/** Content with a publish date still ahead, soonest first. Narrowed to "mine" with the rest of the dashboard. */
export function UpcomingContent({ mine }: { mine: boolean }) {
  const [now] = useState(() => new Date().toISOString())
  const params = new URLSearchParams({
    publishFrom: now,
    sort: 'publish_date',
    pageSize: '10',
    state: CONTENT_STATES.filter((s) => s !== 'cancelled' && s !== 'published').join(','),
  })
  if (mine) params.set('mine', 'true')
  const query = useQuery({ queryKey: ['agency', 'content', 'list', 'dashboard', params.toString()], queryFn: () => contentApi.list(params.toString()) })
  const items = query.data?.items.slice(0, 4) ?? []

  return (
    <DashCard title="Upcoming content" viewAll="/app/calendar">
      {query.isPending ? (
        <div className="grid grid-cols-2 gap-3 px-5 pb-5 sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="aspect-[4/3] animate-pulse rounded-xl bg-surface-input" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState title="Nothing scheduled ahead">Content with a publish date shows up here.</EmptyState>
      ) : (
        <ul className="grid grid-cols-2 gap-3 px-5 pb-5 sm:grid-cols-4">
          {items.map((c) => {
            const Icon = formatIcon[c.format]
            return (
              <li key={c._id} className="min-w-0">
                <Link to={`/app/content/${c._id}`} className="group block">
                  <span className={cn('relative grid aspect-[4/3] place-items-center rounded-xl bg-gradient-to-br', platformTint[c.platform])}>
                    <Icon size={30} strokeWidth={1.5} />
                    <span className="absolute bottom-2 left-2 rounded-md bg-white/85 px-1.5 py-0.5 text-[10px] font-medium text-text-2">{platformLabel[c.platform]}</span>
                  </span>
                  <span className="mt-2 block truncate text-[13px] font-semibold group-hover:underline">{c.title}</span>
                  <span className="block truncate text-xs text-text-3">
                    {c.clientInfo?.brandName ?? formatLabel[c.format]}
                  </span>
                  <span className="block truncate text-xs text-text-3">{c.publishDate && when(c.publishDate)}</span>
                  <span className="mt-1.5 block">
                    <StatePill state={c.state} />
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </DashCard>
  )
}

