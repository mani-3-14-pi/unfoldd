import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, CheckCircle2, EllipsisVertical, Pencil, Play, RotateCcw } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card, EmptyState } from '@/components/ui/Card'
import { Details } from '@/components/ui/Details'
import { Menu } from '@/components/ui/Menu'
import { isManagerPlus } from '@/features/agency/roles'
import { useAgencySession } from '@/features/agency/session'
import { campaignKey, campaignsApi, type CampaignAction } from '@/features/campaigns/api'
import { CampaignFormDialog } from '@/features/campaigns/CampaignFormDialog'
import { campaignActionLabel, campaignActionsFor } from '@/features/campaigns/labels'
import { CampaignStatusPill, ProgressBar } from '@/features/campaigns/pills'
import { formatLabel, platformLabel } from '@/features/content/labels'
import { StatePill } from '@/features/content/pills'
import { clientPickerQuery } from '@/features/planning/queries'
import { activeTeamQuery } from '@/features/team/api'
import { errorMessage } from '@/lib/errors'
import { formatDate } from '@/lib/format'
import { toast } from '@/lib/toast'

const actionIcon = { activate: Play, complete: CheckCircle2, archive: Archive, restore: RotateCcw }

/** P34–P36: one campaign: what it's for, its brief, its content and how far along it is. */
export function CampaignDetailPage() {
  const { id = '' } = useParams()
  const s = useAgencySession()
  const qc = useQueryClient()
  const query = useQuery({ queryKey: campaignKey(id), queryFn: () => campaignsApi.get(id) })
  const clients = useQuery(clientPickerQuery)
  const team = useQuery(activeTeamQuery)
  const [editing, setEditing] = useState(false)
  const refresh = () => void qc.invalidateQueries({ queryKey: ['agency', 'campaigns'] })

  const act = useMutation({
    mutationFn: (action: CampaignAction) => campaignsApi.action(id, action),
    onSuccess: ({ campaign }) => {
      toast(`${campaign.name} is ${campaign.status}`)
      refresh()
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  })

  const back = { to: '/app/campaigns', label: 'Campaigns' }
  if (query.isPending) return <PageHeader title="Campaign" back={back} />
  if (query.isError) {
    return (
      <>
        <PageHeader title="Campaign" back={back} />
        <EmptyState title="Couldn’t open this campaign">{errorMessage(query.error)}</EmptyState>
      </>
    )
  }
  const c = query.data.campaign
  const client = clients.data?.items.find((x) => x._id === c.client)
  const ownerName = c.owner ? (team.data?.items.find((m) => m.user._id === c.owner)?.user.name ?? '…') : ''
  const manage = isManagerPlus(s.role)

  return (
    <>
      <PageHeader
        back={back}
        title={c.name}
        meta={<CampaignStatusPill status={c.status} />}
        description={
          <>
            {client && (
              <Link to={`/app/clients/${client._id}`} className="font-medium text-text-2 hover:underline">
                {client.brandName}
              </Link>
            )}
            {(c.startDate || c.endDate) && ` · ${formatDate(c.startDate || null)} – ${formatDate(c.endDate || null)}`}
          </>
        }
        actions={
          manage && (
            <>
              {c.status !== 'archived' && (
                <Button onClick={() => setEditing(true)}>
                  <Pencil size={15} /> Edit
                </Button>
              )}
              <Menu
                label={`Status of ${c.name}`}
                heading="Status"
                items={campaignActionsFor(c.status).map((a) => ({ label: campaignActionLabel[a], icon: actionIcon[a], onSelect: () => act.mutate(a) }))}
                className="grid size-9 place-items-center rounded-lg border border-[#e6e5e8] bg-white hover:bg-[#f6f6f7]"
              >
                <EllipsisVertical size={17} />
              </Menu>
            </>
          )
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card title="Content" description={`${c.content.length} piece${c.content.length === 1 ? '' : 's'} in this campaign`} action={<ProgressBar progress={c.progress} />}>
            {c.content.length === 0 ? (
              <EmptyState title="No content yet">Pick this campaign when creating content, or on a content plan item.</EmptyState>
            ) : (
              <ul className="divide-y divide-border">
                {c.content.map((x) => (
                  <li key={x._id}>
                    <Link to={`/app/content/${x._id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-[#f6f5f6]">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold">{x.title}</span>
                        <span className="block truncate text-xs text-text-3">
                          {platformLabel[x.platform]} · {formatLabel[x.format]}
                          {x.publishDate && ` · ${formatDate(x.publishDate)}`}
                        </span>
                      </span>
                      <StatePill state={x.state} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Brief" description="Only your team sees the brief.">
            <Details
              rows={[
                { label: 'Audience', value: c.audience, wide: true },
                { label: 'Background', value: c.brief.background, wide: true },
                { label: 'Strategy', value: c.brief.strategy, wide: true },
                { label: 'Deliverables', value: c.brief.deliverables, wide: true },
                { label: 'References', value: c.brief.references, wide: true },
                { label: 'Success criteria', value: c.brief.successCriteria, wide: true },
              ]}
            />
          </Card>
        </div>
        <div className="flex flex-col gap-6">
          <Card title="Shared with the client">
            <Details
              className="sm:grid-cols-1"
              rows={[
                { label: 'Objective', value: c.objective },
                { label: 'Key message', value: c.keyMessage },
              ]}
            />
          </Card>
          <Card title="Details">
            <Details
              className="sm:grid-cols-1"
              rows={[
                { label: 'Owner', value: ownerName },
                { label: 'Platforms', value: c.platforms.map((p) => platformLabel[p]).join(', ') },
                { label: 'Starts', value: c.startDate ? formatDate(c.startDate) : '' },
                { label: 'Ends', value: c.endDate ? formatDate(c.endDate) : '' },
              ]}
            />
          </Card>
        </div>
      </div>

      {editing && (
        <CampaignFormDialog
          campaign={c}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false)
            toast('Campaign saved')
            refresh()
          }}
          onReload={() => {
            setEditing(false)
            refresh()
          }}
        />
      )}
    </>
  )
}
