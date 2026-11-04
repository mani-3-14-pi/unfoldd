import { useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { CellText, DataTable, type Column } from '@/components/list/DataTable'
import type { FilterDef } from '@/components/list/filters'
import { ListToolbar } from '@/components/list/ListToolbar'
import { Pagination } from '@/components/list/Pagination'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/Card'
import { isAgencyAdmin, isManagerPlus } from '@/features/agency/roles'
import { useAgencySession } from '@/features/agency/session'
import { CLIENT_STATUSES, clientsApi, type Client } from '@/features/clients/api'
import { ClientFormDialog } from '@/features/clients/ClientFormDialog'
import { clientStatusLabel } from '@/features/clients/labels'
import { ClientStatusPill, HealthPill } from '@/features/clients/pills'
import { apiQuery, useListState } from '@/hooks/useListState'
import { errorMessage } from '@/lib/errors'
import { formatDate, initials } from '@/lib/format'
import { toast } from '@/lib/toast'

const SORTS = [
  { value: 'name', label: 'Name A–Z' },
  { value: 'name_desc', label: 'Name Z–A' },
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
]

/** P11–P13: the client directory. Managers and members see only the clients they're assigned to. */
export function ClientsPage() {
  const s = useAgencySession()
  const state = useListState()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  const admin = isAgencyAdmin(s.role)

  const query = useQuery({
    queryKey: ['agency', 'clients', 'list', apiQuery(state.params)],
    queryFn: () => clientsApi.list(apiQuery(state.params)),
    placeholderData: keepPreviousData,
  })
  const data = query.data

  // Owners and admins see every client; "mine" narrows it to the ones they're assigned to.
  const filters: FilterDef[] = admin ? [{ kind: 'toggle', key: 'mine', label: 'Only my clients', description: 'Clients you’re assigned to' }] : []

  const columns: Column<Client>[] = [
    {
      key: 'client',
      header: 'Client',
      className: 'w-[30%]',
      cell: (c) => (
        <div className="flex items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-input text-xs font-semibold text-text-3">{initials(c.brandName)}</span>
          <CellText
            primary={
              <Link to={`/app/clients/${c._id}`} className="hover:underline">
                {c.brandName}
              </Link>
            }
            secondary={c.name !== c.brandName ? c.name : c.contact.email || undefined}
          />
        </div>
      ),
    },
    { key: 'status', header: 'Status', cell: (c) => <ClientStatusPill status={c.status} /> },
    { key: 'health', header: 'Health', cell: (c) => (c.status === 'archived' ? <span className="text-text-4">—</span> : <HealthPill {...c.health} />) },
    {
      key: 'am',
      header: 'Account manager',
      cell: (c) => <span className="text-text-2">{c.accountManager?.name ?? <span className="text-amber-ink">Not assigned</span>}</span>,
    },
    { key: 'services', header: 'Services', cell: (c) => <span className="line-clamp-1 text-text-2">{c.services.join(', ') || '—'}</span> },
    { key: 'start', header: 'Client since', cell: (c) => <span className="text-text-2">{formatDate(c.startDate || c.createdAt)}</span> },
  ]

  const anyFilter = [...state.params.keys()].some((k) => !['page', 'pageSize', 'sort'].includes(k))
  const total = data ? Object.entries(data.counts).reduce((sum, [k, n]) => (k === 'archived' ? sum : sum + n), 0) : undefined

  return (
    <>
      <PageHeader
        title="Clients"
        description={admin ? 'Every brand your agency works with.' : 'The brands you’re assigned to.'}
        actions={
          isManagerPlus(s.role) && (
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus size={16} /> Add client
            </Button>
          )
        }
      />
      <div className="flex flex-col gap-4">
        <ListToolbar
          state={state}
          searchPlaceholder="Search brands, companies, contacts…"
          filters={filters}
          sorts={SORTS}
          defaultSort="name"
          total={data?.total}
          noun="client"
          tabs={{
            key: 'status',
            allLabel: 'All clients',
            allCount: total,
            options: CLIENT_STATUSES.map((st) => ({ value: st, label: clientStatusLabel[st], count: data?.counts[st] })),
          }}
        />
        <DataTable
          label="Clients"
          columns={columns}
          rows={data?.items}
          rowKey={(c) => c._id}
          loading={query.isPending}
          fetching={query.isPlaceholderData}
          onRowClick={(c) => navigate(`/app/clients/${c._id}`)}
          empty={
            query.isError ? (
              <EmptyState title="Couldn’t load clients">{errorMessage(query.error)}</EmptyState>
            ) : anyFilter ? (
              <EmptyState title="No clients match" action={<Button onClick={() => state.clear([...state.params.keys()])}>Clear filters</Button>}>
                Try a different search or status.
              </EmptyState>
            ) : isManagerPlus(s.role) ? (
              <EmptyState
                title="No clients yet"
                action={
                  <Button variant="primary" onClick={() => setAdding(true)}>
                    <Plus size={16} /> Add your first client
                  </Button>
                }
              >
                Add a brand you work with, then invite their team to review and approve content.
              </EmptyState>
            ) : (
              <EmptyState title="No clients assigned to you yet">A manager or admin can give you access to a client.</EmptyState>
            )
          }
          footer={
            data &&
            data.total > 0 && (
              <Pagination
                {...data}
                noun="clients"
                onPage={(page) => state.update({ page })}
                onPageSize={(pageSize) => state.update({ pageSize: pageSize === 25 ? null : pageSize })}
              />
            )
          }
        />
      </div>
      {adding && (
        <ClientFormDialog
          onClose={() => setAdding(false)}
          onSaved={(c) => {
            toast(`${c.brandName} added`)
            void qc.invalidateQueries({ queryKey: ['agency', 'clients'] })
            navigate(`/app/clients/${c._id}`)
          }}
        />
      )}
    </>
  )
}
