import { useState, type ReactNode } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { LifeBuoy } from 'lucide-react'
import { Link } from 'react-router'
import { CellText, DataTable, type Column } from '@/components/list/DataTable'
import type { FilterChip, FilterDef } from '@/components/list/filters'
import { ListToolbar } from '@/components/list/ListToolbar'
import { Pagination } from '@/components/list/Pagination'
import { SearchInput } from '@/components/list/SearchInput'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/Card'
import { Dialog } from '@/components/ui/Dialog'
import { apiQuery, useListState, type ListState } from '@/hooks/useListState'
import { errorMessage } from '@/lib/errors'
import { formatDateTime, timeAgo } from '@/lib/format'
import { ACTOR_TYPES, adminApi, type Activity } from './api'
import { actionLabel, actorTypeLabel } from './labels'

const SORTS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
]

/** The audit log, paginated and filterable. With `agencyId` it shows one agency's activity. */
export function ActivityList({ agencyId }: { agencyId?: string }) {
  const state = useListState()
  const [open, setOpen] = useState<Activity | null>(null)
  const fixed = agencyId ? { agency: agencyId } : undefined

  const query = useQuery({
    queryKey: ['admin', 'activity', apiQuery(state.params, fixed)],
    queryFn: () => adminApi.activity(apiQuery(state.params, fixed)),
    placeholderData: keepPreviousData,
  })
  const data = query.data

  const filters: FilterDef[] = [
    { kind: 'dateRange', label: 'Date', fromKey: 'from', toKey: 'to' },
    { kind: 'multi', key: 'action', label: 'Action', options: (data?.facets.actions ?? []).map((a) => ({ value: a, label: actionLabel(a) })) },
    { kind: 'multi', key: 'actorType', label: 'Done by', options: ACTOR_TYPES.map((t) => ({ value: t, label: actorTypeLabel[t] })) },
    { kind: 'toggle', key: 'supportOnly', label: 'Support views only', description: 'Platform admins in an agency’s portal' },
  ]

  const selectedAgency = !agencyId && state.get('agency')
  const extraChips: FilterChip[] = selectedAgency
    ? [{ id: 'agency', facet: 'Agency', label: data?.facets.agency?.name ?? '…', remove: () => state.update({ agency: null }) }]
    : []

  const columns: Column<Activity>[] = [
    {
      key: 'when',
      header: 'When',
      className: 'w-[170px]',
      cell: (a) => <CellText primary={<span className="font-normal">{timeAgo(a.createdAt)}</span>} secondary={formatDateTime(a.createdAt)} />,
    },
    {
      key: 'actor',
      header: 'Done by',
      className: 'w-[190px]',
      cell: (a) => (
        <CellText
          primary={a.actor.name ?? actorTypeLabel[a.actor.type]}
          secondary={
            a.impersonator ? (
              <span className="inline-flex items-center gap-1 text-amber-ink">
                <LifeBuoy size={12} /> via support · {a.impersonator.name}
              </span>
            ) : (
              actorTypeLabel[a.actor.type]
            )
          }
        />
      ),
    },
    {
      key: 'what',
      header: 'Activity',
      cell: (a) => <CellText primary={actionLabel(a.action)} secondary={<span className="whitespace-normal">{a.message}</span>} />,
    },
    ...(agencyId
      ? []
      : [
          {
            key: 'agency',
            header: 'Agency',
            className: 'w-[180px]',
            cell: (a: Activity) =>
              a.agency ? (
                <Link to={`/admin/agencies/${a.agency._id}`} className="text-[13px] text-text hover:underline">
                  {a.agency.name}
                </Link>
              ) : (
                <span className="text-text-4">Platform</span>
              ),
          },
        ]),
    { key: 'ip', header: 'IP address', className: 'w-[130px]', cell: (a) => <span className="font-mono text-xs text-text-3">{a.ip ?? '—'}</span> },
  ]

  const anyFilter = [...state.params.keys()].some((k) => !['page', 'pageSize', 'sort'].includes(k))

  return (
    <div className="flex flex-col gap-4">
      <ListToolbar
        state={state}
        searchPlaceholder="Search messages, people, IPs…"
        filters={filters}
        sorts={SORTS}
        defaultSort="newest"
        total={data?.total}
        noun="entry"
        extraFilter={agencyId ? undefined : <AgencyPicker state={state} />}
        extraChips={extraChips}
      />
      <DataTable
        label="Activity log"
        columns={columns}
        rows={data?.items}
        rowKey={(a) => a._id}
        loading={query.isPending}
        fetching={query.isPlaceholderData}
        onRowClick={setOpen}
        empty={
          query.isError ? (
            <EmptyState title="Couldn’t load activity">{errorMessage(query.error)}</EmptyState>
          ) : anyFilter ? (
            <EmptyState title="No activity matches" action={<Button onClick={() => state.clear([...state.params.keys()])}>Clear filters</Button>}>
              Try a wider date range or remove a filter.
            </EmptyState>
          ) : (
            <EmptyState title="No activity yet" />
          )
        }
        footer={
          data &&
          data.total > 0 && (
            <Pagination
              {...data}
              noun="entries"
              onPage={(page) => state.update({ page })}
              onPageSize={(pageSize) => state.update({ pageSize: pageSize === 25 ? null : pageSize })}
            />
          )
        }
      />
      {open && <ActivityDialog activity={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

/** Search-as-you-type agency filter inside the filter panel. */
function AgencyPicker({ state }: { state: ListState }) {
  const [q, setQ] = useState('')
  const results = useQuery({
    queryKey: ['admin', 'agencies', 'picker', q],
    queryFn: () => adminApi.agencies(new URLSearchParams({ q, pageSize: '10', sort: 'name' }).toString()),
    enabled: q.length > 0,
  })
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] font-semibold tracking-wide text-text-3 uppercase">Agency</span>
      <SearchInput value={q} onChange={setQ} placeholder="Find an agency…" />
      {q && (
        <ul className="flex max-h-48 flex-col overflow-y-auto">
          {results.data?.items.map((a) => (
            <li key={a._id}>
              <button
                type="button"
                onClick={() => state.update({ agency: a._id })}
                className="flex h-8 w-full items-center rounded-md px-1 text-left text-[13px] hover:bg-surface-input"
              >
                {a.name}
              </button>
            </li>
          ))}
          {results.data?.items.length === 0 && <li className="px-1 text-xs text-text-4">No agencies found.</li>}
        </ul>
      )}
    </div>
  )
}

function ActivityDialog({ activity: a, onClose }: { activity: Activity; onClose: () => void }) {
  const rows: { label: string; value: ReactNode }[] = [
    { label: 'Action', value: <code className="text-xs">{a.action}</code> },
    { label: 'When', value: formatDateTime(a.createdAt) },
    { label: 'Done by', value: `${a.actor.name ?? '—'} (${actorTypeLabel[a.actor.type]})` },
    ...(a.impersonator ? [{ label: 'Support view by', value: a.impersonator.name }] : []),
    { label: 'Agency', value: a.agency ? <Link to={`/admin/agencies/${a.agency._id}`} className="underline" onClick={onClose}>{a.agency.name}</Link> : 'Platform' },
    { label: 'IP address', value: a.ip ?? '—' },
    { label: 'Browser', value: <span className="break-all">{a.userAgent ?? '—'}</span> },
  ]
  return (
    <Dialog title={actionLabel(a.action)} description={a.message} onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
      <dl className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-2 text-[13px]">
        {rows.map(({ label, value }) => (
          <div key={label} className="contents">
            <dt className="text-text-3">{label}</dt>
            <dd className="min-w-0">{value}</dd>
          </div>
        ))}
      </dl>
      {a.meta && (
        <>
          <h3 className="mt-4 mb-1.5 text-xs font-semibold text-text-3">Details</h3>
          <pre className="max-h-64 overflow-auto rounded-lg bg-surface-input p-3 text-xs">{JSON.stringify(a.meta, null, 2)}</pre>
        </>
      )}
    </Dialog>
  )
}
