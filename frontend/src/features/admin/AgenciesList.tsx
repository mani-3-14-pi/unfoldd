import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { EllipsisVertical } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { CellText, DataTable, type Column } from '@/components/list/DataTable'
import type { FilterDef } from '@/components/list/filters'
import { ListToolbar, type SortOption } from '@/components/list/ListToolbar'
import { Pagination } from '@/components/list/Pagination'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/Card'
import { Menu } from '@/components/ui/Menu'
import { apiQuery, useListState } from '@/hooks/useListState'
import { errorMessage } from '@/lib/errors'
import { formatDate, timeAgo } from '@/lib/format'
import { adminApi, AGENCY_STATUSES, PLANS, SUBSCRIPTION_STATUSES, TEAM_SIZES, type Agency, type AgencyStatus } from './api'
import { useAgencyActions } from './useAgencyActions'
import { agencyStatusLabel, planLabel, subscriptionStatusLabel } from './labels'
import { AgencyStatusPill, PlanBadge } from './pills'

const SORTS: SortOption[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'name', label: 'Name A–Z' },
  { value: 'name_desc', label: 'Name Z–A' },
  { value: 'members', label: 'Most members' },
  { value: 'status_changed', label: 'Recently changed status' },
]

/**
 * Paginated, filterable agency table. With `lockedStatus` it becomes a single-status queue
 * (the Approvals page): no status tabs, oldest first, and inline approve / reject.
 */
export function AgenciesList({ lockedStatus }: { lockedStatus?: AgencyStatus }) {
  const state = useListState()
  const navigate = useNavigate()
  const actions = useAgencyActions()
  const queue = lockedStatus === 'pending'
  const defaultSort = queue ? 'oldest' : 'newest'
  const fixed: Record<string, string> = lockedStatus ? { status: lockedStatus } : {}
  if (!state.get('sort')) fixed.sort = defaultSort

  const query = useQuery({
    queryKey: ['admin', 'agencies', apiQuery(state.params, fixed)],
    queryFn: () => adminApi.agencies(apiQuery(state.params, fixed)),
    placeholderData: keepPreviousData,
  })
  const data = query.data

  const filters: FilterDef[] = [
    { kind: 'dateRange', label: 'Signed up', fromKey: 'createdFrom', toKey: 'createdTo' },
    ...(queue
      ? []
      : ([
          { kind: 'multi', key: 'plan', label: 'Plan', options: PLANS.map((p) => ({ value: p, label: planLabel[p] })) },
          {
            kind: 'multi',
            key: 'subscriptionStatus',
            label: 'Subscription',
            options: SUBSCRIPTION_STATUSES.map((s) => ({ value: s, label: subscriptionStatusLabel[s] })),
          },
        ] satisfies FilterDef[])),
    { kind: 'multi', key: 'teamSize', label: 'Team size', options: TEAM_SIZES.map((t) => ({ value: t, label: `${t} people` })) },
    { kind: 'multi', key: 'country', label: 'Country', options: (data?.facets.countries ?? []).map((c) => ({ value: c, label: c })) },
  ]

  const columns: Column<Agency>[] = [
    {
      key: 'agency',
      header: 'Agency',
      className: 'w-[26%]',
      cell: (a) => (
        <CellText
          primary={
            <Link to={`/admin/agencies/${a._id}`} className="hover:underline">
              {a.name}
            </Link>
          }
          secondary={a.email}
        />
      ),
    },
    {
      key: 'owner',
      header: 'Owner',
      cell: (a) => (a.owner ? <CellText primary={<span className="font-normal">{a.owner.name}</span>} secondary={a.owner.email} /> : '—'),
    },
    ...(lockedStatus ? [] : [{ key: 'status', header: 'Status', cell: (a: Agency) => <AgencyStatusPill status={a.status} /> }]),
    ...(queue
      ? [
          { key: 'team', header: 'Team size', cell: (a: Agency) => <span className="text-text-2">{a.teamSize || '—'}</span> },
          { key: 'country', header: 'Country', cell: (a: Agency) => <span className="text-text-2">{a.country || '—'}</span> },
        ]
      : [
          { key: 'plan', header: 'Plan', cell: (a: Agency) => <PlanBadge plan={a.subscription.plan} /> },
          { key: 'members', header: 'Members', cell: (a: Agency) => <span className="text-text-2">{a.memberCount}</span> },
          { key: 'country', header: 'Country', cell: (a: Agency) => <span className="text-text-2">{a.country || '—'}</span> },
        ]),
    {
      key: 'created',
      header: queue ? 'Waiting since' : 'Signed up',
      cell: (a) => <CellText primary={<span className="font-normal">{formatDate(a.createdAt)}</span>} secondary={timeAgo(a.createdAt)} />,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: queue ? 'w-[200px] text-right' : 'w-12 text-right',
      cell: (a) =>
        queue ? (
          <div className="flex justify-end gap-1.5">
            <Button size="sm" onClick={() => actions.run('reject', a)}>
              Reject
            </Button>
            <Button size="sm" variant="primary" onClick={() => actions.run('approve', a)}>
              Approve
            </Button>
          </div>
        ) : (
          <Menu
            label={`Actions for ${a.name}`}
            heading={a.name}
            items={actions.menuItems(a, { view: true })}
            className="grid size-8 place-items-center rounded-lg text-text-3 hover:bg-black/5"
          >
            <EllipsisVertical size={17} />
          </Menu>
        ),
    },
  ]

  const anyFilter = [...state.params.keys()].some((k) => !['page', 'pageSize', 'sort'].includes(k))

  return (
    <div className="flex flex-col gap-4">
      <ListToolbar
        state={state}
        searchPlaceholder="Search agencies, owners, emails…"
        filters={filters}
        sorts={SORTS}
        defaultSort={defaultSort}
        total={data?.total}
        noun="agency"
        tabs={
          lockedStatus
            ? undefined
            : {
                key: 'status',
                allLabel: 'All agencies',
                allCount: data ? Object.values(data.counts).reduce((a, b) => a + b, 0) : undefined,
                options: AGENCY_STATUSES.map((s) => ({
                  value: s,
                  label: s === 'pending' ? 'Pending' : agencyStatusLabel[s],
                  count: data?.counts[s],
                })),
              }
        }
      />
      <DataTable
        label="Agencies"
        columns={columns}
        rows={data?.items}
        rowKey={(a) => a._id}
        loading={query.isPending}
        fetching={query.isPlaceholderData}
        onRowClick={(a) => navigate(`/admin/agencies/${a._id}`)}
        empty={
          query.isError ? (
            <EmptyState title="Couldn’t load agencies">{errorMessage(query.error)}</EmptyState>
          ) : anyFilter ? (
            <EmptyState title="No agencies match" action={<Button onClick={() => state.clear([...state.params.keys()])}>Clear filters</Button>}>
              Try a different search or remove a filter.
            </EmptyState>
          ) : queue ? (
            <EmptyState title="You’re all caught up">No agencies are waiting for approval.</EmptyState>
          ) : (
            <EmptyState title="No agencies yet">Agencies appear here as soon as they sign up.</EmptyState>
          )
        }
        footer={
          data &&
          data.total > 0 && (
            <Pagination
              {...data}
              noun="agencies"
              onPage={(page) => state.update({ page })}
              onPageSize={(pageSize) => state.update({ pageSize: pageSize === 25 ? null : pageSize })}
            />
          )
        }
      />
      {actions.dialog}
    </div>
  )
}
