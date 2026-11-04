import { useMutation } from '@tanstack/react-query'
import { EllipsisVertical, Send, XCircle } from 'lucide-react'
import { CellText, DataTable, type Column } from '@/components/list/DataTable'
import { EmptyState } from '@/components/ui/Card'
import { Menu } from '@/components/ui/Menu'
import { Pill } from '@/components/ui/Pill'
import { errorMessage } from '@/lib/errors'
import { formatDate, timeAgo } from '@/lib/format'
import { toast } from '@/lib/toast'
import { invitationsApi, invitationStatusLabel, invitationStatusTone, type Invitation } from './api'

/**
 * Pending and expired invitations with Resend and Revoke. Resend issues a new link and kills the old one (D49);
 * "asked for a new one" marks an expired invite whose recipient pressed Request New Invitation (D74).
 */
export function InvitationRows({
  rows,
  loading,
  error,
  roleLabel,
  canManage,
  onChanged,
  footer,
}: {
  rows: Invitation[] | undefined
  loading: boolean
  error?: unknown
  roleLabel: (role: string) => string
  canManage: boolean
  onChanged: () => void
  footer?: React.ReactNode
}) {
  const resend = useMutation({
    mutationFn: (inv: Invitation) => invitationsApi.resend(inv.id, crypto.randomUUID()),
    onSuccess: (_, inv) => {
      toast(`New invitation sent to ${inv.email}`)
      onChanged()
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  })
  const revoke = useMutation({
    mutationFn: (inv: Invitation) => invitationsApi.revoke(inv.id),
    onSuccess: (_, inv) => {
      toast(`Invitation to ${inv.email} revoked`)
      onChanged()
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  })

  const columns: Column<Invitation>[] = [
    {
      key: 'email',
      header: 'Invited',
      cell: (i) => <CellText primary={i.email} secondary={i.invitedBy ? `by ${i.invitedBy.name}` : undefined} />,
    },
    { key: 'role', header: 'Role', cell: (i) => <span className="text-text-2">{roleLabel(i.role)}</span> },
    {
      key: 'status',
      header: 'Status',
      cell: (i) => (
        <div className="flex flex-col items-start gap-1">
          <Pill tone={invitationStatusTone[i.status]}>{invitationStatusLabel[i.status]}</Pill>
          {i.reinviteRequestedAt && i.status === 'expired' && <span className="text-[11px] text-amber-ink">Asked for a new one {timeAgo(i.reinviteRequestedAt)}</span>}
        </div>
      ),
    },
    { key: 'sent', header: 'Sent', cell: (i) => <CellText primary={<span className="font-normal">{formatDate(i.invitedAt)}</span>} secondary={timeAgo(i.invitedAt)} /> },
    {
      key: 'expires',
      header: 'Expires',
      cell: (i) => <span className="text-text-2">{i.status === 'expired' ? 'Expired' : timeAgo(i.expiresAt)}</span>,
    },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: <span className="sr-only">Actions</span>,
            className: 'w-12 text-right',
            cell: (i: Invitation) => (
              <Menu
                label={`Actions for the invitation to ${i.email}`}
                heading={i.email}
                items={[
                  { label: 'Resend invitation', icon: Send, onSelect: () => resend.mutate(i), disabled: resend.isPending },
                  ...(i.status === 'pending'
                    ? [{ label: 'Revoke', icon: XCircle, tone: 'danger' as const, onSelect: () => revoke.mutate(i), disabled: revoke.isPending, separated: true }]
                    : []),
                ]}
                className="grid size-8 place-items-center rounded-lg text-text-3 hover:bg-black/5"
              >
                <EllipsisVertical size={17} />
              </Menu>
            ),
          },
        ]
      : []),
  ]

  return (
    <DataTable
      label="Invitations"
      columns={columns}
      rows={rows}
      rowKey={(i) => i.id}
      loading={loading}
      empty={
        error ? <EmptyState title="Couldn’t load invitations">{errorMessage(error)}</EmptyState> : <EmptyState title="No open invitations">Pending and expired invitations show up here.</EmptyState>
      }
      footer={footer}
    />
  )
}
