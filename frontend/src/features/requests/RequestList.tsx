import { useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Paperclip, Plus } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { CellText, DataTable, type Column } from '@/components/list/DataTable'
import { Pagination } from '@/components/list/Pagination'
import { SearchInput } from '@/components/list/SearchInput'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/Card'
import { Pill } from '@/components/ui/Pill'
import { Switch } from '@/components/ui/Switch'
import { priorityLabel, priorityTone } from '@/features/content/labels'
import { ClientSelect } from '@/features/planning/ClientSelect'
import { clientPickerQuery } from '@/features/planning/queries'
import { StatusTabs } from '@/features/planning/StatusTabs'
import { apiQuery, useListState } from '@/hooks/useListState'
import { errorMessage } from '@/lib/errors'
import { formatDate, timeAgo } from '@/lib/format'
import { REQUEST_STATUSES, requestsApi, type ClientRequest } from './api'
import { requestStatusLabel } from './labels'
import { RequestStatusPill } from './pills'
import { RequestFormDialog } from './RequestFormDialog'

/** P90 requests hub, due date first. With `clientId` it lists one client's requests. */
export function RequestList({ clientId }: { clientId?: string }) {
  const state = useListState()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [creating, setCreating] = useState(false)
  const clients = useQuery({ ...clientPickerQuery, enabled: !clientId })
  const brand = (id: string) => clients.data?.items.find((c) => c._id === id)?.brandName ?? ''
  const fixed = clientId ? { client: clientId } : undefined

  const query = useQuery({
    queryKey: ['agency', 'requests', 'list', apiQuery(state.params, fixed)],
    queryFn: () => requestsApi.list(apiQuery(state.params, fixed)),
    placeholderData: keepPreviousData,
  })
  const data = query.data

  const columns: Column<ClientRequest>[] = [
    {
      key: 'title',
      header: 'Request',
      className: 'w-[34%]',
      cell: (r) => (
        <CellText
          primary={
            <Link to={`/app/requests/${r._id}`} className="hover:underline">
              {r.title}
            </Link>
          }
          secondary={!clientId ? brand(r.client) : r.why || undefined}
        />
      ),
    },
    { key: 'status', header: 'Status', cell: (r) => <RequestStatusPill status={r.status} overdue={r.overdue} /> },
    { key: 'due', header: 'Due', cell: (r) => <span className={r.overdue ? 'font-medium text-negative' : 'text-text-2'}>{r.due ? formatDate(r.due) : '—'}</span> },
    {
      key: 'files',
      header: 'Files',
      cell: (r) =>
        r.files.length ? (
          <span className="inline-flex items-center gap-1 text-text-2">
            <Paperclip size={13} /> {r.files.length}
          </span>
        ) : (
          <span className="text-text-4">—</span>
        ),
    },
    {
      key: 'priority',
      header: 'Priority',
      cell: (r) => (r.priority === 'normal' ? <span className="text-text-4">—</span> : <Pill tone={priorityTone[r.priority]} dot={false}>{priorityLabel[r.priority]}</Pill>),
    },
    { key: 'seen', header: 'Client opened', cell: (r) => <span className="text-text-2">{r.viewedAt ? timeAgo(r.viewedAt) : r.status === 'draft' ? '—' : 'Not yet'}</span> },
  ]
  const anyFilter = [...state.params.keys()].some((k) => !['page', 'pageSize', 'sort'].includes(k))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {!clientId && <ClientSelect value={state.get('client')} onChange={(client) => state.update({ client })} allLabel="All clients" className="w-56" />}
          <SearchInput value={state.get('q')} onChange={(q) => state.update({ q })} placeholder="Search requests…" />
          <label className="flex items-center gap-2 text-xs text-text-2">
            <Switch label="Overdue only" checked={state.get('overdue') === 'true'} onChange={(on) => state.update({ overdue: on })} />
            Overdue only
          </label>
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus size={16} /> New request
        </Button>
      </div>
      <StatusTabs state={state} label="Request status" allLabel="In progress" options={REQUEST_STATUSES.map((st) => ({ value: st, label: requestStatusLabel[st] }))} />
      <DataTable
        label="Requests"
        columns={columns}
        rows={data?.items}
        rowKey={(r) => r._id}
        loading={query.isPending}
        fetching={query.isPlaceholderData}
        onRowClick={(r) => navigate(`/app/requests/${r._id}`)}
        empty={
          query.isError ? (
            <EmptyState title="Couldn’t load requests">{errorMessage(query.error)}</EmptyState>
          ) : anyFilter ? (
            <EmptyState title="Nothing here" action={<Button onClick={() => state.clear([...state.params.keys()])}>Show requests in progress</Button>} />
          ) : (
            <EmptyState
              title="Nothing needed from clients"
              action={
                <Button variant="primary" onClick={() => setCreating(true)}>
                  <Plus size={16} /> New request
                </Button>
              }
            >
              Ask for photos, logins, approvals or answers. Clients see them in Needed From You.
            </EmptyState>
          )
        }
        footer={
          data &&
          data.total > 0 && (
            <Pagination
              {...data}
              noun="requests"
              onPage={(page) => state.update({ page })}
              onPageSize={(pageSize) => state.update({ pageSize: pageSize === 25 ? null : pageSize })}
            />
          )
        }
      />
      {creating && (
        <RequestFormDialog
          clientId={clientId}
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            void qc.invalidateQueries({ queryKey: ['agency', 'requests'] })
            navigate(`/app/requests/${id}`)
          }}
        />
      )}
    </div>
  )
}
