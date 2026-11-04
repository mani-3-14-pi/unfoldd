import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Pencil } from 'lucide-react'
import { Link } from 'react-router'
import { CellText, DataTable, type Column } from '@/components/list/DataTable'
import type { FilterDef } from '@/components/list/filters'
import { ListToolbar } from '@/components/list/ListToolbar'
import { Pagination } from '@/components/list/Pagination'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/Card'
import { adminApi, AGENCY_STATUSES, PLANS, SUBSCRIPTION_STATUSES, type SubscriptionRow } from '@/features/admin/api'
import { agencyStatusLabel, planLabel, subscriptionStatusLabel } from '@/features/admin/labels'
import { AgencyStatusPill, PlanBadge, SubscriptionStatusPill } from '@/features/admin/pills'
import { SubscriptionDialog } from '@/features/admin/SubscriptionDialog'
import { apiQuery, useListState } from '@/hooks/useListState'
import { errorMessage } from '@/lib/errors'
import { formatDate, timeAgo } from '@/lib/format'

const SORTS = [
  { value: 'renews_soon', label: 'Renews soonest' },
  { value: 'renews_late', label: 'Renews latest' },
  { value: 'newest', label: 'Started most recently' },
  { value: 'name', label: 'Agency A–Z' },
  { value: 'seats', label: 'Most seats' },
]

export function SubscriptionsPage() {
  const state = useListState()
  const [editing, setEditing] = useState<SubscriptionRow | null>(null)
  const query = useQuery({
    queryKey: ['admin', 'subscriptions', apiQuery(state.params)],
    queryFn: () => adminApi.subscriptions(apiQuery(state.params)),
    placeholderData: keepPreviousData,
  })
  const data = query.data

  const filters: FilterDef[] = [
    { kind: 'multi', key: 'plan', label: 'Plan', options: PLANS.map((p) => ({ value: p, label: planLabel[p], count: data?.summary.byPlan[p] })) },
    {
      kind: 'multi',
      key: 'agencyStatus',
      label: 'Agency status',
      options: AGENCY_STATUSES.map((s) => ({ value: s, label: agencyStatusLabel[s] })),
    },
    { kind: 'dateRange', label: 'Renews', fromKey: 'renewsFrom', toKey: 'renewsTo' },
  ]

  const columns: Column<SubscriptionRow>[] = [
    {
      key: 'agency',
      header: 'Agency',
      className: 'w-[28%]',
      cell: (r) => (
        <CellText
          primary={
            <Link to={`/admin/agencies/${r._id}/subscription`} className="hover:underline">
              {r.name}
            </Link>
          }
          secondary={r.email}
        />
      ),
    },
    { key: 'agencyStatus', header: 'Agency status', cell: (r) => <AgencyStatusPill status={r.status} /> },
    { key: 'plan', header: 'Plan', cell: (r) => <PlanBadge plan={r.subscription.plan} /> },
    { key: 'status', header: 'Subscription', cell: (r) => <SubscriptionStatusPill status={r.subscription.status} /> },
    { key: 'seats', header: 'Seats', cell: (r) => <span className="text-text-2">{r.subscription.seats}</span> },
    { key: 'started', header: 'Started', cell: (r) => <span className="text-text-2">{formatDate(r.subscription.startedAt)}</span> },
    {
      key: 'renews',
      header: 'Renews',
      cell: (r) =>
        r.subscription.renewsAt ? (
          <CellText primary={<span className="font-normal">{formatDate(r.subscription.renewsAt)}</span>} secondary={timeAgo(r.subscription.renewsAt)} />
        ) : (
          '—'
        ),
    },
    {
      key: 'edit',
      header: <span className="sr-only">Edit</span>,
      className: 'w-14 text-right',
      cell: (r) => (
        <button
          type="button"
          aria-label={`Edit ${r.name}’s subscription`}
          onClick={() => setEditing(r)}
          className="grid size-8 place-items-center rounded-lg text-text-3 hover:bg-black/5"
        >
          <Pencil size={15} />
        </button>
      ),
    },
  ]

  const anyFilter = [...state.params.keys()].some((k) => !['page', 'pageSize', 'sort'].includes(k))

  return (
    <>
      <PageHeader title="Subscriptions" description="Plans and renewal dates for active and suspended agencies." />
      <p className="mb-5 rounded-lg border border-amber-soft bg-[#fdf8f1] px-4 py-3 text-[13px] text-amber-ink">
        Billing isn’t connected yet. These are placeholder records you can edit by hand; nothing is charged, renewed or enforced
        automatically.
      </p>
      <div className="flex flex-col gap-4">
        <ListToolbar
          state={state}
          searchPlaceholder="Search agencies…"
          filters={filters}
          sorts={SORTS}
          defaultSort="renews_soon"
          total={data?.total}
          noun="subscription"
          tabs={{
            key: 'status',
            allLabel: 'All',
            allCount: data ? Object.values(data.summary.byStatus).reduce((a, b) => a + b, 0) : undefined,
            options: SUBSCRIPTION_STATUSES.map((s) => ({ value: s, label: subscriptionStatusLabel[s], count: data?.summary.byStatus[s] })),
          }}
        />
        <DataTable
          label="Subscriptions"
          columns={columns}
          rows={data?.items}
          rowKey={(r) => r._id}
          loading={query.isPending}
          fetching={query.isPlaceholderData}
          onRowClick={setEditing}
          empty={
            query.isError ? (
              <EmptyState title="Couldn’t load subscriptions">{errorMessage(query.error)}</EmptyState>
            ) : anyFilter ? (
              <EmptyState title="No subscriptions match" action={<Button onClick={() => state.clear([...state.params.keys()])}>Clear filters</Button>} />
            ) : (
              <EmptyState title="No subscriptions yet">They start when an agency is approved.</EmptyState>
            )
          }
          footer={
            data &&
            data.total > 0 && (
              <Pagination
                {...data}
                noun="subscriptions"
                onPage={(page) => state.update({ page })}
                onPageSize={(pageSize) => state.update({ pageSize: pageSize === 25 ? null : pageSize })}
              />
            )
          }
        />
      </div>
      {editing && <SubscriptionDialog agency={editing} onClose={() => setEditing(null)} />}
    </>
  )
}
