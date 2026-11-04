import { useQuery } from '@tanstack/react-query'
import { ChevronRight, LoaderCircle, Video } from 'lucide-react'
import { Link } from 'react-router'
import { EmptyState } from '@/components/ui/Card'
import { useClientSession } from '@/features/agency/session'
import { clientMeetingsApi, meetingPlatformLabel, type ClientMeeting } from '@/features/client-app/meetings/api'
import { useListState } from '@/hooks/useListState'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { formatInZone } from '@/lib/zonedTime'

/** F57/F58: upcoming meetings with a Join button, and past ones with their shared summary. */
export function ClientMeetingsPage() {
  const state = useListState()
  const when = state.get('when') === 'past' ? 'past' : 'upcoming'
  const meetings = useQuery({ queryKey: ['client', 'meetings', when], queryFn: () => clientMeetingsApi.list(when) })

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="font-serif text-[32px] leading-tight text-brand">Meetings</h1>
      </header>
      <div role="tablist" aria-label="When" className="grid grid-cols-2 rounded-xl bg-surface-input p-1">
        {(['upcoming', 'past'] as const).map((w) => (
          <button
            key={w}
            type="button"
            role="tab"
            aria-selected={when === w}
            onClick={() => state.update({ when: w === 'past' ? 'past' : null })}
            className={cn('h-10 rounded-lg text-[14px]', when === w ? 'bg-white font-semibold shadow-sm' : 'text-text-2')}
          >
            {w === 'upcoming' ? 'Upcoming' : 'Past'}
          </button>
        ))}
      </div>
      {meetings.isPending ? (
        <div className="grid place-items-center py-16 text-text-3">
          <LoaderCircle className="animate-spin" />
        </div>
      ) : meetings.isError ? (
        <EmptyState title="Couldn’t load meetings">{errorMessage(meetings.error)}</EmptyState>
      ) : meetings.data.items.length === 0 ? (
        <EmptyState title={when === 'upcoming' ? 'No meetings coming up' : 'No past meetings'}>{when === 'upcoming' ? 'Your agency schedules meetings here.' : 'Past meetings and their summaries show up here.'}</EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {meetings.data.items.map((m) => (
            <MeetingCard key={m._id} meeting={m} upcoming={when === 'upcoming'} />
          ))}
        </ul>
      )}
    </div>
  )
}

function MeetingCard({ meeting: m, upcoming }: { meeting: ClientMeeting; upcoming: boolean }) {
  const s = useClientSession()
  return (
    <li className="flex items-center gap-3 rounded-2xl border border-border bg-white p-4">
      <Link to={`/c/meetings/${m._id}`} className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold">{m.title}</span>
        <span className="mt-0.5 block text-[13px] text-text-3">
          {formatInZone(m.startAt, s.client.timezone)} · {meetingPlatformLabel[m.platform]}
        </span>
        {m.status === 'cancelled' && <span className="mt-1 block text-xs font-medium text-negative">Cancelled</span>}
        {!upcoming && m.summary && <span className="mt-1 block text-xs font-medium text-positive">Summary shared</span>}
      </Link>
      {upcoming && m.joinUrl && m.status === 'scheduled' ? (
        <a href={m.joinUrl} target="_blank" rel="noreferrer" className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-brand px-4 text-[13px] font-semibold text-white">
          <Video size={16} /> Join
        </a>
      ) : (
        <ChevronRight size={18} className="shrink-0 text-text-4" />
      )}
    </li>
  )
}
