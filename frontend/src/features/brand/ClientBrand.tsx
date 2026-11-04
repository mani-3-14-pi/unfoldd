import { useState, type ReactNode } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, MessageSquarePlus, PackagePlus, Pencil } from 'lucide-react'
import { Pagination } from '@/components/list/Pagination'
import { Button } from '@/components/ui/Button'
import { Card, EmptyState } from '@/components/ui/Card'
import { Details } from '@/components/ui/Details'
import { Pill } from '@/components/ui/Pill'
import type { ClientDetail } from '@/features/clients/api'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { formatDate, timeAgo } from '@/lib/format'
import { AGENCY_SECTIONS, brandApi, brandKey, CLIENT_SECTIONS, type AudienceData, type Brand, type BrandSection, type IntroData, type PersonalityData, type TasteData, type TextData } from './api'
import { AssetRequestDialog, RequestUpdateDialog } from './BrandDialogs'
import { BrandReferences } from './BrandReferences'
import { Guidelines } from './Guidelines'
import { leaning, sectionHint, sectionLabel, stepLabel, tagLabel } from './labels'
import { SectionDialog } from './SectionDialog'

/**
 * The client's Brand DNA (P21–P26): onboarding progress, the client's own answers, the agency's professional
 * layer built from them (D82), references, internal guidelines and the change history.
 */
