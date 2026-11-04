import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCheck, CircleAlert } from 'lucide-react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/Card'
import { ClientPageHeader } from '@/features/client-app/ClientPageHeader'
import { workspaceApi, type AppNotification } from '@/features/workspace/api'
import { useListState } from '@/hooks/useListState'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { formatDateTime, timeAgo } from '@/lib/format'
import { toast } from '@/lib/toast'

/**
 * F68/F69 notification centre. Opening one marks it read and follows its link; the page it opens always shows
 * the current state (D51), so "Approved by Priya" rather than an error when a colleague got there first.
 */
export function ClientNotificationsPage() {
  const state = useListState()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const unreadOnly = state.get('unread') === 'true'
  const page = Number(state.get('page', '1')) || 1
  const query = useQuery({
    queryKey: ['client', 'notifications', 'list', unreadOnly, page],
    queryFn: () => workspaceApi.notifications(new URLSearchParams({ page: String(page), pageSize: '25', ...(unreadOnly ? { unread: 'true' } : {}) }).toString()),
    placeholderData: keepPreviousData,
  })
  const refresh = () => qc.invalidateQueries({ queryKey: ['client', 'notifications'] })
  const readAll = useMutation({
    mutationFn: workspaceApi.markAllRead,
    onSuccess: () => void refresh(),
    onError: (err) => toast(errorMessage(err), 'error'),
  })

  const open = async (n: AppNotification) => {
    if (!n.readAt) {
      await workspaceApi.markRead(n.id).catch(() => undefined)
      void refresh()
    }
    // Links point inside the client app; anything else stays here.
    if (n.link?.startsWith('/c')) navigate(n.link)
  }
  const data = query.data

  return (
    <>
      <ClientPageHeader
        title="Notifications"
        action={
          <Button size="sm" onClick={() => readAll.mutate()} loading={readAll.isPending} aria-label="Mark all as read">
            <CheckCheck size={15} /> All read
          </Button>
        }
      />
      <div role="tablist" aria-label="Filter notifications" className="mb-4 flex gap-1">
        {[
          { label: 'All', value: false },
          { label: 'Unread', value: true },
        ].map((t) => (
          <button
            key={t.label}
            type="button"
            role="tab"
            aria-selected={unreadOnly === t.value}
            onClick={() => state.update({ unread: t.value })}
            className={cn('h-10 rounded-full px-4 text-[13px]', unreadOnly === t.value ? 'bg-white font-medium shadow-sm ring-1 ring-border-strong' : 'text-text-2 hover:bg-black/4')}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className={cn('overflow-hidden rounded-2xl border border-border bg-surface transition-opacity', query.isPlaceholderData && 'opacity-60')}>
        {query.isPending ? (
          <div className="h-64" />
        ) : query.isError ? (
          <EmptyState title="Couldn’t load notifications">{errorMessage(query.error)}</EmptyState>
        ) : data!.items.length === 0 ? (
          <EmptyState title={unreadOnly ? 'You’re all caught up' : 'No notifications yet'}>
            {unreadOnly ? 'Nothing unread.' : 'You’ll hear here when something is ready for you.'}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {data!.items.map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => void open(n)} className="flex min-h-16 w-full items-start gap-3 px-4 py-3.5 text-left hover:bg-[#f6f5f6]">
                  <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-brand')} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className={cn('flex items-center gap-1.5 text-[14px]', !n.readAt && 'font-semibold')}>
                      {n.urgent && <CircleAlert size={15} className="shrink-0 text-negative" aria-label="Urgent" />}
                      {n.title}
                    </span>
                    {n.body && <span className="mt-0.5 block text-[13px] text-text-2">{n.body}</span>}
                    <time className="mt-1 block text-xs text-text-4" title={formatDateTime(n.createdAt)}>
                      {timeAgo(n.createdAt)}
                      {!n.readAt && <span className="sr-only"> · unread</span>}
                    </time>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {data && data.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <Button disabled={page <= 1} onClick={() => state.update({ page: page - 1 })}>
            Newer
          </Button>
          <span className="text-xs text-text-3">
            Page {page} of {data.totalPages}
          </span>
          <Button disabled={page >= data.totalPages} onClick={() => state.update({ page: page + 1 })}>
            Older
          </Button>
        </div>
      )}
    </>
  )
}
