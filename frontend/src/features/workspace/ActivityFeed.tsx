import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Eye, LifeBuoy } from 'lucide-react'
import { CellText, DataTable, type Column } from '@/components/list/DataTable'
import { Pagination } from '@/components/list/Pagination'
import { EmptyState } from '@/components/ui/Card'
import { Select } from '@/components/ui/Field'
import { apiQuery, useListState } from '@/hooks/useListState'
import { errorMessage } from '@/lib/errors'
import { formatDateTime, timeAgo } from '@/lib/format'
import { workspaceApi, type AgencyActivity } from './api'

/** Areas of the activity log, by action prefix (`client.created` → client). */
const AREAS = [
  { value: '', label: 'Everything' },
  { value: 'client', label: 'Clients' },
  { value: 'member', label: 'Team' },
  { value: 'invitation', label: 'Invitations' },
  { value: 'agency', label: 'Agency settings' },
  { value: 'content', label: 'Content' },
  { value: 'file', label: 'Files' },
  { value: 'user', label: 'Sign-ins' },
]

const actorLabel = { platform_admin: 'Unfoldd support', agency_user: 'Team', client_user: 'Client', system: 'System' } as const

/**
 * The agency's activity: everything the signed-in person can see, newest first. With `clientId` it's one client's.
 * Events marked "Client can see" also appear in that client's own feed.
 */
export function ActivityFeed({ clientId }: { clientId?: string }) {
  const state = useListState()
  const fixed = clientId ? { client: clientId } : undefined
  const query = useQuery({
    queryKey: ['agency', 'activity', apiQuery(state.params, fixed)],
    queryFn: () => workspaceApi.activity(apiQuery(state.params, fixed)),
    placeholderData: keepPreviousData,
  })
  const data = query.data

  const columns: Column<AgencyActivity>[] = [
    {
      key: 'when',
      header: 'When',
      className: 'w-[170px]',
      cell: (a) => <CellText primary={<span className="font-normal">{timeAgo(a.createdAt)}</span>} secondary={formatDateTime(a.createdAt)} />,
    },
    {
      key: 'what',
      header: 'Activity',
      cell: (a) => (
        <div className="min-w-0">
          <div className="text-[13px] whitespace-normal text-text">{a.message}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-text-3">
            <span>{a.actor.name ? `${a.actor.name} · ${actorLabel[a.actor.type]}` : actorLabel[a.actor.type]}</span>
            {a.impersonator && (
              <span className="inline-flex items-center gap-1 text-amber-ink">
                <LifeBuoy size={12} /> via support · {a.impersonator.name}
              </span>
            )}
            {a.visibility === 'client' && (
              <span className="inline-flex items-center gap-1">
                <Eye size={12} /> Client can see
              </span>
            )}
          </div>
        </div>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <label className="flex items-center gap-2 self-start text-xs text-text-3">
        Show
        <Select value={state.get('action')} onChange={(e) => state.update({ action: e.target.value })} className="w-44">
          {AREAS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </Select>
      </label>
      <DataTable
        label="Activity"
        columns={columns}
        rows={data?.items}
        rowKey={(a) => a._id}
        loading={query.isPending}
        fetching={query.isPlaceholderData}
        empty={
          query.isError ? (
            <EmptyState title="Couldn’t load activity">{errorMessage(query.error)}</EmptyState>
          ) : (
            <EmptyState title="Nothing here yet">Changes to clients, the team and content show up here as they happen.</EmptyState>
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
    </div>
  )
}
