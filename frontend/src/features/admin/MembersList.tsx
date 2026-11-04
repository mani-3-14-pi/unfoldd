import { keepPreviousData, useQuery } from '@tanstack/react-query'
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
import { adminApi, MEMBER_ROLES, MEMBER_STATUSES, type Member } from './api'
import { memberStatusLabel, roleLabel } from './labels'

const SORTS = [
  { value: 'oldest', label: 'Joined first' },
  { value: 'newest', label: 'Joined last' },
  { value: 'name', label: 'Name A–Z' },
  { value: 'last_login', label: 'Last login' },
]

const FILTERS: FilterDef[] = [
  { kind: 'multi', key: 'role', label: 'Role', options: MEMBER_ROLES.map((r) => ({ value: r, label: roleLabel[r] })) },
  { kind: 'multi', key: 'status', label: 'Status', options: MEMBER_STATUSES.map((s) => ({ value: s, label: memberStatusLabel[s] })) },
]

const statusTone = { active: 'green', disabled: 'gray' } as const

export function MembersList({ agencyId }: { agencyId: string }) {
  const state = useListState()
  const query = useQuery({
    queryKey: ['admin', 'members', agencyId, apiQuery(state.params)],
    queryFn: () => adminApi.members(agencyId, apiQuery(state.params)),
    placeholderData: keepPreviousData,
  })
  const data = query.data

  const columns: Column<Member>[] = [
    { key: 'name', header: 'Member', cell: (m) => <CellText primary={m.user.name} secondary={m.user.email} /> },
    { key: 'role', header: 'Role', cell: (m) => <span className="text-text-2">{roleLabel[m.role]}</span> },
    { key: 'status', header: 'Status', cell: (m) => <Pill tone={statusTone[m.status]}>{memberStatusLabel[m.status]}</Pill> },
    { key: 'joined', header: 'Joined', cell: (m) => <span className="text-text-2">{formatDate(m.createdAt)}</span> },
    {
      key: 'login',
      header: 'Last login',
      cell: (m) => <span className="text-text-2">{m.user.lastLoginAt ? timeAgo(m.user.lastLoginAt) : 'Never'}</span>,
    },
  ]
  const anyFilter = [...state.params.keys()].some((k) => !['page', 'pageSize', 'sort'].includes(k))

  return (
    <div className="flex flex-col gap-4">
      <ListToolbar state={state} searchPlaceholder="Search names or emails…" filters={FILTERS} sorts={SORTS} defaultSort="oldest" total={data?.total} noun="member" />
      <DataTable
        label="Members"
        columns={columns}
        rows={data?.items}
        rowKey={(m) => m._id}
        loading={query.isPending}
        fetching={query.isPlaceholderData}
        empty={
          query.isError ? (
            <EmptyState title="Couldn’t load members">{errorMessage(query.error)}</EmptyState>
          ) : anyFilter ? (
            <EmptyState title="No members match" action={<Button onClick={() => state.clear([...state.params.keys()])}>Clear filters</Button>} />
          ) : (
            <EmptyState title="No members yet" />
          )
        }
        footer={
          data &&
          data.total > 0 && (
            <Pagination
              {...data}
              noun="members"
              onPage={(page) => state.update({ page })}
              onPageSize={(pageSize) => state.update({ pageSize: pageSize === 25 ? null : pageSize })}
            />
          )
        }
      />
    </div>
  )
}
