import { useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarPlus } from 'lucide-react'
import { useNavigate } from 'react-router'
import { CellText, DataTable, type Column } from '@/components/list/DataTable'
import { Pagination } from '@/components/list/Pagination'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/Card'
import { Select } from '@/components/ui/Field'
import { Pill } from '@/components/ui/Pill'
import { clientsApi, type ClientDetail } from '@/features/clients/api'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { formatInZone } from '@/lib/zonedTime'
import { meetingsApi, type Meeting } from './api'
import { meetingPlatformLabel } from './labels'
import { MeetingFormDialog } from './MeetingFormDialog'
import { MeetingStatusPill } from './pills'

type When = 'upcoming' | 'past'

/** P103 meetings, upcoming first. With `client` it lists one client's meetings. */
export function MeetingList({ client, canCreate = true }: { client?: ClientDetail; canCreate?: boolean }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [when, setWhen] = useState<When>('upcoming')
  const [clientFilter, setClientFilter] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [creating, setCreating] = useState(false)
  // One "now" per mount: the split between upcoming and past shouldn't move between renders.
  const [now] = useState(() => new Date().toISOString())
  const clientId = client?._id ?? clientFilter

  const clients = useQuery({ queryKey: ['agency', 'clients', 'list', 'picker'], queryFn: () => clientsApi.list('pageSize=100&sort=name'), enabled: !client })
  const clientOf = (id: string) => (client?._id === id ? client : clients.data?.items.find((c) => c._id === id))

  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
  if (clientId) params.set('client', clientId)
  if (when === 'upcoming') {
    params.set('status', 'scheduled')
    params.set('from', now)
  } else params.set('to', now)
  const query = useQuery({
    queryKey: ['agency', 'meetings', 'list', params.toString()],
    queryFn: () => meetingsApi.list(params.toString()),
    placeholderData: keepPreviousData,
  })
  const data = query.data
  // The API sorts oldest first; the past reads better newest first.
  const rows = when === 'past' ? [...(data?.items ?? [])].reverse() : data?.items

  const columns: Column<Meeting>[] = [
    {
      key: 'when',
      header: 'When',
      className: 'w-[24%]',
      cell: (m) => {
        const tz = clientOf(m.client)?.timezone ?? 'UTC'
        return <CellText primary={<span className="font-normal">{formatInZone(m.startAt, tz, { withViewer: false })}</span>} secondary={meetingPlatformLabel[m.platform]} />
      },
    },
    { key: 'title', header: 'Meeting', cell: (m) => <CellText primary={m.title} secondary={client ? undefined : clientOf(m.client)?.brandName} /> },
    { key: 'status', header: 'Status', cell: (m) => <MeetingStatusPill status={m.status} /> },
    {
      key: 'summary',
      header: 'Summary',
      cell: (m) =>
        m.summary.status === 'shared' ? <Pill tone="green">Shared</Pill> : m.status === 'completed' ? <Pill tone="amber">To write</Pill> : <span className="text-text-4">—</span>,
    },
    { key: 'people', header: 'People', cell: (m) => <span className="text-text-2">{m.participants.agency.length + m.participants.client.length}</span> },
  ]

  const tab = (value: When, label: string) => (
    <button
      key={value}
      type="button"
      role="tab"
      aria-selected={when === value}
      onClick={() => {
        setWhen(value)
        setPage(1)
      }}
      className={cn('h-9 rounded-full px-3.5 text-xs', when === value ? 'bg-white font-medium shadow-sm ring-1 ring-border-strong' : 'text-[#2d2c34] hover:bg-black/4')}
    >
      {label}
    </button>
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div role="tablist" aria-label="When" className="flex gap-1">
            {tab('upcoming', 'Upcoming')}
            {tab('past', 'Past')}
          </div>
          {!client && (
            <Select
              aria-label="Client"
              value={clientFilter}
              onChange={(e) => {
                setClientFilter(e.target.value)
                setPage(1)
              }}
              className="w-48"
            >
              <option value="">All clients</option>
              {clients.data?.items.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.brandName}
                </option>
              ))}
            </Select>
          )}
        </div>
        {canCreate && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            <CalendarPlus size={16} /> Schedule meeting
          </Button>
        )}
      </div>
      <DataTable
        label="Meetings"
        columns={columns}
        rows={rows}
        rowKey={(m) => m._id}
        loading={query.isPending}
        fetching={query.isPlaceholderData}
        onRowClick={(m) => navigate(`/app/meetings/${m._id}`)}
        empty={
          query.isError ? (
            <EmptyState title="Couldn’t load meetings">{errorMessage(query.error)}</EmptyState>
          ) : (
            <EmptyState title={when === 'upcoming' ? 'No meetings coming up' : 'No past meetings'}>
              {when === 'upcoming' ? 'Schedule one, and the client sees it with a Join button.' : 'Meetings show up here once they’ve happened.'}
            </EmptyState>
          )
        }
        footer={
          data &&
          data.total > 0 && (
            <Pagination
              {...data}
              noun="meetings"
              onPage={setPage}
              onPageSize={(s) => {
                setPageSize(s)
                setPage(1)
              }}
            />
          )
        }
      />
      {creating && (
        <MeetingFormDialog
          clientId={client?._id}
          timezone={client?.timezone}
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            void qc.invalidateQueries({ queryKey: ['agency', 'meetings'] })
            navigate(`/app/meetings/${id}`)
          }}
        />
      )}
    </div>
  )
}

/** A client's meetings, for the client page. */
export function ClientMeetings({ client }: { client: ClientDetail }) {
  return <MeetingList client={client} canCreate={client.status !== 'archived'} />
}
