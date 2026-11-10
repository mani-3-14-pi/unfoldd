import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, Building2, CheckCircle2, ChevronRight, EllipsisVertical, Pause, Pencil, Play, RotateCcw, Trash2, UserRound } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router'
import { PageHeader } from '@/components/PageHeader'
import { TabNav } from '@/components/TabNav'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Menu, type MenuItem } from '@/components/ui/Menu'
import { isAgencyAdmin, isManagerPlus } from '@/features/agency/roles'
import { useAgencySession } from '@/features/agency/session'
import { clientKey, clientsApi, type ClientAction } from '@/features/clients/api'
import { ClientBrand } from '@/features/brand/ClientBrand'
import { CampaignList } from '@/features/campaigns/CampaignList'
import { ClientAccess } from '@/features/clients/ClientAccess'
import { ClientConversations } from '@/features/conversations/ClientConversations'
import { ClientIntegrations } from '@/features/integrations/ClientIntegrations'
import { ClientLibrary } from '@/features/library/ClientLibrary'
import { ClientMeetings } from '@/features/meetings/MeetingList'
import { PlanList } from '@/features/plans/PlanList'
import { RequestList } from '@/features/requests/RequestList'
import { ClientFormDialog } from '@/features/clients/ClientFormDialog'
import { ClientLogo } from '@/features/clients/ClientLogo'
import { ClientOverview } from '@/features/clients/ClientOverview'
import { ClientPeople } from '@/features/clients/ClientPeople'
import { ContentList } from '@/features/content/ContentList'
import { actionsFor, clientActionCopy } from '@/features/clients/labels'
import { ClientStatusPill, HealthPill } from '@/features/clients/pills'
import { ActivityFeed } from '@/features/workspace/ActivityFeed'
import { errorMessage } from '@/lib/errors'
import { toast } from '@/lib/toast'

const actionIcon = { activate: Play, pause: Pause, complete: CheckCircle2, archive: Archive, restore: RotateCcw }

