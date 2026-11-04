import { useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Crown, EllipsisVertical, Pencil, Power, PowerOff, Trash2, UserPlus } from 'lucide-react'
import { useParams } from 'react-router'
import { CellText, DataTable, type Column } from '@/components/list/DataTable'
import type { FilterDef } from '@/components/list/filters'
import { ListToolbar } from '@/components/list/ListToolbar'
import { Pagination } from '@/components/list/Pagination'
import { PageHeader } from '@/components/PageHeader'
import { TabNav } from '@/components/TabNav'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Menu, type MenuItem } from '@/components/ui/Menu'
import { Pill } from '@/components/ui/Pill'
import { AGENCY_ROLES, type AgencyRole } from '@/features/agency/api'
import { agencyRoleHint, agencyRoleLabel, ASSIGNABLE_ROLES, isAgencyAdmin } from '@/features/agency/roles'
import { useAgencySession } from '@/features/agency/session'
import { InvitationRows } from '@/features/invitations/InvitationRows'
import { InviteDialog } from '@/features/invitations/InviteDialog'
import { MemberDialog } from '@/features/team/MemberDialog'
import { MEMBER_STATUSES, teamApi, type NeedsReassignment, type TeamMember } from '@/features/team/api'
import { apiQuery, useListState } from '@/hooks/useListState'
import { errorMessage } from '@/lib/errors'
import { plural, timeAgo } from '@/lib/format'
import { toast } from '@/lib/toast'

const SORTS = [
  { value: 'name', label: 'Name A–Z' },
  { value: 'role', label: 'Role' },
  { value: 'newest', label: 'Joined last' },
  { value: 'oldest', label: 'Joined first' },
]

const FILTERS: FilterDef[] = [
  { kind: 'multi', key: 'role', label: 'Role', options: AGENCY_ROLES.map((r) => ({ value: r, label: agencyRoleLabel[r] })) },
  { kind: 'multi', key: 'status', label: 'Status', options: MEMBER_STATUSES.map((s) => ({ value: s, label: s === 'active' ? 'Active' : 'Disabled' })) },
]

type Confirm = { kind: 'disable' | 'enable' | 'remove' | 'transfer'; member: TeamMember }

/** P130–P135: the agency team and its invitations. Everyone sees the team; Owner/Admin manage it. */
export function TeamPage() {
  const { tab = '' } = useParams()
  const s = useAgencySession()
  const qc = useQueryClient()
  const [inviting, setInviting] = useState(false)
  const manage = isAgencyAdmin(s.role)
  const refresh = () => qc.invalidateQueries({ queryKey: ['agency', 'team'] })

  return (
    <>
      <PageHeader
        title="Team"
        description="Everyone at your agency. Owners and admins see every client; managers and members see the clients they’re assigned to."
        actions={
          manage && (
            <Button variant="primary" onClick={() => setInviting(true)}>
              <UserPlus size={16} /> Invite people
            </Button>
          )
        }
      />
      {manage && (
        <TabNav
          label="Team sections"
          tabs={[
            { to: '/app/team', label: 'Members' },
            { to: '/app/team/invitations', label: 'Invitations' },
          ]}
        />
      )}
      {tab === 'invitations' && manage ? <TeamInvitations /> : <MembersTable onChanged={refresh} />}

      {inviting && (
        <InviteDialog
          title="Invite to your team"
          description={`They’ll get an email to join ${s.agency.name}. The link works for 7 days, only for that email.`}
          roles={ASSIGNABLE_ROLES.filter((r) => r !== 'admin' || s.role === 'owner').map((r) => ({ value: r, label: agencyRoleLabel[r], hint: agencyRoleHint[r] }))}
          defaultRole="member"
          send={(body, key) => teamApi.invite(body, key)}
          onClose={() => setInviting(false)}
          onSent={refresh}
        />
      )}
    </>
  )
}

