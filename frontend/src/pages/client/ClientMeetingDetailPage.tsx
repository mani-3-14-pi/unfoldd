import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ChevronRight, LoaderCircle, MapPin, Video } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { EmptyState } from '@/components/ui/Card'
import { useClientSession } from '@/features/agency/session'
import { clientMeetingsApi, meetingPlatformLabel } from '@/features/client-app/meetings/api'
import { errorMessage } from '@/lib/errors'
import { formatDate } from '@/lib/format'
import { formatInZone } from '@/lib/zonedTime'

/**
 * F59–F62: one meeting. The summary, decisions and action items appear only after the agency shares them;
 * the transcript never does (D23). The client's action items are real requests in Needed From You (D24).
 */
export function ClientMeetingDetailPage() {
  const { id = '' } = useParams()
  const s = useClientSession()
  const query = useQuery({ queryKey: ['client', 'meetings', 'detail', id], queryFn: () => clientMeetingsApi.get(id) })
  // One clock for the page, read once.
  const [now] = useState(() => Date.now())

  const back = (
    <Link to="/c/meetings" className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-text-3 hover:text-text">
      <ArrowLeft size={15} /> Meetings
    </Link>
  )
  if (query.isPending) {
    return (
      <>
        {back}
        <div className="grid place-items-center py-16 text-text-3">
          <LoaderCircle className="animate-spin" />
        </div>
      </>
    )
  }
  if (query.isError) {
    return (
      <>
        {back}
        <EmptyState title="Couldn’t open this meeting">{errorMessage(query.error)}</EmptyState>
      </>
    )
  }

  const m = query.data.meeting
  const tz = s.client.timezone
  const upcoming = m.status === 'scheduled' && new Date(m.endAt).getTime() > now
  const end = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(m.endAt))
  const agencyItems = m.summary?.actionItems.filter((a) => a.side === 'agency') ?? []
  const clientItems = m.summary?.actionItems.filter((a) => a.side === 'client') ?? []

  return (
    <div className="flex flex-col gap-5">
      <div>
        {back}
        <h1 className="font-serif text-[30px] leading-tight text-brand">{m.title}</h1>
        {m.status === 'cancelled' && <p className="mt-1 text-[13px] font-medium text-negative">This meeting was cancelled.</p>}
      </div>

      <section className="flex flex-col gap-3 rounded-2xl border border-border bg-white p-4">
        <p className="text-[15px] font-medium">
          {formatInZone(m.startAt, tz, { withViewer: false })} – {end}
        </p>
        <p className="flex items-center gap-2 text-[13px] text-text-2">
          {m.platform === 'in_person' ? <MapPin size={15} /> : <Video size={15} />}
          {meetingPlatformLabel[m.platform]}
          {m.location && ` · ${m.location}`}
        </p>
        {upcoming && m.joinUrl && (
          <a href={m.joinUrl} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-brand px-5 text-sm font-semibold text-white">
            <Video size={17} /> Join meeting
          </a>
        )}
      </section>

      {m.agenda && (
        <Block title="Agenda">
          <p className="text-[14px] whitespace-pre-line text-text-2">{m.agenda}</p>
        </Block>
      )}

      {m.summary ? (
        <>
          <Block title="Summary" note={`Shared ${formatDate(m.summary.sharedAt)}`}>
            <p className="text-[14px] whitespace-pre-line">{m.summary.text || 'No summary text.'}</p>
          </Block>
          {m.summary.decisions.length > 0 && (
            <Block title="Decisions">
              <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[14px]">
                {m.summary.decisions.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </Block>
          )}
          {clientItems.length > 0 && (
            <Block title="Needed from you">
              <ul className="flex flex-col gap-2">
                {clientItems.map((a) => (
                  <li key={a._id}>
                    {a.request ? (
                      <Link to={`/c/requests/${a.request}`} className="flex items-center gap-3 rounded-xl border border-border-strong bg-white px-4 py-3 hover:bg-surface">
                        <span className="min-w-0 flex-1">
                          <span className="block text-[14px] font-medium">{a.text}</span>
                          {a.due && <span className="block text-xs text-text-3">Due {formatDate(a.due)}</span>}
                        </span>
                        <ChevronRight size={17} className="text-text-4" />
                      </Link>
                    ) : (
                      <span className="block rounded-xl border border-border-strong px-4 py-3 text-[14px]">{a.text}</span>
                    )}
                  </li>
                ))}
              </ul>
            </Block>
          )}
          {agencyItems.length > 0 && (
            <Block title={`${s.agency.name} will`}>
              <ul className="flex flex-col divide-y divide-border">
                {agencyItems.map((a) => (
                  <li key={a._id} className="flex items-baseline gap-3 py-2 text-[14px]">
                    <span className="min-w-0 flex-1">{a.text}</span>
                    {a.due && <span className="shrink-0 text-xs text-text-3">by {formatDate(a.due)}</span>}
                  </li>
                ))}
              </ul>
            </Block>
          )}
        </>
      ) : (
        !upcoming &&
        m.status !== 'cancelled' && <p className="rounded-2xl bg-surface-input px-4 py-5 text-center text-[13px] text-text-3">The summary shows up here once {s.agency.name} shares it.</p>
      )}
    </div>
  )
}

function Block({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-white p-4">
      <h2 className="mb-2 flex items-baseline justify-between gap-3 text-[15px] font-semibold">
        {title}
        {note && <span className="text-xs font-normal text-text-4">{note}</span>}
      </h2>
      {children}
    </section>
  )
}
