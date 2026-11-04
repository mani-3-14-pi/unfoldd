import { useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { CellText, DataTable, type Column } from '@/components/list/DataTable'
import type { FilterDef } from '@/components/list/filters'
import { ListToolbar } from '@/components/list/ListToolbar'
import { Pagination } from '@/components/list/Pagination'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/Card'
import { Pill } from '@/components/ui/Pill'
import { apiQuery, useListState } from '@/hooks/useListState'
import { errorMessage } from '@/lib/errors'
import { formatDate, timeAgo } from '@/lib/format'
import { CONTENT_STATES, contentApi, PLATFORMS, type ContentRow, type ContentState } from './api'
import { ContentFormDialog } from './ContentFormDialog'
import { formatLabel, platformLabel, priorityLabel, priorityTone, versionLabel } from './labels'
import { ApprovalPill, StatePill } from './pills'

const SORTS = [
  { value: 'updated', label: 'Recently updated' },
  { value: 'newest', label: 'Newest first' },
  { value: 'publish_date', label: 'Publish date' },
  { value: 'due', label: 'Deadline' },
  { value: 'title', label: 'Title A–Z' },
]

/** The tabs: where work is, grouped the way the agency thinks about it. */
const TABS: { value: string; label: string; states: ContentState[] }[] = [
  { value: 'planned,in_production', label: 'In production', states: ['planned', 'in_production'] },
  { value: 'internal_review,ready_for_client', label: 'Internal', states: ['internal_review', 'ready_for_client'] },
  { value: 'client_review,changes_requested', label: 'With client', states: ['client_review', 'changes_requested'] },
  { value: 'approved,scheduled,publishing', label: 'Approved', states: ['approved', 'scheduled', 'publishing'] },
  { value: 'published', label: 'Published', states: ['published'] },
  { value: 'cancelled', label: 'Cancelled', states: ['cancelled'] },
]

/** P42 production hub. With `clientId` it lists one client's content. */
export function ContentList({ clientId, canCreate = true }: { clientId?: string; canCreate?: boolean }) {
  const state = useListState()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [creating, setCreating] = useState(false)
  const fixed = clientId ? { client: clientId } : undefined

  const query = useQuery({
    queryKey: ['agency', 'content', 'list', apiQuery(state.params, fixed)],
    queryFn: () => contentApi.list(apiQuery(state.params, fixed)),
    placeholderData: keepPreviousData,
  })
  const data = query.data
  const count = (states: ContentState[]) => (data ? states.reduce((n, s) => n + (data.counts[s] ?? 0), 0) : undefined)

  const filters: FilterDef[] = [
    { kind: 'toggle', key: 'mine', label: 'Mine', description: 'I own, review or collaborate on it' },
    { kind: 'multi', key: 'platform', label: 'Platform', options: PLATFORMS.map((p) => ({ value: p, label: platformLabel[p] })) },
  ]

  const columns: Column<ContentRow>[] = [
    {
      key: 'title',
      header: 'Content',
      className: 'w-[32%]',
      cell: (c) => (
        <CellText
          primary={
            <Link to={`/app/content/${c._id}`} className="hover:underline">
              {c.title}
            </Link>
          }
          secondary={[!clientId && c.clientInfo?.brandName, `${platformLabel[c.platform]} · ${formatLabel[c.format]}`].filter(Boolean).join(' · ')}
        />
      ),
    },
    {
      key: 'state',
      header: 'Status',
      cell: (c) => (
        <div className="flex flex-col items-start gap-1">
          <StatePill state={c.state} />
          {c.version && <span className="text-[11px] text-text-4">{versionLabel(c.version.number)}</span>}
        </div>
      ),
    },
    { key: 'approval', header: 'Client approval', cell: (c) => <ApprovalPill status={c.approvalStatus} /> },
    { key: 'owner', header: 'Owner', cell: (c) => <span className="text-text-2">{c.ownerInfo?.name ?? '—'}</span> },
    {
      key: 'dates',
      header: 'Publish · deadline',
      cell: (c) => <CellText primary={<span className="font-normal">{c.publishDate ? formatDate(c.publishDate) : 'No date'}</span>} secondary={c.due ? `Due ${formatDate(c.due)}` : undefined} />,
    },
    {
      key: 'priority',
      header: 'Priority',
      cell: (c) => (c.priority === 'normal' ? <span className="text-text-4">—</span> : <Pill tone={priorityTone[c.priority]} dot={false}>{priorityLabel[c.priority]}</Pill>),
    },
    { key: 'updated', header: 'Updated', cell: (c) => <span className="text-text-2">{timeAgo(c.updatedAt)}</span> },
  ]

  const anyFilter = [...state.params.keys()].some((k) => !['page', 'pageSize', 'sort'].includes(k))
  const allCount = data ? CONTENT_STATES.filter((s) => s !== 'cancelled').reduce((n, s) => n + data.counts[s], 0) : undefined

  return (
    <div className="flex flex-col gap-4">
      {canCreate && clientId && (
        <div className="flex justify-end">
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus size={16} /> New content
          </Button>
        </div>
      )}
      <ListToolbar
        state={state}
        searchPlaceholder="Search titles…"
        filters={filters}
        sorts={SORTS}
        defaultSort="updated"
        total={data?.total}
        noun="item"
        tabs={{
          key: 'state',
          allLabel: 'All',
          allCount,
          options: TABS.map((t) => ({ value: t.value, label: t.label, count: count(t.states) })),
        }}
      />
      <DataTable
        label="Content"
        columns={columns}
        rows={data?.items}
        rowKey={(c) => c._id}
        loading={query.isPending}
        fetching={query.isPlaceholderData}
        onRowClick={(c) => navigate(`/app/content/${c._id}`)}
        empty={
          query.isError ? (
            <EmptyState title="Couldn’t load content">{errorMessage(query.error)}</EmptyState>
          ) : anyFilter ? (
            <EmptyState title="Nothing here" action={<Button onClick={() => state.clear([...state.params.keys()])}>Show everything</Button>}>
              {state.get('q') ? 'Try a different search.' : 'No content is at this stage right now.'}
            </EmptyState>
          ) : (
            <EmptyState
              title="No content yet"
              action={
                canCreate && (
                  <Button variant="primary" onClick={() => setCreating(true)}>
                    <Plus size={16} /> New content
                  </Button>
                )
              }
            >
              Create a post, reel or carousel, then upload its first version.
            </EmptyState>
          )
        }
        footer={
          data &&
          data.total > 0 && (
            <Pagination
              {...data}
              noun="items"
              onPage={(page) => state.update({ page })}
              onPageSize={(pageSize) => state.update({ pageSize: pageSize === 25 ? null : pageSize })}
            />
          )
        }
      />
      {creating && (
        <ContentFormDialog
          clientId={clientId}
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            void qc.invalidateQueries({ queryKey: ['agency', 'content'] })
            navigate(`/app/content/${id}`)
          }}
        />
      )}
    </div>
  )
}
