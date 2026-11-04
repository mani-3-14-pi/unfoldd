import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink, Pencil } from 'lucide-react'
import { NavLink, useParams } from 'react-router'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card, EmptyState } from '@/components/ui/Card'
import { ActivityList } from '@/features/admin/ActivityList'
import { actionsFor } from '@/features/admin/agencyActions'
import { useAgencyActions } from '@/features/admin/useAgencyActions'
import { adminApi, type AgencyDetail } from '@/features/admin/api'
import { agencyStatusLabel, planLabel } from '@/features/admin/labels'
import { AgencyStatusPill, SubscriptionStatusPill } from '@/features/admin/pills'
import { MembersList } from '@/features/admin/MembersList'
import { SubscriptionDialog } from '@/features/admin/SubscriptionDialog'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/cn'
import { formatDate, formatDateTime, timeAgo } from '@/lib/format'

const TABS = [
  { id: '', label: 'Overview' },
  { id: 'members', label: 'Members' },
  { id: 'subscription', label: 'Subscription' },
  { id: 'activity', label: 'Activity' },
]

export function AgencyDetailPage() {
  const { id = '', tab = '' } = useParams()
  const query = useQuery({ queryKey: ['admin', 'agency', id], queryFn: () => adminApi.agency(id) })
  const actions = useAgencyActions()
  const [editingSub, setEditingSub] = useState(false)

  if (query.isPending) return <PageHeader title="Agency" back={{ to: '/admin/agencies', label: 'Agencies' }} />
  if (query.isError) {
    return (
      <>
        <PageHeader title="Agency" back={{ to: '/admin/agencies', label: 'Agencies' }} />
        <EmptyState title="Couldn’t load this agency">{errorMessage(query.error)}</EmptyState>
      </>
    )
  }
  const a = query.data.agency

  return (
    <>
      <PageHeader
        back={{ to: '/admin/agencies', label: 'Agencies' }}
        title={a.name}
        meta={<AgencyStatusPill status={a.status} />}
        description={
          <>
            {a.email} · signed up {formatDate(a.createdAt)}
          </>
        }
        actions={
          <>
            {actionsFor(a.status).map((action) => {
              const Icon = actions.iconOf(action)
              return (
                <Button
                  key={action}
                  variant={action === 'suspend' || action === 'reject' ? 'secondary' : 'primary'}
                  className={action === 'suspend' || action === 'reject' ? 'text-negative' : undefined}
                  onClick={() => actions.run(action, a)}
                >
                  <Icon size={16} /> {actions.labelOf(action)}
                </Button>
              )
            })}
            <Button onClick={() => actions.run('impersonate', a)}>
              <ExternalLink size={16} /> Open admin portal
            </Button>
          </>
        }
      />

      {a.statusReason && (a.status === 'suspended' || a.status === 'rejected') && (
        <p className="mb-5 rounded-lg border border-red-soft bg-[#fdf3f3] px-4 py-3 text-[13px] text-red-ink">
          <strong className="font-semibold">{agencyStatusLabel[a.status]}</strong>
          {a.statusChangedAt && ` ${timeAgo(a.statusChangedAt)}`}: {a.statusReason}
        </p>
      )}

      <nav className="mb-5 flex gap-1 overflow-x-auto border-b border-border" aria-label="Agency sections">
        {TABS.map((t) => (
          <NavLink
            key={t.id}
            to={`/admin/agencies/${a._id}${t.id ? `/${t.id}` : ''}`}
            end
            className={({ isActive }) =>
              cn('-mb-px border-b-2 px-3.5 pb-2.5 text-[13px] whitespace-nowrap', isActive ? 'border-brand font-medium text-text' : 'border-transparent text-text-3 hover:text-text')
            }
          >
            {t.label}
            {t.id === 'members' && <span className="ml-1.5 text-text-4">{a.memberCount}</span>}
          </NavLink>
        ))}
      </nav>

      {tab === '' && <OverviewTab agency={a} />}
      {tab === 'members' && <MembersList agencyId={a._id} />}
      {tab === 'subscription' && <SubscriptionTab agency={a} onEdit={() => setEditingSub(true)} />}
      {tab === 'activity' && <ActivityList agencyId={a._id} />}

      {editingSub && <SubscriptionDialog agency={a} onClose={() => setEditingSub(false)} />}
      {actions.dialog}
    </>
  )
}

function Details({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-4 px-5 py-4 sm:grid-cols-2">
      {rows.map(({ label, value }) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs text-text-3">{label}</dt>
          <dd className="mt-0.5 text-[13px] break-words">{value || value === 0 ? value : '—'}</dd>
        </div>
      ))}
    </dl>
  )
}

function OverviewTab({ agency: a }: { agency: AgencyDetail }) {
  const website = a.website && /^https?:\/\//i.test(a.website) ? a.website : a.website && `https://${a.website}`
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card title="Agency">
        <Details
          rows={[
            { label: 'Name', value: a.name },
            { label: 'Workspace URL', value: <code className="text-xs">{a.slug}</code> },
            { label: 'Email', value: <a href={`mailto:${a.email}`} className="hover:underline">{a.email}</a> },
            { label: 'Phone', value: a.phone },
            { label: 'Website', value: website && <a href={website} target="_blank" rel="noreferrer" className="hover:underline">{a.website}</a> },
            { label: 'Country', value: a.country },
            { label: 'Team size', value: a.teamSize && `${a.teamSize} people` },
            { label: 'Members', value: a.memberCount },
          ]}
        />
      </Card>
      <div className="flex flex-col gap-6">
        <Card title="Owner">
          {a.owner ? (
            <Details
              rows={[
                { label: 'Name', value: a.owner.name },
                { label: 'Email', value: a.owner.email },
                { label: 'Last login', value: a.owner.lastLoginAt ? `${formatDateTime(a.owner.lastLoginAt)} (${timeAgo(a.owner.lastLoginAt)})` : 'Never' },
          ]}
            />
          ) : (
            <EmptyState title="No owner" />
          )}
        </Card>
        <Card title="Lifecycle">
          <Details
            rows={[
              { label: 'Status', value: <AgencyStatusPill status={a.status} /> },
              { label: 'Signed up', value: formatDateTime(a.createdAt) },
              { label: 'Approved', value: a.approvedAt ? formatDateTime(a.approvedAt) : 'Not yet' },
              { label: 'Status last changed', value: a.statusChangedAt ? formatDateTime(a.statusChangedAt) : '—' },
              { label: 'Signed-in sessions', value: a.activeSessions },
          ]}
          />
        </Card>
      </div>
    </div>
  )
}

function SubscriptionTab({ agency: a, onEdit }: { agency: AgencyDetail; onEdit: () => void }) {
  const s = a.subscription
  return (
    <Card
      title="Subscription"
      description="Placeholder record: billing isn’t connected yet, so nothing here is charged or enforced."
      action={
        <Button size="sm" onClick={onEdit}>
          <Pencil size={14} /> Edit
        </Button>
      }
      className="max-w-3xl"
    >
      <Details
        rows={[
          { label: 'Plan', value: planLabel[s.plan] },
          { label: 'Status', value: <SubscriptionStatusPill status={s.status} /> },
          { label: 'Seats', value: `${s.seats} (${a.memberCount} in use)` },
          { label: 'Started', value: formatDate(s.startedAt) },
          { label: 'Renews', value: s.renewsAt ? `${formatDate(s.renewsAt)} (${timeAgo(s.renewsAt)})` : '—' },
          { label: 'Notes', value: s.notes },
          ]}
      />
    </Card>
  )
}
