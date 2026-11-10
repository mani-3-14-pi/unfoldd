import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Send, Trash2, UserPlus, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, EmptyState } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Select } from '@/components/ui/Field'
import { Pill } from '@/components/ui/Pill'
import { CLIENT_ROLES, type ClientRole } from '@/features/agency/api'
import { clientRoleHint, clientRoleLabel } from '@/features/agency/roles'
import { useClientSession } from '@/features/agency/session'
import { ClientPageHeader, ClientRow } from '@/features/client-app/ClientPageHeader'
import { peopleApi, peopleKey, type Colleague } from '@/features/client-app/people/api'
import { useClientSpace } from '@/features/client-app/space'
import { invitationStatusLabel, invitationStatusTone } from '@/features/invitations/api'
import { InviteDialog } from '@/features/invitations/InviteDialog'
import { errorMessage } from '@/lib/errors'
import { initials, timeAgo } from '@/lib/format'
import { toast } from '@/lib/toast'

/**
 * F71 the brand's people. A client Admin invites their own colleagues (D48), changes their roles and removes
 * them; the agency is told and can cancel. There's always at least one Admin, so somebody can always approve.
 */
export function ClientPeoplePage() {
  const s = useClientSession()
  const space = useClientSpace()
  const qc = useQueryClient()
  const canInvite = !!space.data?.can.invite
  const [inviting, setInviting] = useState(false)
  const [removing, setRemoving] = useState<Colleague | null>(null)

  const members = useQuery({ queryKey: [...peopleKey, 'members'], queryFn: peopleApi.members })
  const invites = useQuery({ queryKey: [...peopleKey, 'invitations'], queryFn: peopleApi.invitations, enabled: canInvite })
  const refresh = () => void qc.invalidateQueries({ queryKey: peopleKey })
  const onError = (err: unknown) => toast(errorMessage(err), 'error')

  const resend = useMutation({
    mutationFn: (id: string) => peopleApi.resend(id, crypto.randomUUID()),
    onSuccess: () => {
      toast('A new invitation was sent')
      refresh()
    },
    onError,
  })
  const setRole = useMutation({
    mutationFn: ({ m, role }: { m: Colleague; role: ClientRole }) => peopleApi.setRole(m.user._id, role),
    onSuccess: (_, { m, role }) => {
      toast(`${m.user.name} is now ${clientRoleLabel[role].toLowerCase()}`)
      refresh()
    },
    onError: (err) => {
      onError(err)
      refresh()
    },
  })
  const revoke = useMutation({
    mutationFn: (id: string) => peopleApi.revoke(id),
    onSuccess: () => {
      toast('Invitation cancelled')
      refresh()
    },
    onError,
  })

  return (
    <>
      <ClientPageHeader
        title="People"
        back={{ to: '/c/more', label: 'More' }}
        description={`Everyone at ${s.client.brandName} who can see this space.`}
        action={
          canInvite && (
            <Button variant="primary" onClick={() => setInviting(true)}>
              <UserPlus size={16} /> Invite
            </Button>
          )
        }
      />

      <div className="flex flex-col gap-6">
        <Card>
          {members.isPending ? (
            <div className="h-32" />
          ) : members.isError ? (
            <EmptyState title="Couldn’t load your team">{errorMessage(members.error)}</EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {members.data.items.map((m) => (
                <li key={m._id}>
                  <ClientRow
                    icon={<span className="text-xs font-semibold">{initials(m.user.name)}</span>}
                    title={
                      <>
                        {m.user.name}
                        {m.user._id === s.user.id && <span className="ml-1.5 font-normal text-text-4">(you)</span>}
                      </>
                    }
                    detail={m.user.email}
                    end={
                      canInvite && m.user._id !== s.user.id ? (
                        <span className="flex shrink-0 items-center gap-1">
                          <Select
                            value={m.role}
                            aria-label={`Role for ${m.user.name}`}
                            className="h-9 w-32 text-xs"
                            disabled={setRole.isPending}
                            onChange={(e) => setRole.mutate({ m, role: e.target.value as ClientRole })}
                          >
                            {CLIENT_ROLES.map((r) => (
                              <option key={r} value={r}>
                                {clientRoleLabel[r]}
                              </option>
                            ))}
                          </Select>
                          <Button size="sm" variant="ghost" aria-label={`Remove ${m.user.name}`} onClick={() => setRemoving(m)}>
                            <Trash2 size={15} />
                          </Button>
                        </span>
                      ) : (
                        <Pill tone={m.role === 'admin' ? 'indigo' : 'gray'} dot={false}>
                          {clientRoleLabel[m.role]}
                        </Pill>
                      )
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </Card>

        {canInvite && (invites.data?.items.length ?? 0) > 0 && (
          <Card title="Invitations">
            <ul className="divide-y divide-border">
              {invites.data!.items.map((i) => (
                <li key={i.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium">{i.email}</span>
                    <span className="block text-xs text-text-3">
                      {clientRoleLabel[i.role as ClientRole] ?? i.role} · sent {timeAgo(i.invitedAt)}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Pill tone={invitationStatusTone[i.status]}>{invitationStatusLabel[i.status]}</Pill>
                    <Button size="sm" onClick={() => resend.mutate(i.id)} disabled={resend.isPending}>
                      <Send size={14} /> Resend
                    </Button>
                    {i.status === 'pending' && (
                      <Button size="sm" variant="ghost" onClick={() => revoke.mutate(i.id)} disabled={revoke.isPending} aria-label={`Cancel the invitation to ${i.email}`}>
                        <XCircle size={15} />
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
        {!canInvite && <p className="px-1 text-xs text-text-3">Only an admin of {s.client.brandName} can invite colleagues.</p>}
      </div>

      {inviting && (
        <InviteDialog
          title={`Invite a colleague to ${s.client.brandName}`}
          description={`They’ll get an email to join. The link works for 7 days, only for that email. ${s.agency.name} will be told.`}
          roles={CLIENT_ROLES.map((r) => ({ value: r, label: clientRoleLabel[r], hint: clientRoleHint[r] }))}
          defaultRole="contributor"
          send={(body, key) => peopleApi.invite(body, key)}
          onClose={() => setInviting(false)}
          onSent={refresh}
        />
      )}
      {removing && (
        <ConfirmDialog
          title={`Remove ${removing.user.name}?`}
          confirm="Remove"
          variant="danger"
          action={() => peopleApi.remove(removing.user._id)}
          onClose={() => setRemoving(null)}
          onDone={() => {
            toast(`${removing.user.name} was removed`)
            refresh()
          }}
        >
          <p>They lose access to {s.client.brandName} at once. Their past comments and approvals stay.</p>
        </ConfirmDialog>
      )}
    </>
  )
}
