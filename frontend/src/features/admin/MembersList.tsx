import { useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { EllipsisVertical, ShieldOff } from 'lucide-react'
import { CellText, DataTable, type Column } from '@/components/list/DataTable'
import type { FilterDef } from '@/components/list/filters'
import { ListToolbar } from '@/components/list/ListToolbar'
import { Pagination } from '@/components/list/Pagination'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Menu } from '@/components/ui/Menu'
import { Pill } from '@/components/ui/Pill'
import { apiQuery, useListState } from '@/hooks/useListState'
import { errorMessage } from '@/lib/errors'
import { formatDate, timeAgo } from '@/lib/format'
import { toast } from '@/lib/toast'
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
  const qc = useQueryClient()
  const [resetting, setResetting] = useState<Member | null>(null)
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
    {
      key: '2fa',
      header: 'Two-factor',
      cell: (m) => <span className="text-text-2">{m.user.twoFactorEnabled ? 'On' : 'Not set up'}</span>,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'w-12 text-right',
      cell: (m) => (
        <Menu
          label={`Actions for ${m.user.name}`}
          heading={m.user.name}
          items={[{ label: 'Reset two-factor sign-in', icon: ShieldOff, onSelect: () => setResetting(m) }]}
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
      {resetting && (
        <ConfirmDialog
          title={`Reset two-factor sign-in for ${resetting.user.name}?`}
          confirm="Reset two-factor"
          variant="danger"
          action={() => adminApi.resetMember2fa(agencyId, resetting.user._id)}
          onClose={() => setResetting(null)}
          onDone={() => {
            toast(`Two-factor sign-in reset for ${resetting.user.name}`)
            void qc.invalidateQueries({ queryKey: ['admin'] })
          }}
        >
          For a lost phone or authenticator. They’re signed out everywhere and set two-factor up again the next time they log in.
          It’s recorded in the activity log.
        </ConfirmDialog>
      )}
    </div>
  )
}
