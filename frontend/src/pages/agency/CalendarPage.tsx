import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Link } from 'react-router'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/Card'
import { Select } from '@/components/ui/Field'
import { useAgencySession } from '@/features/agency/session'
import { calendarApi, LAYERS, type CalendarEvent, type Layer } from '@/features/calendar/api'
import { addDays, dateOf, daysFor, keyIn, keyOf, shift, timeIn, titleFor, type View } from '@/features/calendar/dates'
import { layerClass, layerDot, layerLabel, riskOf } from '@/features/calendar/labels'
import { clientsApi } from '@/features/clients/api'
import { useListState } from '@/hooks/useListState'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'

const VIEWS: { value: View; label: string }[] = [
  { value: 'month', label: 'Month' },
  { value: 'week', label: 'Week' },
  { value: 'day', label: 'Day' },
]
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** One event placed on a day, with the time to show (in the client's timezone for timed events). */
interface Placed {
  event: CalendarEvent
  day: string
  time: string | null
}

/**
 * P94–P98: the operational calendar (D31). Publish dates, meetings, task and request due dates and plan months,
 * as layers. Week view is the agency's own (D32). Timed items sit on the client's clock (D59).
 */
export function CalendarPage() {
  const s = useAgencySession()
  const state = useListState()
  const [today] = useState(() => keyOf(new Date()))
  const view = (['month', 'week', 'day'].includes(state.get('view')) ? state.get('view') : 'month') as View
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(state.get('date')) ? state.get('date') : today
  const client = state.get('client')
  const hidden = state.getList('hide') as Layer[]
  const layers = LAYERS.filter((l) => !hidden.includes(l))

  const days = daysFor(view, anchor)
  const from = dateOf(days[0]!).toISOString()
  const to = dateOf(addDays(days.at(-1)!, 1)).toISOString()
  const params = new URLSearchParams({ from, to, layers: layers.join(',') })
  if (client) params.set('client', client)

  const clients = useQuery({ queryKey: ['agency', 'clients', 'list', 'picker'], queryFn: () => clientsApi.list('pageSize=100&sort=name') })
  const query = useQuery({
    queryKey: ['agency', 'calendar', params.toString()],
    queryFn: () => calendarApi.range(params.toString()),
    enabled: layers.length > 0,
    placeholderData: keepPreviousData,
  })

  const tzOf = (clientId: string) => clients.data?.items.find((c) => c._id === clientId)?.timezone ?? s.agency.timezone
  const placed: Placed[] = (query.data?.events ?? []).map((event) =>
    event.allDay ? { event, day: event.date, time: null } : { event, day: keyIn(event.at, tzOf(event.client.id)), time: timeIn(event.at, tzOf(event.client.id)) },
  )
  const byDay = (day: string) =>
    placed.filter((p) => p.day === day).sort((a, b) => (a.time ?? '').localeCompare(b.time ?? '') || a.event.title.localeCompare(b.event.title))

  return (
    <>
      <PageHeader title="Calendar" description="Publishing, meetings and due dates across your clients. Times are in each client’s timezone." />

      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => state.update({ date: null })}>
            Today
          </Button>
          <Button size="sm" variant="ghost" aria-label="Previous" onClick={() => state.update({ date: shift(view, anchor, -1) })}>
            <ChevronLeft size={16} />
          </Button>
          <Button size="sm" variant="ghost" aria-label="Next" onClick={() => state.update({ date: shift(view, anchor, 1) })}>
            <ChevronRight size={16} />
          </Button>
          <h2 className="ml-1 text-base font-semibold">{titleFor(view, anchor)}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select aria-label="Client" value={client} onChange={(e) => state.update({ client: e.target.value })} className="h-8 w-44 text-xs">
            <option value="">All clients</option>
            {clients.data?.items.map((c) => (
              <option key={c._id} value={c._id}>
                {c.brandName}
              </option>
            ))}
          </Select>
          <div role="tablist" aria-label="View" className="flex rounded-lg border border-border-strong bg-white p-0.5">
            {VIEWS.map((v) => (
              <button
                key={v.value}
                type="button"
                role="tab"
                aria-selected={view === v.value}
                onClick={() => state.update({ view: v.value === 'month' ? null : v.value })}
                className={cn('h-7 rounded-md px-3 text-xs', view === v.value ? 'bg-brand font-medium text-white' : 'text-text-2 hover:bg-black/5')}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5" aria-label="Layers">
        {LAYERS.map((l) => {
          const on = !hidden.includes(l)
          return (
            <button
              key={l}
              type="button"
              aria-pressed={on}
              onClick={() => state.update({ hide: on ? [...hidden, l] : hidden.filter((h) => h !== l) })}
              className={cn('flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs', on ? 'border-border-strong bg-white text-text' : 'border-transparent bg-surface-input text-text-4 line-through')}
            >
              <span className={cn('size-2 rounded-full', layerDot[l], !on && 'opacity-40')} aria-hidden="true" />
              {layerLabel[l]}
            </button>
          )
        })}
      </div>

      {query.isError ? (
        <EmptyState title="Couldn’t load the calendar">{errorMessage(query.error)}</EmptyState>
      ) : (
        <div className={cn('transition-opacity', query.isFetching && 'opacity-70')}>
          {view === 'month' && <MonthGrid days={days} anchor={anchor} today={today} byDay={byDay} onDay={(d) => state.update({ view: 'day', date: d })} />}
          {view === 'week' && <WeekColumns days={days} today={today} byDay={byDay} onDay={(d) => state.update({ view: 'day', date: d })} />}
          {view === 'day' && <DayList day={anchor} items={byDay(anchor)} />}
        </div>
      )}
    </>
  )
}

function EventChip({ placed: { event: e, time }, compact }: { placed: Placed; compact?: boolean }) {
  const risk = riskOf(e)
  return (
    <Link
      to={e.link}
      title={`${e.title} · ${e.client.brandName ?? ''}${risk ? ` · ${risk.label}` : ''}`}
      className={cn('flex min-w-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] leading-4 hover:brightness-95', layerClass[e.layer])}
    >
      {risk && <span className={cn('size-1.5 shrink-0 rounded-full', risk.tone === 'red' ? 'bg-red-dot' : 'bg-amber-dot')} aria-label={risk.label} />}
      {time && <span className="shrink-0 font-medium">{time}</span>}
      <span className="truncate">{e.title}</span>
      {!compact && e.client.brandName && <span className="ml-auto shrink-0 opacity-70">{e.client.brandName}</span>}
    </Link>
  )
}

function MonthGrid({ days, anchor, today, byDay, onDay }: { days: string[]; anchor: string; today: string; byDay: (d: string) => Placed[]; onDay: (d: string) => void }) {
  const month = anchor.slice(0, 7)
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <div className="grid min-w-[760px] grid-cols-7">
        {WEEKDAYS.map((w) => (
          <div key={w} className="border-b border-border px-2 py-2 text-[11px] font-medium text-text-3">
            {w}
          </div>
        ))}
        {days.map((d, i) => {
          const items = byDay(d)
          return (
            <div key={d} className={cn('flex min-h-28 flex-col gap-1 border-border p-1.5', i % 7 !== 6 && 'border-r', i < days.length - 7 && 'border-b', d.slice(0, 7) !== month && 'bg-surface-input/50')}>
              <button
                type="button"
                onClick={() => onDay(d)}
                className={cn(
                  'grid size-6 place-items-center self-start rounded-full text-xs',
                  d === today ? 'bg-brand font-semibold text-white' : d.slice(0, 7) === month ? 'text-text hover:bg-black/5' : 'text-text-4 hover:bg-black/5',
                )}
                aria-label={`Open ${d}`}
              >
                {Number(d.slice(8))}
              </button>
              {items.slice(0, 3).map((p) => (
                <EventChip key={`${p.event.layer}-${p.event.id}`} placed={p} compact />
              ))}
              {items.length > 3 && (
                <button type="button" onClick={() => onDay(d)} className="self-start px-1 text-[11px] text-text-3 hover:underline">
                  +{items.length - 3} more
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function WeekColumns({ days, today, byDay, onDay }: { days: string[]; today: string; byDay: (d: string) => Placed[]; onDay: (d: string) => void }) {
  const fmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric' })
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <div className="grid min-w-[900px] grid-cols-7">
        {days.map((d, i) => (
          <div key={d} className={cn('flex min-h-96 flex-col', i < 6 && 'border-r border-border')}>
            <button type="button" onClick={() => onDay(d)} className={cn('border-b border-border px-2 py-2 text-left text-xs hover:bg-black/3', d === today ? 'font-semibold text-brand' : 'text-text-2')}>
              {fmt.format(dateOf(d))}
            </button>
            <div className="flex flex-col gap-1 p-1.5">
              {byDay(d).map((p) => (
                <EventChip key={`${p.event.layer}-${p.event.id}`} placed={p} compact />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function DayList({ day, items }: { day: string; items: Placed[] }) {
  const allDay = items.filter((p) => !p.time)
  const timed = items.filter((p) => p.time)
  if (!items.length) return <EmptyState title="Nothing on this day">No publishing, meetings or due dates.</EmptyState>
  return (
    <div className="flex max-w-3xl flex-col gap-4" aria-label={day}>
      {allDay.length > 0 && (
        <section className="rounded-xl border border-border bg-surface p-3">
          <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-text-3 uppercase">Due today</h3>
          <div className="flex flex-col gap-1.5">
            {allDay.map((p) => (
              <EventChip key={`${p.event.layer}-${p.event.id}`} placed={p} />
            ))}
          </div>
        </section>
      )}
      {timed.length > 0 && (
        <section className="rounded-xl border border-border bg-surface p-3">
          <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-text-3 uppercase">Scheduled</h3>
          <div className="flex flex-col gap-1.5">
            {timed.map((p) => {
              const risk = riskOf(p.event)
              return (
                <div key={`${p.event.layer}-${p.event.id}`} className="flex flex-col gap-0.5">
                  <EventChip placed={p} />
                  {risk && <span className={cn('pl-2 text-[11px]', risk.tone === 'red' ? 'text-red-ink' : 'text-amber-ink')}>{risk.label}</span>}
                </div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
