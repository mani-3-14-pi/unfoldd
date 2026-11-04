import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { UserMinus, UserPlus } from 'lucide-react'
import { CellText } from '@/components/list/DataTable'
import { Button } from '@/components/ui/Button'
import { Card, EmptyState } from '@/components/ui/Card'
import { Select } from '@/components/ui/Field'
import { agencyRoleLabel } from '@/features/agency/roles'
import { activeTeamQuery } from '@/features/team/api'
import { errorMessage } from '@/lib/errors'
import { toast } from '@/lib/toast'
import { clientsApi, type ClientDetail } from './api'

/**
 * Who on the agency team works on this client (P135). Owners and admins always see every client;
 * everyone else needs to be added here. Effective permission = role ∩ client access (D45).
 */
export function ClientAccess({ client }: { client: ClientDetail }) {
  const qc = useQueryClient()
  const key = ['agency', 'clients', 'access', client._id]
  const access = useQuery({ queryKey: key, queryFn: () => clientsApi.access(client._id) })
  const team = useQuery({ ...activeTeamQuery, enabled: client.canManage })
  const [picked, setPicked] = useState('')

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key })
    void qc.invalidateQueries({ queryKey: ['agency', 'team'] })
  }
  const grant = useMutation({
    mutationFn: (userId: string) => clientsApi.grant(client._id, userId),
    onSuccess: () => {
      setPicked('')
      refresh()
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  })
  const revoke = useMutation({
    mutationFn: (row: { _id: string; name: string }) => clientsApi.revoke(client._id, row._id),
    onSuccess: (result, row) => {
      toast(result.wasAccountManager ? `${row.name} no longer has access. They were the account manager, so pick a new one.` : `${row.name} no longer has access`)
      refresh()
      if (result.wasAccountManager) void qc.invalidateQueries({ queryKey: ['agency', 'clients'] })
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  })

  if (access.isPending) return <Card title="People on this client"><div className="h-32" /></Card>
  if (access.isError) return <EmptyState title="Couldn’t load access">{errorMessage(access.error)}</EmptyState>

  const { items, alwaysVisibleTo } = access.data
  const assigned = new Set([...items.map((r) => r.user._id), ...alwaysVisibleTo.map((a) => a.user._id)])
  const addable = (team.data?.items ?? []).filter((m) => !assigned.has(m.user._id))

  const row = (key: string, name: string, email: string, detail: string, action?: React.ReactNode) => (
    <li key={key} className="flex items-center gap-4 px-5 py-3">
      <div className="min-w-0 flex-1">
        <CellText primary={name} secondary={email} />
      </div>
      <span className="text-xs text-text-3">{detail}</span>
      {action}
    </li>
  )

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Card
        title="Assigned to this client"
        description="Managers and members only see the clients they’re assigned to."
        action={
          client.canManage && (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (picked) grant.mutate(picked)
              }}
            >
              <Select value={picked} onChange={(e) => setPicked(e.target.value)} className="w-48" aria-label="Team member to add" disabled={!addable.length}>
                <option value="">{addable.length ? 'Choose someone…' : 'Everyone is added'}</option>
                {addable.map((m) => (
                  <option key={m.user._id} value={m.user._id}>
                    {m.user.name}
                  </option>
                ))}
              </Select>
              <Button type="submit" size="md" disabled={!picked} loading={grant.isPending}>
                <UserPlus size={15} /> Add
              </Button>
            </form>
          )
        }
      >
        {items.length === 0 ? (
          <EmptyState title="No one assigned yet">Add the people who’ll work on this client.</EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((r) =>
              row(
                r._id,
                r.user.name,
                r.user.email,
                [r.membership ? agencyRoleLabel[r.membership.role] : 'No longer on the team', r.user._id === client.accountManager?._id ? 'Account manager' : '']
                  .filter(Boolean)
                  .join(' · '),
                client.canManage && (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove ${r.user.name}`}
                    disabled={revoke.isPending}
                    onClick={() => revoke.mutate({ _id: r.user._id, name: r.user.name })}
                  >
                    <UserMinus size={15} />
                  </Button>
                ),
              ),
            )}
          </ul>
        )}
      </Card>

      <Card title="Always have access" description="Owners and admins see every client.">
        <ul className="divide-y divide-border">
          {alwaysVisibleTo.map((a) => row(a.user._id, a.user.name, a.user.email, agencyRoleLabel[a.role]))}
        </ul>
      </Card>
    </div>
  )
}
