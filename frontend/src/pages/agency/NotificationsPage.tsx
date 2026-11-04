import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCheck, CircleAlert } from 'lucide-react'
import { useNavigate } from 'react-router'
import { Pagination } from '@/components/list/Pagination'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/Card'
import { notificationCategoryLabel, workspaceApi, type AppNotification } from '@/features/workspace/api'
import { apiQuery, useListState } from '@/hooks/useListState'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { formatDateTime, timeAgo } from '@/lib/format'
import { toast } from '@/lib/toast'

/**
 * P145–P147: the notification centre. Opening one marks it read and follows its link; the page it opens
 * always shows the current state (D51), so an old notification never leads to an error.
 */
export function NotificationsPage() {
  const state = useListState()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const unreadOnly = state.get('unread') === 'true'

  const query = useQuery({
    queryKey: ['agency', 'notifications', 'list', apiQuery(state.params)],
    queryFn: () => workspaceApi.notifications(apiQuery(state.params)),
    placeholderData: keepPreviousData,
  })
  const data = query.data
  const refresh = () => qc.invalidateQueries({ queryKey: ['agency', 'notifications'] })

  const readAll = useMutation({
    mutationFn: workspaceApi.markAllRead,
    onSuccess: ({ updated }) => {
      toast(updated ? `Marked ${updated} as read` : 'Nothing unread')
      void refresh()
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  })

  const open = async (n: AppNotification) => {
    if (!n.readAt) {
      await workspaceApi.markRead(n.id).catch(() => undefined)
      void refresh()
    }
    if (n.link) navigate(n.link)
  }

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Things that happened on your clients and your team."
        actions={
          <Button onClick={() => readAll.mutate()} loading={readAll.isPending}>
            <CheckCheck size={16} /> Mark all as read
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
            className={cn(
              'h-9 rounded-full px-3.5 text-xs',
              unreadOnly === t.value ? 'bg-white font-medium shadow-sm ring-1 ring-border-strong' : 'text-[#2d2c34] hover:bg-black/4',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className={cn('rounded-xl border border-border bg-surface transition-opacity', query.isPlaceholderData && 'opacity-60')}>
        {query.isPending ? (
          <div className="h-64" />
        ) : query.isError ? (
          <EmptyState title="Couldn’t load notifications">{errorMessage(query.error)}</EmptyState>
        ) : data!.items.length === 0 ? (
          <EmptyState title={unreadOnly ? 'You’re all caught up' : 'No notifications yet'}>
            {unreadOnly ? 'Nothing unread.' : 'You’ll hear here when clients act, people join, or work needs you.'}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {data!.items.map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => void open(n)} className="flex w-full items-start gap-3 px-5 py-3.5 text-left hover:bg-[#f6f5f6]">
                  <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-brand')} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className={cn('flex items-center gap-1.5 text-[13px]', !n.readAt && 'font-semibold')}>
                      {n.urgent && <CircleAlert size={14} className="shrink-0 text-negative" aria-label="Urgent" />}
                      {n.title}
                    </span>
                    {n.body && <span className="mt-0.5 block text-[13px] text-text-2">{n.body}</span>}
                    <span className="mt-1 block text-xs text-text-4">
                      {notificationCategoryLabel[n.category]?.label ?? n.category} · <time title={formatDateTime(n.createdAt)}>{timeAgo(n.createdAt)}</time>
                      {!n.readAt && <span className="sr-only"> · unread</span>}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {data && data.total > 0 && (
          <Pagination
            {...data}
            noun="notifications"
            onPage={(page) => state.update({ page })}
            onPageSize={(pageSize) => state.update({ pageSize: pageSize === 25 ? null : pageSize })}
          />
        )}
      </div>
    </>
  )
}
