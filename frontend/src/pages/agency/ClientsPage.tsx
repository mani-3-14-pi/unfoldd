import { useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, Plus, Rocket, TriangleAlert, Users } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { CellText, DataTable, type Column } from '@/components/list/DataTable'
import type { FilterDef } from '@/components/list/filters'
import { ListToolbar } from '@/components/list/ListToolbar'
import { Pagination } from '@/components/list/Pagination'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/Button'
import { EmptyState, StatCard } from '@/components/ui/Card'
import { isAgencyAdmin, isManagerPlus } from '@/features/agency/roles'
import { useAgencySession } from '@/features/agency/session'
import { CLIENT_STATUSES, clientsApi, type Client } from '@/features/clients/api'
import { ClientFormDialog } from '@/features/clients/ClientFormDialog'
import { ClientLogo } from '@/features/clients/ClientLogo'
import { clientStatusLabel } from '@/features/clients/labels'
import { ClientStatusPill, HealthPill } from '@/features/clients/pills'
import { dashboardApi, dashboardKey } from '@/features/dashboard/api'
import { meetingsApi, type Meeting } from '@/features/meetings/api'
import { apiQuery, useListState } from '@/hooks/useListState'
import { errorMessage } from '@/lib/errors'
import { formatDate } from '@/lib/format'
import { toast } from '@/lib/toast'

const SORTS = [
  { value: 'name', label: 'Name A–Z' },
  { value: 'name_desc', label: 'Name Z–A' },
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
]

const shortDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })

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
  // The cards above the list ignore its search and tabs: a lightweight list for the status counts,
  // and the dashboard (shared cache) for health across every client, not just this page.
  const summary = useQuery({ queryKey: ['agency', 'clients', 'list', 'summary'], queryFn: () => clientsApi.list('pageSize=10') })
  const dashboard = useQuery({ queryKey: dashboardKey(false), queryFn: () => dashboardApi.get(false) })
  // One "now" per mount, so the query key doesn't change on every render.
  const [now] = useState(() => new Date().toISOString())
  const meetings = useQuery({
    queryKey: ['agency', 'meetings', 'list', 'clients-next', now],
    queryFn: () => meetingsApi.list(new URLSearchParams({ status: 'scheduled', from: now, pageSize: '100' }).toString()),
  })
  // Meetings come back soonest first, so the first one per client is its next meeting.
  const nextMeeting = new Map<string, Meeting>()
  for (const m of meetings.data?.items ?? []) if (!nextMeeting.has(m.client)) nextMeeting.set(m.client, m)

  // Owners and admins see every client; "mine" narrows it to the ones they're assigned to.
  const filters: FilterDef[] = admin ? [{ kind: 'toggle', key: 'mine', label: 'Only my clients', description: 'Clients you’re assigned to' }] : []

  const columns: Column<Client>[] = [
    {
      key: 'client',
      header: 'Client',
      className: 'w-[30%]',
      cell: (c) => (
        <div className="flex items-center gap-3">
          <ClientLogo id={c._id} name={c.brandName} />
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
    {
      key: 'meeting',
      header: 'Next meeting',
      cell: (c) => {
        const m = nextMeeting.get(c._id)
        if (m) return <CellText primary={shortDate.format(new Date(m.startAt))} secondary={m.title} />
        return <span className="text-text-4">{meetings.isPending ? '' : 'None booked'}</span>
      },
    },
    { key: 'start', header: 'Client since', cell: (c) => <span className="text-text-2">{formatDate(c.startDate || c.createdAt)}</span> },
  ]

  const anyFilter = [...state.params.keys()].some((k) => !['page', 'pageSize', 'sort'].includes(k))
  const counts = summary.data?.counts
  const liveClients = counts ? Object.entries(counts).reduce((sum, [k, n]) => (k === 'archived' ? sum : sum + n), 0) : undefined
  const needingAttention = dashboard.data?.clients.filter((c) => c.status !== 'archived' && c.health !== 'on_track').length
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
        <section aria-label="Client summary" className="mb-2 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Total clients" value={liveClients ?? '–'} icon={Users} tone="green" note={counts && `${counts.active} active`} />
          <StatCard label="Onboarding" value={counts?.onboarding ?? '–'} icon={Rocket} tone="indigo" note="getting set up" />
          <StatCard
            label="Needing attention"
            value={needingAttention ?? '–'}
            icon={TriangleAlert}
            tone={needingAttention ? 'amber' : 'gray'}
            note={needingAttention ? 'at risk or blocked' : 'all on track'}
          />
          <StatCard label="Upcoming meetings" value={meetings.data?.total ?? '–'} icon={CalendarDays} tone="blue" note="booked ahead" to="/app/meetings" />
        </section>
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
