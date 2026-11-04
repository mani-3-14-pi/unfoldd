import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { CellText, DataTable, type Column } from '@/components/list/DataTable'
import { Pagination } from '@/components/list/Pagination'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/ui/Card'
import { Select } from '@/components/ui/Field'
import { Switch } from '@/components/ui/Switch'
import { contentApi, type InboxThread } from '@/features/content/api'
import { pinLabel, versionLabel } from '@/features/content/labels'
import { ThreadStatusPill } from '@/features/content/pills'
import { apiQuery, useListState } from '@/hooks/useListState'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { timeAgo } from '@/lib/format'

const STATUS_TABS = [
  { value: '', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'resolved', label: 'Resolved' },
]

/** P57 feedback inbox: submitted feedback across every client the person can see, newest first. */
export function FeedbackInboxPage() {
  const state = useListState()
  const navigate = useNavigate()
  const query = useQuery({
    queryKey: ['agency', 'feedback', apiQuery(state.params)],
    queryFn: () => contentApi.inbox(apiQuery(state.params)),
    placeholderData: keepPreviousData,
  })
  const data = query.data
  const status = state.get('status')
  const internal = state.get('visibility') === 'internal'

  const columns: Column<InboxThread>[] = [
    {
      key: 'pin',
      header: '#',
      className: 'w-14',
      cell: (t) => (
        <span className={cn('grid h-6 min-w-6 place-items-center rounded-full px-1.5 text-[11px] font-semibold text-white', t.visibility === 'internal' ? 'bg-[#4b47c4]' : 'bg-[#e5484d]')}>
          {pinLabel(t.visibility, t.pin)}
        </span>
      ),
    },
    {
      key: 'feedback',
      header: 'Feedback',
      className: 'w-[40%]',
      cell: (t) => <CellText primary={<span className="font-normal whitespace-normal">{t.first?.body || (t.first?.voice?.file ? 'Voice note' : '—')}</span>} secondary={`${t.author.name} · ${timeAgo(t.submittedAt)}`} />,
    },
    {
      key: 'content',
      header: 'On',
      cell: (t) => <CellText primary={t.contentInfo?.title ?? '—'} secondary={[t.clientInfo?.brandName, t.versionNumber ? versionLabel(t.versionNumber) : null].filter(Boolean).join(' · ')} />,
    },
    { key: 'status', header: 'Status', cell: (t) => <ThreadStatusPill status={t.status} reopened={!!t.reopenedAt} /> },
    { key: 'replies', header: 'Replies', cell: (t) => <span className="text-text-2">{Math.max(0, t.messageCount - 1)}</span> },
  ]

  return (
    <>
      <PageHeader title="Feedback" description="Every comment from clients, so nothing gets lost. Open one to reply, assign it or turn it into a task." />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="Status" className="flex gap-1">
          {STATUS_TABS.map((t) => (
            <button
              key={t.label}
              type="button"
              role="tab"
              aria-selected={status === t.value}
              onClick={() => state.update({ status: t.value })}
              className={cn('h-9 rounded-full px-3.5 text-xs', status === t.value ? 'bg-white font-medium shadow-sm ring-1 ring-border-strong' : 'text-[#2d2c34] hover:bg-black/4')}
            >
              {t.label}
            </button>
          ))}
        </div>
        <Select aria-label="Whose feedback" value={internal ? 'internal' : 'client'} onChange={(e) => state.update({ visibility: e.target.value === 'internal' ? 'internal' : null })} className="w-44">
          <option value="client">From clients</option>
          <option value="internal">Internal notes</option>
        </Select>
        <label className="flex items-center gap-2 text-xs text-text-2">
          <Switch label="Assigned to me" checked={state.get('mine') === 'true'} onChange={(on) => state.update({ mine: on })} />
          Assigned to me
        </label>
      </div>
      <DataTable
        label="Feedback"
        columns={columns}
        rows={data?.items}
        rowKey={(t) => t._id}
        loading={query.isPending}
        fetching={query.isPlaceholderData}
        onRowClick={(t) => navigate(`/app/content/${t.content}`)}
        empty={
          query.isError ? (
            <EmptyState title="Couldn’t load feedback">{errorMessage(query.error)}</EmptyState>
          ) : (
            <EmptyState title={status === 'resolved' ? 'Nothing resolved yet' : 'You’re all caught up'}>
              {status === 'resolved' ? 'Resolved feedback shows up here.' : 'No open feedback right now.'}
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
    </>
  )
}
