import { useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { CellText, DataTable, type Column } from '@/components/list/DataTable'
import { Pagination } from '@/components/list/Pagination'
import { SearchInput } from '@/components/list/SearchInput'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/Card'
import { isManagerPlus } from '@/features/agency/roles'
import { useAgencySession } from '@/features/agency/session'
import { platformLabel } from '@/features/content/labels'
import { ClientSelect } from '@/features/planning/ClientSelect'
import { clientPickerQuery } from '@/features/planning/queries'
import { StatusTabs } from '@/features/planning/StatusTabs'
import { apiQuery, useListState } from '@/hooks/useListState'
import { errorMessage } from '@/lib/errors'
import { formatDate } from '@/lib/format'
import { CAMPAIGN_STATUSES, campaignsApi, type Campaign } from './api'
import { CampaignFormDialog } from './CampaignFormDialog'
import { campaignStatusLabel } from './labels'
import { CampaignStatusPill, ProgressBar } from './pills'

const dates = (c: Campaign) => (c.startDate || c.endDate ? `${formatDate(c.startDate || null)} – ${formatDate(c.endDate || null)}` : 'No dates')

/** P32 campaign hub. With `clientId` it lists one client's campaigns (and the client filter goes away). */
export function CampaignList({ clientId }: { clientId?: string }) {
  const s = useAgencySession()
  const state = useListState()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [creating, setCreating] = useState(false)
  const clients = useQuery({ ...clientPickerQuery, enabled: !clientId })
  const brand = (id: string) => clients.data?.items.find((c) => c._id === id)?.brandName ?? ''
  const fixed = clientId ? { client: clientId } : undefined
  const canCreate = isManagerPlus(s.role)

  const query = useQuery({
    queryKey: ['agency', 'campaigns', 'list', apiQuery(state.params, fixed)],
    queryFn: () => campaignsApi.list(apiQuery(state.params, fixed)),
    placeholderData: keepPreviousData,
  })
  const data = query.data

  const columns: Column<Campaign>[] = [
    {
      key: 'name',
      header: 'Campaign',
      className: 'w-[30%]',
      cell: (c) => (
        <CellText
          primary={
            <Link to={`/app/campaigns/${c._id}`} className="hover:underline">
              {c.name}
            </Link>
          }
          secondary={[!clientId && brand(c.client), c.platforms.map((p) => platformLabel[p]).join(', ')].filter(Boolean).join(' · ') || undefined}
        />
      ),
    },
    { key: 'status', header: 'Status', cell: (c) => <CampaignStatusPill status={c.status} /> },
    { key: 'dates', header: 'Dates', cell: (c) => <span className="text-text-2">{dates(c)}</span> },
    { key: 'progress', header: 'Progress', className: 'w-[24%]', cell: (c) => <ProgressBar progress={c.progress} /> },
  ]

  const anyFilter = [...state.params.keys()].some((k) => !['page', 'pageSize', 'sort'].includes(k))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {!clientId ? (
          <ClientSelect value={state.get('client')} onChange={(client) => state.update({ client })} allLabel="All clients" className="w-56" />
        ) : (
          <span />
        )}
        {canCreate && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus size={16} /> New campaign
          </Button>
        )}
      </div>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <StatusTabs state={state} label="Campaign status" allLabel="Current" options={CAMPAIGN_STATUSES.map((st) => ({ value: st, label: campaignStatusLabel[st] }))} />
        <SearchInput value={state.get('q')} onChange={(q) => state.update({ q })} placeholder="Search campaigns…" />
      </div>
      <DataTable
        label="Campaigns"
        columns={columns}
        rows={data?.items}
        rowKey={(c) => c._id}
        loading={query.isPending}
        fetching={query.isPlaceholderData}
        onRowClick={(c) => navigate(`/app/campaigns/${c._id}`)}
        empty={
          query.isError ? (
            <EmptyState title="Couldn’t load campaigns">{errorMessage(query.error)}</EmptyState>
          ) : anyFilter ? (
            <EmptyState title="No campaigns here" action={<Button onClick={() => state.clear([...state.params.keys()])}>Show current campaigns</Button>} />
          ) : (
            <EmptyState
              title="No campaigns yet"
              action={
                canCreate && (
                  <Button variant="primary" onClick={() => setCreating(true)}>
                    <Plus size={16} /> New campaign
                  </Button>
                )
              }
            >
              A campaign groups content under one objective, with dates and a brief.
            </EmptyState>
          )
        }
        footer={
          data &&
          data.total > 0 && (
            <Pagination
              {...data}
              noun="campaigns"
              onPage={(page) => state.update({ page })}
              onPageSize={(pageSize) => state.update({ pageSize: pageSize === 25 ? null : pageSize })}
            />
          )
        }
      />
      {creating && (
        <CampaignFormDialog
          clientId={clientId}
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            void qc.invalidateQueries({ queryKey: ['agency', 'campaigns'] })
            navigate(`/app/campaigns/${id}`)
          }}
        />
      )}
    </div>
  )
}