function MembersTable({ onChanged }: { onChanged: () => void }) {
  const s = useAgencySession()
  const state = useListState()
  const [editing, setEditing] = useState<TeamMember | null>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const manage = isAgencyAdmin(s.role)

  const query = useQuery({
    queryKey: ['agency', 'team', 'members', apiQuery(state.params)],
    queryFn: () => teamApi.members(apiQuery(state.params)),
    placeholderData: keepPreviousData,
  })
  const data = query.data

  /** Mirrors the server: nobody changes themselves or the owner, and only the owner changes an admin. */
  const canChange = (m: TeamMember) => manage && m.user._id !== s.user.id && m.role !== 'owner' && (m.role !== 'admin' || s.role === 'owner')

  const menuItems = (m: TeamMember): MenuItem[] => [
    { label: 'Edit role and details', icon: Pencil, onSelect: () => setEditing(m) },
    m.status === 'active'
      ? { label: 'Disable', icon: PowerOff, onSelect: () => setConfirm({ kind: 'disable', member: m }) }
      : { label: 'Enable', icon: Power, onSelect: () => setConfirm({ kind: 'enable', member: m }) },
    ...(s.role === 'owner' && m.role === 'admin' && m.status === 'active'
      ? [{ label: 'Make owner', icon: Crown, onSelect: () => setConfirm({ kind: 'transfer', member: m }) }]
      : []),
    { label: 'Remove from team', icon: Trash2, tone: 'danger', onSelect: () => setConfirm({ kind: 'remove', member: m }), separated: true },
  ]

  const columns: Column<TeamMember>[] = [
    {
      key: 'name',
      header: 'Member',
      className: 'w-[28%]',
      cell: (m) => <CellText primary={<>{m.user.name}{m.user._id === s.user.id && <span className="ml-1.5 font-normal text-text-4">(you)</span>}</>} secondary={m.user.email} />,
    },
    {
      key: 'role',
      header: 'Role',
      cell: (m) => (
        <div className="flex flex-col items-start gap-1">
          <span className="text-text-2">{agencyRoleLabel[m.role]}</span>
          {m.canPublish && !isAgencyAdmin(m.role) && <span className="text-[11px] text-text-4">Can publish</span>}
        </div>
      ),
    },
    {
      key: 'titles',
      header: 'Title · department',
      cell: (m) => <CellText primary={<span className="font-normal">{m.titles.join(', ') || '—'}</span>} secondary={m.departments.join(', ') || undefined} />,
    },
    {
      key: 'clients',
      header: 'Clients',
      cell: (m) => <span className="text-text-2">{isAgencyAdmin(m.role) ? 'All' : m.clientCount}</span>,
    },
    { key: 'status', header: 'Status', cell: (m) => <Pill tone={m.status === 'active' ? 'green' : 'gray'}>{m.status === 'active' ? 'Active' : 'Disabled'}</Pill> },
    { key: 'login', header: 'Last login', cell: (m) => <span className="text-text-2">{m.user.lastLoginAt ? timeAgo(m.user.lastLoginAt) : 'Never'}</span> },
    ...(manage
      ? [
          {
            key: 'actions',
            header: <span className="sr-only">Actions</span>,
            className: 'w-12 text-right',
            cell: (m: TeamMember) =>
              canChange(m) && (
                <Menu label={`Actions for ${m.user.name}`} heading={m.user.name} items={menuItems(m)} className="grid size-8 place-items-center rounded-lg text-text-3 hover:bg-black/5">
                  <EllipsisVertical size={17} />
                </Menu>
              ),
          },
        ]
      : []),
  ]

  const anyFilter = [...state.params.keys()].some((k) => !['page', 'pageSize', 'sort'].includes(k))
  const reassignNotice = (result: unknown, name: string) => {
    const clients = (result as { needsReassignment?: NeedsReassignment })?.needsReassignment ?? []
    if (clients.length) {
      toast(`${name} was account manager for ${clients.map((c) => c.brandName).join(', ')}. Pick a new one on ${clients.length === 1 ? 'that client' : 'those clients'}.`)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <ListToolbar state={state} searchPlaceholder="Search names, emails, titles…" filters={FILTERS} sorts={SORTS} defaultSort="name" total={data?.total} noun="member" />
      <DataTable
        label="Team members"
        columns={columns}
        rows={data?.items}
        rowKey={(m) => m._id}
        loading={query.isPending}
        fetching={query.isPlaceholderData}
        onRowClick={(m) => canChange(m) && setEditing(m)}
        empty={
          query.isError ? (
            <EmptyState title="Couldn’t load the team">{errorMessage(query.error)}</EmptyState>
          ) : anyFilter ? (
            <EmptyState title="No one matches" action={<Button onClick={() => state.clear([...state.params.keys()])}>Clear filters</Button>} />
          ) : (
            <EmptyState title="It’s just you so far">Invite your team to work on clients together.</EmptyState>
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

      {editing && <MemberDialog member={editing} myRole={s.role} onClose={() => setEditing(null)} onSaved={onChanged} />}
      {confirm && <MemberConfirm confirm={confirm} onClose={() => setConfirm(null)} onDone={(result) => {
        reassignNotice(result, confirm.member.user.name)
        onChanged()
      }} />}
    </div>
  )
}

function MemberConfirm({ confirm: { kind, member: m }, onClose, onDone }: { confirm: Confirm; onClose: () => void; onDone: (result: unknown) => void }) {
  const name = m.user.name
  const copy = {
    disable: {
      title: `Disable ${name}?`,
      body: 'They’re signed out everywhere and can’t log in to this agency until you enable them again. Their work stays.',
      confirm: 'Disable',
      done: `${name} is disabled`,
      action: () => teamApi.disable(m.user._id),
    },
    enable: { title: `Enable ${name}?`, body: 'They can log in again, with the same role and client access as before.', confirm: 'Enable', done: `${name} is active again`, action: () => teamApi.enable(m.user._id) },
    remove: {
      title: `Remove ${name} from the team?`,
      body: 'They lose their role and every client assignment, and are signed out at once. Their past work and activity stay. To bring them back, invite them again.',
      confirm: 'Remove',
      done: `${name} was removed`,
      action: () => teamApi.remove(m.user._id),
    },
    transfer: {
      title: `Make ${name} the owner?`,
      body: 'They get full control, including billing and the team. You become an admin. Only the new owner can undo this.',
      confirm: 'Transfer ownership',
      done: `${name} is now the owner`,
      action: () => teamApi.transferOwnership(m.user._id),
    },
  }[kind]

  return (
    <ConfirmDialog
      title={copy.title}
      confirm={copy.confirm}
      variant={kind === 'remove' || kind === 'disable' ? 'danger' : 'primary'}
      action={copy.action}
      onClose={onClose}
      onDone={(result) => {
        toast(copy.done)
        onDone(result)
        // Ownership changes this person's own role: reload the session so the portal reflects it.
        if (kind === 'transfer') window.location.reload()
      }}
    >
      <p>{copy.body}</p>
    </ConfirmDialog>
  )
}

function TeamInvitations() {
  const state = useListState()
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: ['agency', 'team', 'invitations', apiQuery(state.params)],
    queryFn: () => teamApi.invitations(apiQuery(state.params)),
    placeholderData: keepPreviousData,
  })
  const data = query.data
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-text-3">{data ? `${plural(data.total, 'invitation')} waiting or expired.` : ' '}</p>
      <InvitationRows
        rows={data?.items}
        loading={query.isPending}
        error={query.error}
        roleLabel={(r) => agencyRoleLabel[r as AgencyRole] ?? r}
        canManage
        onChanged={() => void qc.invalidateQueries({ queryKey: ['agency', 'team'] })}
        footer={
          data &&
          data.total > data.pageSize && (
            <Pagination
              {...data}
              noun="invitations"
              onPage={(page) => state.update({ page })}
              onPageSize={(pageSize) => state.update({ pageSize: pageSize === 25 ? null : pageSize })}
            />
          )
        }
      />
    </div>
  )
}
