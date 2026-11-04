import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2, UserPlus } from 'lucide-react'
import { CellText, DataTable, type Column } from '@/components/list/DataTable'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Select } from '@/components/ui/Field'
import { CLIENT_ROLES, type ClientRole } from '@/features/agency/api'
import { clientRoleHint, clientRoleLabel } from '@/features/agency/roles'
import { InvitationRows } from '@/features/invitations/InvitationRows'
import { InviteDialog } from '@/features/invitations/InviteDialog'
import { errorMessage } from '@/lib/errors'
import { timeAgo } from '@/lib/format'
import { toast } from '@/lib/toast'
import { clientsApi, type ClientDetail, type ClientMember } from './api'

/**
 * The brand's own people (F71, P172) and their invitations. A client always keeps at least one Admin, so the
 * server refuses to remove or downgrade the last one.
 */
export function ClientPeople({ client }: { client: ClientDetail }) {
  const qc = useQueryClient()
  const membersKey = ['agency', 'clients', 'members', client._id]
  const invitesKey = ['agency', 'clients', 'invitations', client._id]
  const members = useQuery({ queryKey: membersKey, queryFn: () => clientsApi.members(client._id) })
  const invites = useQuery({ queryKey: invitesKey, queryFn: () => clientsApi.invitations(client._id) })
  const [inviting, setInviting] = useState(false)
  const [removing, setRemoving] = useState<ClientMember | null>(null)

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: membersKey })
    void qc.invalidateQueries({ queryKey: invitesKey })
  }
  const setRole = useMutation({
    mutationFn: ({ m, role }: { m: ClientMember; role: ClientRole }) => clientsApi.setMemberRole(client._id, m.user._id, role),
    onSuccess: (_, { m, role }) => {
      toast(`${m.user.name} is now ${clientRoleLabel[role].toLowerCase()}`)
      refresh()
    },
    onError: (err) => {
      toast(errorMessage(err), 'error')
      refresh()
    },
  })

  const hasMembers = (members.data?.items.length ?? 0) > 0
  const columns: Column<ClientMember>[] = [
    { key: 'name', header: 'Person', className: 'w-[34%]', cell: (m) => <CellText primary={m.user.name} secondary={m.user.email} /> },
    {
      key: 'role',
      header: 'Role',
      cell: (m) =>
        client.canManage ? (
          <Select
            value={m.role}
            aria-label={`Role for ${m.user.name}`}
            className="w-36"
            disabled={setRole.isPending}
            onChange={(e) => setRole.mutate({ m, role: e.target.value as ClientRole })}
          >
            {CLIENT_ROLES.map((r) => (
              <option key={r} value={r}>
                {clientRoleLabel[r]}
              </option>
            ))}
          </Select>
        ) : (
          <span className="text-text-2">{clientRoleLabel[m.role]}</span>
        ),
    },
    { key: 'login', header: 'Last login', cell: (m) => <span className="text-text-2">{m.user.lastLoginAt ? timeAgo(m.user.lastLoginAt) : 'Never'}</span> },
    ...(client.canManage
      ? [
          {
            key: 'actions',
            header: <span className="sr-only">Actions</span>,
            className: 'w-12 text-right',
            cell: (m: ClientMember) => (
              <Button size="sm" variant="ghost" aria-label={`Remove ${m.user.name}`} onClick={() => setRemoving(m)}>
                <Trash2 size={15} />
              </Button>
            ),
          },
        ]
      : []),
  ]

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">{client.brandName}’s people</h2>
            <p className="mt-0.5 text-xs text-text-3">They review content, give feedback and approve in the client app. Client seats are always free.</p>
          </div>
          {client.canManage && (
            <Button variant="primary" onClick={() => setInviting(true)}>
              <UserPlus size={16} /> Invite client
            </Button>
          )}
        </div>
        <DataTable
          label={`${client.brandName} people`}
          columns={columns}
          rows={members.data?.items}
          rowKey={(m) => m._id}
          loading={members.isPending}
          empty={
            members.isError ? (
              <EmptyState title="Couldn’t load people">{errorMessage(members.error)}</EmptyState>
            ) : (
              <EmptyState
                title="No one from the client yet"
                action={
                  client.canManage && (
                    <Button variant="primary" onClick={() => setInviting(true)}>
                      <UserPlus size={16} /> Invite their first admin
                    </Button>
                  )
                }
              >
                The first person you invite should be an admin: they can approve and invite their own colleagues.
              </EmptyState>
            )
          }
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Invitations</h2>
        <InvitationRows
          rows={invites.data?.items}
          loading={invites.isPending}
          error={invites.error}
          roleLabel={(r) => clientRoleLabel[r as ClientRole] ?? r}
          canManage={client.canManage}
          onChanged={refresh}
        />
      </section>

      {inviting && (
        <InviteDialog
          title={`Invite someone from ${client.brandName}`}
          description="They’ll get an email to join the client app. The link works for 7 days, only for that email."
          roles={CLIENT_ROLES.map((r) => ({ value: r, label: clientRoleLabel[r], hint: clientRoleHint[r] }))}
          defaultRole={hasMembers ? 'approver' : 'admin'}
          send={(body, key) => clientsApi.invite(client._id, body, key)}
          onClose={() => setInviting(false)}
          onSent={refresh}
        />
      )}
      {removing && (
        <ConfirmDialog
          title={`Remove ${removing.user.name}?`}
          confirm="Remove"
          variant="danger"
          action={() => clientsApi.removeMember(client._id, removing.user._id)}
          onClose={() => setRemoving(null)}
          onDone={() => {
            toast(`${removing.user.name} was removed`)
            refresh()
          }}
        >
          <p>They lose access to {client.brandName} in the client app and are signed out of it at once. Their past feedback and approvals stay.</p>
        </ConfirmDialog>
      )}
    </div>
  )
}
