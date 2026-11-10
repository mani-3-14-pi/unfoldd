import type { ReactNode } from 'react'
import { CalendarCheck, Eye, Layers, LayoutGrid, List, MessageSquareWarning } from 'lucide-react'
import { Link } from 'react-router'
import { StatCard } from '@/components/ui/Card'
import type { ListState } from '@/hooks/useListState'
import { cn } from '@/lib/cn'
import { formatDate, initials } from '@/lib/format'
import type { ContentPage, ContentRow, ContentState } from './api'
import { formatLabel, platformLabel } from './labels'
import { StatePill } from './pills'
import { formatIcon, platformTint } from './tiles'

const sum = (counts: Record<ContentState, number>, states: ContentState[]) => states.reduce((n, s) => n + (counts[s] ?? 0), 0)

/** P42 numbers above the list. The counts come with the list and ignore the selected tab, so they stay put while browsing. */
export function ContentStats({ data, state }: { data: ContentPage | undefined; state: ListState }) {
  /** Opens the list at those states, keeping the chosen layout. */
  const link = (states?: string) => {
    const q = new URLSearchParams()
    if (state.get('view')) q.set('view', state.get('view'))
    if (states) q.set('state', states)
    return `?${q}`
  }
  if (!data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-[92px] animate-pulse rounded-2xl bg-surface-input" />
        ))}
      </div>
    )
  }
  const c = data.counts
  const total = Object.entries(c).reduce((n, [s, v]) => (s === 'cancelled' ? n : n + v), 0)
  const internal = sum(c, ['internal_review', 'ready_for_client'])
  const withClient = sum(c, ['client_review'])
  const changes = sum(c, ['changes_requested'])
  const scheduled = sum(c, ['scheduled', 'publishing'])
  return (
    <section aria-label="Content overview" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Total content" value={total} icon={Layers} tone="green" note={`${sum(c, ['planned', 'in_production'])} in production`} to={link()} />
      <StatCard label="Awaiting review" value={internal + withClient} icon={Eye} tone="indigo" note={`${internal} internal · ${withClient} client`} to={link('internal_review,ready_for_client,client_review')} />
      <StatCard label="Needs changes" value={changes} icon={MessageSquareWarning} tone={changes ? 'red' : 'gray'} note="to work through" to={link('changes_requested')} />
      <StatCard label="Scheduled" value={scheduled} icon={CalendarCheck} tone="amber" note={`${c.published} published`} to={link('scheduled,publishing')} />
    </section>
  )
}

/** List or grid, kept in the URL as ?view=grid (the list is the default). */
export function ContentViewToggle({ state }: { state: ListState }) {
  const grid = state.get('view') === 'grid'
  return (
    <div role="group" aria-label="Layout" className="flex h-9 items-center rounded-lg border border-[#eceaeb] bg-surface p-0.5">
      {[
        { v: false, label: 'List view', icon: List },
        { v: true, label: 'Grid view', icon: LayoutGrid },
      ].map(({ v, label, icon: Icon }) => (
        <button
          key={label}
          type="button"
          aria-label={label}
          aria-pressed={grid === v}
          onClick={() => state.update({ view: v ? 'grid' : null, page: state.get('page') || null })}
          className={cn('grid h-7 w-8 place-items-center rounded-md', grid === v ? 'bg-brand text-white' : 'text-text-3 hover:bg-black/5')}
        >
          <Icon size={15} strokeWidth={1.8} />
        </button>
      ))}
    </div>
  )
}

/** Content as cards: a tinted tile with the format, then title, format and date, client and state. */
export function ContentGrid({
  rows,
  loading,
  fetching,
  showClient,
  empty,
  footer,
}: {
  rows: ContentRow[] | undefined
  loading: boolean
  fetching: boolean
  showClient: boolean
  empty: ReactNode
  footer?: ReactNode
}) {
  if (loading) {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-4">
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="h-64 animate-pulse rounded-2xl bg-surface-input" />
        ))}
      </div>
    )
  }
  if (!rows?.length) return <div className="rounded-xl border border-border bg-surface">{empty}</div>
  return (
    <div className="flex flex-col gap-4">
      <ul aria-label="Content" className={cn('grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-4', fetching && 'opacity-60')}>
        {rows.map((c) => (
          <li key={c._id}>
            <ContentCard row={c} showClient={showClient} />
          </li>
        ))}
      </ul>
      {footer && <div className="rounded-xl border border-border bg-surface">{footer}</div>}
    </div>
  )
}

function ContentCard({ row: c, showClient }: { row: ContentRow; showClient: boolean }) {
  const Icon = formatIcon[c.format]
  const date = c.publishDate ?? c.due
  return (
    <Link
      to={`/app/content/${c._id}`}
      className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-surface p-1.5 transition-colors hover:border-border-strong hover:bg-[#f6f5f6]"
    >
      <div className={cn('relative grid aspect-[4/3] place-items-center rounded-xl bg-gradient-to-br', platformTint[c.platform])}>
        <Icon size={40} strokeWidth={1.4} aria-hidden="true" />
        <span className="absolute bottom-2 left-2 rounded-md bg-white/85 px-1.5 py-0.5 text-[10px] font-semibold text-text-2">{platformLabel[c.platform]}</span>
        {c.version && <span className="absolute top-2 right-2 rounded-md bg-white/85 px-1.5 py-0.5 text-[10px] font-medium text-text-3">V{String(c.version.number).padStart(2, '0')}</span>}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 px-1.5 pt-2.5 pb-1.5">
        <span className="line-clamp-2 text-[13px] font-semibold">{c.title}</span>
        <span className="text-[11px] text-text-3">
          {formatLabel[c.format]}
          {date && ` · ${formatDate(date)}`}
        </span>
        {showClient && c.clientInfo && (
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-text-2">
            <span className="grid size-5 shrink-0 place-items-center rounded bg-surface-input text-[9px] font-semibold text-text-3">{initials(c.clientInfo.brandName)}</span>
            <span className="truncate">{c.clientInfo.brandName}</span>
          </span>
        )}
        <span className="mt-auto pt-1">
          <StatePill state={c.state} />
        </span>
      </div>
    </Link>
  )
}