/** P17–P20: one client's overview, the agency people on it, the client's own people, and its activity. */
export function ClientDetailPage() {
  const { id = '', tab = '' } = useParams()
  const s = useAgencySession()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const query = useQuery({ queryKey: clientKey(id), queryFn: () => clientsApi.get(id) })
  const [editing, setEditing] = useState(false)
  const [confirm, setConfirm] = useState<ClientAction | 'delete' | null>(null)

  const back = { to: '/app/clients', label: 'Clients' }
  if (query.isPending) return <PageHeader title="Client" back={back} />
  if (query.isError) {
    return (
      <>
        <PageHeader title="Client" back={back} />
        <EmptyState title="Couldn’t open this client">{errorMessage(query.error)}</EmptyState>
      </>
    )
  }
  const c = query.data.client
  const refresh = () => qc.invalidateQueries({ queryKey: ['agency', 'clients'] })

  const runAction = async (action: ClientAction) => {
    try {
      await clientsApi.action(c._id, action)
      toast(`${c.brandName} ${clientActionCopy[action].done}`)
      void refresh()
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }

  const menu: MenuItem[] = [
    ...(isManagerPlus(s.role)
      ? actionsFor(c.status).map((action) => ({
          label: clientActionCopy[action].label,
          icon: actionIcon[action],
          onSelect: () => (clientActionCopy[action].confirm ? setConfirm(action) : void runAction(action)),
        }))
      : []),
    ...(isAgencyAdmin(s.role) ? [{ label: 'Delete client', icon: Trash2, tone: 'danger' as const, onSelect: () => setConfirm('delete'), separated: true }] : []),
  ]

  return (
    <>
      <header className="mb-6">
        <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1.5 text-[13px] text-text-3">
          <Link to={back.to} className="hover:text-text">
            {back.label}
          </Link>
          <ChevronRight size={14} aria-hidden="true" />
          <span className="truncate text-text-2">{c.brandName}</span>
        </nav>
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-center gap-5">
            <ClientLogo id={c._id} name={c.brandName} url={c.logoUrl} size="xl" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="font-display text-[30px] leading-[1.1] font-bold tracking-[-0.02em] sm:text-[40px]">{c.brandName}</h1>
                <ClientStatusPill status={c.status} />
                {c.status !== 'archived' && c.health && <HealthPill {...c.health} />}
              </div>
              <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text-2">
                {c.name !== c.brandName && (
                  <span className="inline-flex items-center gap-1.5">
                    <Building2 size={15} className="text-text-3" /> {c.name}
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5">
                  <UserRound size={15} className="text-text-3" />
                  {c.accountManager ? `Account manager: ${c.accountManager.name}` : 'No account manager yet'}
                </span>
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {c.canManage && (
              <Button onClick={() => setEditing(true)}>
                <Pencil size={15} /> Edit details
              </Button>
            )}
            {menu.length > 0 && (
              <Menu label={`More actions for ${c.brandName}`} heading={c.brandName} items={menu} className="grid size-9 place-items-center rounded-lg border border-[#e6e5e8] bg-white hover:bg-[#f6f6f7]">
                <EllipsisVertical size={17} />
              </Menu>
            )}
          </div>
        </div>
      </header>

      {c.status === 'archived' && (
        <p className="mb-5 rounded-lg border border-border-strong bg-surface px-4 py-3 text-[13px] text-text-2">
          This client is archived: everything is read-only, for your team and for theirs. Restore it to make changes.
        </p>
      )}

      <TabNav
        label="Client sections"
        tabs={[
          { to: `/app/clients/${c._id}`, label: 'Overview' },
          { to: `/app/clients/${c._id}/content`, label: 'Content' },
          { to: `/app/clients/${c._id}/brand`, label: 'Brand DNA' },
          { to: `/app/clients/${c._id}/campaigns`, label: 'Campaigns' },
          { to: `/app/clients/${c._id}/plans`, label: 'Plans' },
          { to: `/app/clients/${c._id}/requests`, label: 'Requests' },
          { to: `/app/clients/${c._id}/meetings`, label: 'Meetings' },
          { to: `/app/clients/${c._id}/conversations`, label: 'Conversations' },
          { to: `/app/clients/${c._id}/library`, label: 'Library' },
          { to: `/app/clients/${c._id}/integrations`, label: 'Integrations' },
          { to: `/app/clients/${c._id}/team`, label: 'Agency team' },
          { to: `/app/clients/${c._id}/members`, label: 'Client people' },
          { to: `/app/clients/${c._id}/activity`, label: 'Activity' },
        ]}
      />

      {tab === '' && <ClientOverview client={c} />}
      {tab === 'content' && <ContentList clientId={c._id} canCreate={c.status !== 'archived'} />}
      {tab === 'brand' && <ClientBrand client={c} />}
      {tab === 'campaigns' && <CampaignList clientId={c._id} />}
      {tab === 'plans' && <PlanList clientId={c._id} />}
      {tab === 'requests' && <RequestList clientId={c._id} />}
      {tab === 'meetings' && <ClientMeetings client={c} />}
      {tab === 'conversations' && <ClientConversations client={c} />}
      {tab === 'library' && <ClientLibrary client={c} />}
      {tab === 'integrations' && <ClientIntegrations client={c} />}
      {tab === 'team' && <ClientAccess client={c} />}
      {tab === 'members' && <ClientPeople client={c} />}
      {tab === 'activity' && <ActivityFeed clientId={c._id} />}

      {editing && (
        <ClientFormDialog
          client={c}
          onClose={() => setEditing(false)}
          onSaved={(saved) => {
            toast(`${saved.brandName} saved`)
            setEditing(false)
            void refresh()
          }}
          onReload={() => {
            setEditing(false)
            void refresh()
          }}
        />
      )}
      {confirm === 'delete' && (
        <ConfirmDialog
          title={`Delete ${c.brandName}?`}
          confirm="Delete client"
          variant="danger"
          action={() => clientsApi.remove(c._id)}
          onClose={() => setConfirm(null)}
          onDone={() => {
            toast(`${c.brandName} was deleted`)
            void refresh()
            navigate('/app/clients', { replace: true })
          }}
        >
          <p>The client disappears for your team, and its people lose access to the client app at once. Its history is kept but no longer shown.</p>
          <p>To pause work but keep everything visible, archive it instead.</p>
        </ConfirmDialog>
      )}
      {confirm && confirm !== 'delete' && (
        <ConfirmDialog
          title={`${clientActionCopy[confirm].label} ${c.brandName}?`}
          confirm={clientActionCopy[confirm].label}
          action={() => clientsApi.action(c._id, confirm)}
          onClose={() => setConfirm(null)}
          onDone={() => {
            toast(`${c.brandName} ${clientActionCopy[confirm].done}`)
            void refresh()
          }}
        >
          <p>{clientActionCopy[confirm].confirm}</p>
        </ConfirmDialog>
      )}
    </>
  )
}
