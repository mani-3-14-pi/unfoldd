import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Video } from 'lucide-react'
import { Link } from 'react-router'
import { EmptyState } from '@/components/ui/Card'
import { useClientSession } from '@/features/agency/session'
import { addDays, dateOf, daysFor, keyIn, shift, timeIn, titleFor } from '@/features/calendar/dates'
import { clientCalendarApi, type ClientCalendarEvent } from '@/features/client-app/calendar/api'
import { ClientPageHeader } from '@/features/client-app/ClientPageHeader'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'

const dot: Record<ClientCalendarEvent['layer'], string> = { content: 'bg-green-dot', meetings: 'bg-blue-dot', requests: 'bg-amber-dot' }
const LEGEND: { layer: ClientCalendarEvent['layer']; label: string }[] = [
  { layer: 'content', label: 'Posts' },
  { layer: 'meetings', label: 'Meetings' },
  { layer: 'requests', label: 'Due from you' },
]
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

/**
 * F48/F50: the month, and the day you tap expanded below it (no week view for clients, D32). Publish dates,
 * meetings and request due dates, on the brand's own clock (D59).
 */
export function ClientCalendarPage() {
  const s = useClientSession()
  const tz = s.client.timezone
  // "Today" on the client's clock, fixed for the visit.
  const [today] = useState(() => keyIn(new Date().toISOString(), tz))
  const [anchor, setAnchor] = useState(today)
  const [selected, setSelected] = useState(today)

  const days = daysFor('month', anchor)
  const from = dateOf(days[0]!).toISOString()
  const to = dateOf(addDays(days.at(-1)!, 1)).toISOString()
  const query = useQuery({ queryKey: ['client', 'calendar', from, to], queryFn: () => clientCalendarApi.range(from, to), placeholderData: keepPreviousData })
  const events = query.data?.events ?? []
  const on = (day: string) => events.filter((e) => e.date === day)
  const month = anchor.slice(0, 7)

  const move = (by: 1 | -1) => {
    const next = shift('month', anchor, by)
    setAnchor(next)
    setSelected(next.slice(0, 7) === today.slice(0, 7) ? today : `${next.slice(0, 7)}-01`)
  }

  return (
    <>
      <ClientPageHeader title="Calendar" description={`Times are in ${tz.replace(/_/g, ' ')}.`} />

      <div className="rounded-2xl border border-border bg-white p-3">
        <div className="mb-2 flex items-center justify-between">
          <button type="button" aria-label="Previous month" onClick={() => move(-1)} className="grid size-11 place-items-center rounded-xl hover:bg-black/5">
            <ChevronLeft size={20} />
          </button>
          <span className="text-[15px] font-semibold">{titleFor('month', anchor)}</span>
          <button type="button" aria-label="Next month" onClick={() => move(1)} className="grid size-11 place-items-center rounded-xl hover:bg-black/5">
            <ChevronRight size={20} />
          </button>
        </div>
        <div className="grid grid-cols-7 text-center text-[11px] font-medium text-text-4" aria-hidden="true">
          {WEEKDAYS.map((d, i) => (
            <span key={i} className="py-1">
              {d}
            </span>
          ))}
        </div>
        <div role="grid" aria-label={titleFor('month', anchor)} className={cn('grid grid-cols-7 gap-0.5 transition-opacity', query.isPlaceholderData && 'opacity-60')}>
          {days.map((day) => {
            const list = on(day)
            const layers = [...new Set(list.map((e) => e.layer))]
            return (
              <button
                key={day}
                type="button"
                role="gridcell"
                aria-selected={day === selected}
                aria-label={`${dateOf(day).toDateString()}${list.length ? `, ${list.length} item${list.length === 1 ? '' : 's'}` : ''}`}
                onClick={() => setSelected(day)}
                className={cn(
                  'flex h-12 flex-col items-center justify-center gap-1 rounded-xl text-[13px]',
                  day.slice(0, 7) !== month && 'text-text-4',
                  day === selected ? 'bg-brand text-white' : 'hover:bg-surface-input',
                )}
              >
                <span className={cn(day === today && day !== selected && 'font-bold text-brand')}>{Number(day.slice(8))}</span>
                <span className="flex h-1.5 gap-0.5">
                  {layers.map((l) => (
                    <span key={l} className={cn('size-1.5 rounded-full', day === selected ? 'bg-white' : dot[l])} />
                  ))}
                </span>
              </button>
            )
          })}
        </div>
        <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[11px] text-text-3">
          {LEGEND.map((l) => (
            <span key={l.layer} className="flex items-center gap-1.5">
              <span className={cn('size-2 rounded-full', dot[l.layer])} /> {l.label}
            </span>
          ))}
        </div>
      </div>

      <section className="mt-5">
        <h2 className="mb-2.5 text-sm font-semibold">{titleFor('day', selected)}</h2>
        {query.isError ? (
          <EmptyState title="Couldn’t load the calendar">{errorMessage(query.error)}</EmptyState>
        ) : on(selected).length === 0 ? (
          <p className="rounded-2xl border border-border bg-white px-4 py-6 text-center text-[13px] text-text-3">Nothing on this day.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {on(selected)
              .sort((a, b) => ('at' in a ? a.at : '').localeCompare('at' in b ? b.at : ''))
              .map((e) => (
                <li key={`${e.layer}-${e.id}`}>
                  <DayItem event={e} tz={tz} />
                </li>
              ))}
          </ul>
        )}
      </section>
    </>
  )
}

function DayItem({ event: e, tz }: { event: ClientCalendarEvent; tz: string }) {
  const time = e.layer === 'requests' ? 'Due' : e.layer === 'meetings' ? `${timeIn(e.at, tz)}–${timeIn(e.endAt, tz)}` : timeIn(e.at, tz)
  const detail =
    e.layer === 'content'
      ? [e.status.label, e.status.delayed && 'Publishing delayed', e.shiftedDays !== 0 && `Schedule shifted · ${Math.abs(e.shiftedDays)} day${Math.abs(e.shiftedDays) === 1 ? '' : 's'}`]
          .filter(Boolean)
          .join(' · ')
      : e.layer === 'meetings'
        ? 'Meeting'
        : e.label
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-white pr-2">
      <Link to={e.link} className="flex min-h-16 min-w-0 flex-1 items-center gap-3 rounded-2xl py-3 pl-4 hover:bg-surface">
        <span className={cn('h-10 w-1 shrink-0 rounded-full', dot[e.layer])} aria-hidden="true" />
        <span className="w-16 shrink-0 text-xs font-medium text-text-2">{time}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium">{e.title}</span>
          <span className="block truncate text-xs text-text-3">{detail}</span>
        </span>
      </Link>
      {e.layer === 'meetings' && e.joinUrl && (
        <a href={e.joinUrl} target="_blank" rel="noreferrer" className="flex h-10 items-center gap-1.5 rounded-xl bg-brand px-3 text-xs font-medium text-white">
          <Video size={14} /> Join
        </a>
      )}
    </div>
  )
}