export function ClientBrand({ client }: { client: ClientDetail }) {
  const qc = useQueryClient()
  const query = useQuery({ queryKey: brandKey(client._id), queryFn: () => brandApi.get(client._id) })
  const [editing, setEditing] = useState<BrandSection | null>(null)
  const [asking, setAsking] = useState<BrandSection | null>(null)
  const [assetAsk, setAssetAsk] = useState(false)
  const refresh = () => void qc.invalidateQueries({ queryKey: ['agency', 'brand', client._id] })
  const manage = client.canManage
  const writable = client.status !== 'archived'

  if (query.isPending) return <div className="h-64" />
  if (query.isError) return <EmptyState title="Couldn’t load the Brand DNA">{errorMessage(query.error)}</EmptyState>
  const brand = query.data.brand

  const sectionCard = (section: BrandSection, agencyLayer: boolean) => {
    const s = brand.sections[section]
    const empty = isEmpty(s?.data)
    return (
      <Card
        key={section}
        title={sectionLabel[section]}
        description={s?.updatedBy && s.updatedAt ? `${s.updatedBy.name} (${s.updatedBy.side === 'client' ? 'client' : 'team'}) · ${timeAgo(s.updatedAt)}` : agencyLayer ? sectionHint[section] : 'Not answered yet'}
        action={
          manage && (
            <div className="flex gap-1">
              {!agencyLayer && (
                <Button size="sm" variant="ghost" aria-label={`Ask the client to update ${sectionLabel[section]}`} title="Ask the client to update" onClick={() => setAsking(section)}>
                  <MessageSquarePlus size={14} />
                </Button>
              )}
              <Button size="sm" onClick={() => setEditing(section)}>
                <Pencil size={13} /> Edit
              </Button>
            </div>
          )
        }
      >
        {empty ? (
          <p className="px-5 py-4 text-[13px] text-text-3">{agencyLayer ? 'Not written yet. Until it is, the client sees their own answers here.' : 'Nothing yet.'}</p>
        ) : (
          <SectionView section={section} brand={brand} />
        )}
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <OnboardingCard brand={brand} canAsk={manage} onAskAsset={() => setAssetAsk(true)} />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">From the client</h2>
        <div className="grid gap-6 xl:grid-cols-2">{CLIENT_SECTIONS.map((s) => sectionCard(s, false))}</div>
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-semibold">Your professional layer</h2>
          <p className="text-xs text-text-3">Built by your team from the client’s answers. The client sees it in their Brand DNA.</p>
        </div>
        <div className="grid gap-6 xl:grid-cols-2">{AGENCY_SECTIONS.map((s) => sectionCard(s, true))}</div>
      </section>

      <BrandReferences clientId={client._id} writable={writable} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Guidelines clientId={client._id} writable={manage} />
        <BrandHistory clientId={client._id} />
      </div>

      {editing && <SectionDialog clientId={client._id} section={editing} brand={brand} onClose={() => setEditing(null)} onSaved={refresh} onReload={() => {
        setEditing(null)
        refresh()
      }} />}
      {asking && <RequestUpdateDialog clientId={client._id} section={asking} onClose={() => setAsking(null)} onDone={refresh} />}
      {assetAsk && <AssetRequestDialog clientId={client._id} onClose={() => setAssetAsk(false)} onDone={refresh} />}
    </div>
  )
}

const isEmpty = (data: unknown): boolean => {
  if (data == null) return true
  if (typeof data === 'string') return !data.trim()
  if (typeof data === 'number') return false
  if (Array.isArray(data)) return data.every(isEmpty)
  if (typeof data === 'object') return Object.values(data).every(isEmpty)
  return true
}

/** P16: six equal sections (D72); the client taps Done on each. */
function OnboardingCard({ brand, canAsk, onAskAsset }: { brand: Brand; canAsk: boolean; onAskAsset: () => void }) {
  const o = brand.onboarding
  return (
    <Card
      title="Onboarding"
      description={o.completedAt ? `Completed ${formatDate(o.completedAt)}` : `${o.done} of ${o.total} sections done`}
      action={
        canAsk && (
          <Button size="sm" onClick={onAskAsset}>
            <PackagePlus size={14} /> Ask for an asset
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-4 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-input" role="progressbar" aria-valuenow={o.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Onboarding progress">
            <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${o.percent}%` }} />
          </div>
          <span className="text-sm font-semibold">{o.percent}%</span>
        </div>
        <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {o.steps.map((s) => (
            <li key={s.key} className="flex items-center gap-2.5 text-[13px]">
              <span className={cn('grid size-6 shrink-0 place-items-center rounded-full', s.completedAt ? 'bg-green-soft text-green-ink' : 'border border-border-strong text-text-4')}>
                {s.completedAt ? <Check size={13} strokeWidth={2.4} /> : null}
              </span>
              <span className={s.completedAt ? 'text-text' : 'text-text-3'}>{stepLabel[s.key]}</span>
              {s.key === 'assets' && o.assetRequestsOpen > 0 && (
                <Pill tone="amber" dot={false}>
                  {o.assetRequestsOpen} remaining
                </Pill>
              )}
            </li>
          ))}
        </ol>
      </div>
    </Card>
  )
}

function SectionView({ section, brand }: { section: BrandSection; brand: Brand }) {
  const raw = brand.sections[section]?.data ?? {}
  switch (section) {
    case 'intro': {
      const d = raw as Partial<IntroData>
      const socials = Object.entries(d.socials ?? {}).filter(([k, v]) => k !== 'other' && v) as [string, string][]
      return (
        <Details
          rows={[
            { label: 'What the brand does', value: d.whatWeDo, wide: true },
            { label: 'What it stands for', value: d.standFor, wide: true },
            { label: 'Who it’s for', value: d.audience, wide: true },
            { label: 'Offerings', value: (d.offerings ?? []).map((o) => (o.description ? `${o.name}: ${o.description}` : o.name)).join('\n'), wide: true },
            { label: 'Website', value: d.website && <a href={d.website} target="_blank" rel="noreferrer" className="hover:underline">{d.website}</a> },
            { label: 'Social', value: socials.map(([k, v]) => `${k === 'x' ? 'X' : tagLabel(k)}: ${v}`).join('\n') },
          ]}
        />
      )
    }
    case 'personality': {
      const d = raw as Partial<PersonalityData>
      return (
        <div className="flex flex-col gap-3 px-5 py-4">
          {brand.meta.personalityAxes.map((a) => {
            const v = d.axes?.[a.key]
            return (
              <div key={a.key} className="flex flex-col gap-1">
                <div className="flex justify-between text-xs text-text-3">
                  <span>{a.left}</span>
                  <span className="font-medium text-text">{leaning(v, a.left, a.right)}</span>
                  <span>{a.right}</span>
                </div>
                <div className="relative h-1.5 rounded-full bg-surface-input">
                  {v != null && <span className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand ring-2 ring-white" style={{ left: `${v}%` }} />}
                </div>
              </div>
            )
          })}
          {d.keywords && <p className="text-[13px] text-text-2">Keywords: {d.keywords}</p>}
        </div>
      )
    }
    case 'likes':
    case 'dislikes': {
      const d = raw as Partial<TasteData>
      return (
        <div className="flex flex-col gap-2 px-5 py-4">
          <div className="flex flex-wrap gap-1.5">
            {(d.tags ?? []).map((t) => (
              <Pill key={t} tone={section === 'likes' ? 'green' : 'red'} dot={false}>
                {tagLabel(t)}
              </Pill>
            ))}
          </div>
          {d.note && <p className="text-[13px] text-text-2">{d.note}</p>}
        </div>
      )
    }
    case 'audience': {
      const d = raw as Partial<AudienceData>
      return (
        <Details
          rows={[
            { label: 'Primary', value: d.primary, wide: true },
            { label: 'Secondary', value: d.secondary, wide: true },
            { label: 'Age', value: d.age },
            { label: 'Location', value: d.location },
            { label: 'Behaviour', value: d.behaviour, wide: true },
            { label: 'Interests', value: d.interests, wide: true },
          ]}
        />
      )
    }
    default:
      return <p className="px-5 py-4 text-[13px] whitespace-pre-line">{(raw as Partial<TextData>).text}</p>
  }
}

/** P24: every change, with who made it. */
function BrandHistory({ clientId }: { clientId: string }) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const query = useQuery({
    queryKey: ['agency', 'brand', clientId, 'history', page, pageSize],
    queryFn: () => brandApi.history(clientId, `page=${page}&pageSize=${pageSize}`),
    placeholderData: keepPreviousData,
  })
  const data = query.data
  let body: ReactNode
  if (query.isPending) body = <div className="h-24" />
  else if (query.isError) body = <EmptyState title="Couldn’t load the history">{errorMessage(query.error)}</EmptyState>
  else if (!data!.items.length) body = <p className="px-5 py-4 text-[13px] text-text-3">No changes yet.</p>
  else
    body = (
      <ol className="flex flex-col gap-3 px-5 py-4">
        {data!.items.map((e) => (
          <li key={e._id} className="text-[13px]">
            <p>{e.message}</p>
            <p className="text-xs text-text-4">{timeAgo(e.createdAt)}</p>
          </li>
        ))}
      </ol>
    )
  return (
    <Card title="Change history" description="Every edit to the Brand DNA, from both sides.">
      {body}
      {data && data.total > pageSize && <Pagination {...data} noun="changes" onPage={setPage} onPageSize={setPageSize} />}
    </Card>
  )
}
