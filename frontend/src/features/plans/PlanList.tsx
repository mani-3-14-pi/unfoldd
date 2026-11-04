import { useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { CellText, DataTable, type Column } from '@/components/list/DataTable'
import { Pagination } from '@/components/list/Pagination'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/Card'
import { isManagerPlus } from '@/features/agency/roles'
import { useAgencySession } from '@/features/agency/session'
import { ClientSelect } from '@/features/planning/ClientSelect'
import { monthLabel } from '@/features/planning/months'
import { clientPickerQuery } from '@/features/planning/queries'
import { StatusTabs } from '@/features/planning/StatusTabs'
import { apiQuery, useListState } from '@/hooks/useListState'
import { errorMessage } from '@/lib/errors'
import { plural, timeAgo } from '@/lib/format'
import { PLAN_STATUSES, plansApi, type Plan } from './api'
import { planStatusLabel } from './labels'
import { PlanStatusPill } from './pills'
import { StartPlanDialog } from './StartPlanDialog'

/** P38: content plans, newest month first. With `clientId` it lists one client's plans. */
export function PlanList({ clientId }: { clientId?: string }) {
  const s = useAgencySession()
  const state = useListState()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [starting, setStarting] = useState(false)
  const clients = useQuery({ ...clientPickerQuery, enabled: !clientId })
  const brand = (id: string) => clients.data?.items.find((c) => c._id === id)?.brandName ?? ''
  const fixed = clientId ? { client: clientId } : undefined
  const canCreate = isManagerPlus(s.role)

  const query = useQuery({
    queryKey: ['agency', 'plans', 'list', apiQuery(state.params, fixed)],
    queryFn: () => plansApi.list(apiQuery(state.params, fixed)),
    placeholderData: keepPreviousData,
  })
  const data = query.data

  const columns: Column<Plan>[] = [
    {
      key: 'month',
      header: 'Plan',
      className: 'w-[32%]',
      cell: (p) => (
        <CellText
          primary={
            <Link to={`/app/plans/${p._id}`} className="hover:underline">
              {monthLabel(p.month)}
            </Link>
          }
          secondary={!clientId ? brand(p.client) : undefined}
        />
      ),
    },
    { key: 'status', header: 'Status', cell: (p) => <PlanStatusPill status={p.status} /> },
    { key: 'items', header: 'Items', cell: (p) => <span className="text-text-2">{plural(p.itemCount ?? 0, 'item')}</span> },
    {
      key: 'when',
      header: 'Last step',
      cell: (p) => (
        <span className="text-text-2">
          {p.decidedAt ? `${p.decidedBy?.name ?? 'Client'} decided ${timeAgo(p.decidedAt)}` : p.sentAt ? `Sent ${timeAgo(p.sentAt)}` : `Started ${timeAgo(p.createdAt)}`}
        </span>
      ),
    },
  ]
  const anyFilter = [...state.params.keys()].some((k) => !['page', 'pageSize', 'sort'].includes(k))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {!clientId ? <ClientSelect value={state.get('client')} onChange={(client) => state.update({ client })} allLabel="All clients" className="w-56" /> : <span />}
        {canCreate && (
          <Button variant="primary" onClick={() => setStarting(true)}>
            <Plus size={16} /> Start a plan
          </Button>
        )}
      </div>
      <StatusTabs state={state} label="Plan status" allLabel="All" options={PLAN_STATUSES.map((st) => ({ value: st, label: planStatusLabel[st] }))} />
      <DataTable
        label="Content plans"
        columns={columns}
        rows={data?.items}
        rowKey={(p) => p._id}
        loading={query.isPending}
        fetching={query.isPlaceholderData}
        onRowClick={(p) => navigate(`/app/plans/${p._id}`)}
        empty={
          query.isError ? (
            <EmptyState title="Couldn’t load plans">{errorMessage(query.error)}</EmptyState>
          ) : anyFilter ? (
            <EmptyState title="No plans here" action={<Button onClick={() => state.clear([...state.params.keys()])}>Show all plans</Button>} />
          ) : (
            <EmptyState
              title="No content plans yet"
              action={
                canCreate && (
                  <Button variant="primary" onClick={() => setStarting(true)}>
                    <Plus size={16} /> Start a plan
                  </Button>
                )
              }
            >
              Plan a month of content, then send it for the client to approve.
            </EmptyState>
          )
        }
        footer={
          data &&
          data.total > 0 && (
            <Pagination
              {...data}
              noun="plans"
              onPage={(page) => state.update({ page })}
              onPageSize={(pageSize) => state.update({ pageSize: pageSize === 25 ? null : pageSize })}
            />
          )
        }
      />
      {starting && (
        <StartPlanDialog
          clientId={clientId}
          onClose={() => setStarting(false)}
          onSaved={(id) => {
            void qc.invalidateQueries({ queryKey: ['agency', 'plans'] })
            navigate(`/app/plans/${id}`)
          }}
        />
      )}
    </div>
  )
}
