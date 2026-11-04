import { useInfiniteQuery } from '@tanstack/react-query'
import { Film, ImageOff } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/Card'
import { useClientSession } from '@/features/agency/session'
import { CLIENT_BUCKETS, clientContentApi, type ClientBucket, type ClientContentCard } from '@/features/client-app/content/api'
import { bucketLabel } from '@/features/client-app/content/labels'
import { ClientStatusPill } from '@/features/client-app/content/pills'
import { formatLabel, platformLabel, versionLabel } from '@/features/content/labels'
import { useListState } from '@/hooks/useListState'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { formatInZone } from '@/lib/zonedTime'

const PAGE_SIZE = 25

/** F16–F20: everything the agency has shared, filtered the client's way (D03). */
export function ClientContentPage() {
  const state = useListState()
  const status = state.get('status') as ClientBucket | ''
  const query = useInfiniteQuery({
    queryKey: ['client', 'content', 'list', status],
    queryFn: ({ pageParam }) => clientContentApi.list(new URLSearchParams({ page: String(pageParam), pageSize: String(PAGE_SIZE), ...(status ? { status } : {}) }).toString()),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
  })
  const counts = query.data?.pages[0]?.counts
  const items = query.data?.pages.flatMap((p) => p.items) ?? []
  const all = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : undefined

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Content</h1>
      <p className="mt-1 text-[13px] text-text-3">Everything your agency has shared with you.</p>

      <div role="tablist" aria-label="Filter by status" className="-mx-4 mt-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
        {[{ value: '', label: 'All', count: all }, ...CLIENT_BUCKETS.map((b) => ({ value: b, label: bucketLabel[b], count: counts?.[b] }))].map((t) => (
          <button
            key={t.value || 'all'}
            type="button"
            role="tab"
            aria-selected={status === t.value}
            onClick={() => state.update({ status: t.value })}
            className={cn(
              'flex h-9 shrink-0 items-center gap-2 rounded-full px-3.5 text-xs whitespace-nowrap',
              status === t.value ? 'bg-brand font-medium text-white' : 'bg-white text-text-2 ring-1 ring-border-strong',
            )}
          >
            {t.label}
            {t.count !== undefined && <span className={cn('text-[11px]', status === t.value ? 'text-white/75' : 'text-text-4')}>{t.count}</span>}
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-col gap-3">
        {query.isPending ? (
          Array.from({ length: 4 }, (_, i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-surface-input" />)
        ) : query.isError ? (
          <EmptyState title="Couldn’t load content">{errorMessage(query.error)}</EmptyState>
        ) : items.length === 0 ? (
          <EmptyState title={status ? `Nothing ${bucketLabel[status].toLowerCase()}` : 'Nothing shared yet'}>
            {status === 'review_required' ? 'You’re all caught up.' : 'Content shows up here once your agency sends it to you.'}
          </EmptyState>
        ) : (
          items.map((c) => <ContentCard key={c.id} item={c} />)
        )}
        {query.hasNextPage && (
          <Button onClick={() => void query.fetchNextPage()} loading={query.isFetchingNextPage} className="self-center">
            Show more
          </Button>
        )}
      </div>
    </>
  )
}

function ContentCard({ item: c }: { item: ClientContentCard }) {
  const tz = useClientSession().client.timezone
  return (
    <Link to={`/c/content/${c.id}`} className="flex gap-3.5 rounded-xl border border-border bg-white p-3 hover:border-border-strong active:bg-surface">
      <Cover item={c} />
      <span className="flex min-w-0 flex-1 flex-col gap-1.5 py-0.5">
        <span className="line-clamp-2 text-[15px] leading-snug font-semibold">{c.title}</span>
        <span className="text-xs text-text-3">
          {platformLabel[c.platform]} · {formatLabel[c.format]}
          {c.versionNumber ? ` · ${versionLabel(c.versionNumber)}` : ''}
        </span>
        <span className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1">
          <ClientStatusPill status={c.status} />
          {c.publishDate && ['scheduled', 'published'].includes(c.status.bucket ?? '') && (
            <span className="text-[11px] text-text-3">{formatInZone(c.publishDate, tz, { withViewer: false })}</span>
          )}
        </span>
      </span>
    </Link>
  )
}

function Cover({ item: c }: { item: ClientContentCard }) {
  const f = c.cover
  const box = 'grid size-20 shrink-0 place-items-center overflow-hidden rounded-lg bg-[#1d2420] text-white/60'
  if (f?.url && f.mimeType?.startsWith('image/')) return <img src={f.url} alt="" className={cn(box, 'object-cover')} loading="lazy" />
  if (f?.url && f.mimeType?.startsWith('video/')) {
    return (
      <span className={cn(box, 'relative')}>
        <video src={f.url} muted playsInline preload="metadata" className="size-full object-cover" />
        <Film size={16} className="absolute right-1.5 bottom-1.5 text-white" />
      </span>
    )
  }
  return <span className={box}>{f && <ImageOff size={18} />}</span>
}
