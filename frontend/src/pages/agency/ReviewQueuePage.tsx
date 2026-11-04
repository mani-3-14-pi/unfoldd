import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { LucideIcon } from 'lucide-react'
import { CalendarClock, ClipboardCheck, Hourglass, Send, ThumbsDown } from 'lucide-react'
import { Link } from 'react-router'
import { PageHeader } from '@/components/PageHeader'
import { Card, EmptyState } from '@/components/ui/Card'
import { useAgencySession } from '@/features/agency/session'
import { clientsApi } from '@/features/clients/api'
import { contentApi, type QueueItem, type Queues } from '@/features/content/api'
import { errorMessage } from '@/lib/errors'
import { formatDate, timeAgo } from '@/lib/format'

const SECTIONS: { key: keyof Queues; title: string; hint: string; icon: LucideIcon; publishOnly?: boolean }[] = [
  { key: 'awaitingReview', title: 'Waiting for internal review', hint: 'Approve before the client sees it.', icon: ClipboardCheck },
  { key: 'readyForClient', title: 'Ready to send', hint: 'Approved internally, not yet with the client.', icon: Send },
  { key: 'changesRequested', title: 'Changes requested', hint: 'The client asked for changes: upload the next version or reply.', icon: ThumbsDown },
  { key: 'awaitingClient', title: 'Waiting on the client', hint: 'Sent for review, oldest first.', icon: Hourglass },
  { key: 'readyToSchedule', title: 'Ready to schedule', hint: 'Approved by the client, not yet scheduled.', icon: CalendarClock, publishOnly: true },
]

/** P81 approval queue and P115 "Ready to schedule": everything waiting on someone, longest-waiting first. */
export function ReviewQueuePage() {
  const s = useAgencySession()
  const queues = useQuery({ queryKey: ['agency', 'content', 'queues'], queryFn: contentApi.queues, refetchInterval: 60_000 })
  const clients = useQuery({ queryKey: ['agency', 'clients', 'list', 'picker'], queryFn: () => clientsApi.list('pageSize=100&sort=name') })
  const brand = (id: string) => clients.data?.items.find((c) => c._id === id)?.brandName ?? ''
  // One clock for the page, so "waiting" ages don't jump around between renders.
  const [now] = useState(() => Date.now())

  return (
    <>
      <PageHeader
        title="Review"
        description={s.role === 'member' ? 'Work waiting on you or the client. Internal review shows what you’re the reviewer for.' : 'Work waiting on your team or on clients, longest-waiting first.'}
      />
      {queues.isPending ? (
        <div className="h-64" />
      ) : queues.isError ? (
        <EmptyState title="Couldn’t load the queues">{errorMessage(queues.error)}</EmptyState>
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          {SECTIONS.map(({ key, title, hint, icon: Icon, publishOnly }) => {
            const items = queues.data[key]
            return (
              <Card
                key={key}
                title={title}
                description={publishOnly && !s.canPublish ? `${hint} Someone who can publish schedules these.` : hint}
                action={<span className="grid h-7 min-w-7 place-items-center rounded-full bg-surface-input px-2 text-xs font-medium">{items.length}</span>}
              >
                {items.length === 0 ? (
                  <div className="flex items-center gap-2 px-5 py-6 text-[13px] text-text-3">
                    <Icon size={16} /> Nothing waiting.
                  </div>
                ) : (
                  <ul className="divide-y divide-border">
                    {items.map((i) => (
                      <QueueRow key={i._id} item={i} brand={brand(i.client)} now={now} />
                    ))}
                  </ul>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </>
  )
}

function QueueRow({ item: i, brand, now }: { item: QueueItem; brand: string; now: number }) {
  const days = (now - new Date(i.stateChangedAt).getTime()) / 86_400_000
  return (
    <li>
      <Link to={`/app/content/${i._id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-[#f6f5f6]">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold">{i.title}</span>
          <span className="block truncate text-xs text-text-3">
            {brand}
            {i.publishDate && ` · publishes ${formatDate(i.publishDate)}`}
          </span>
        </span>
        <span className={days >= 3 ? 'text-xs font-medium text-amber-ink' : 'text-xs text-text-3'}>waiting {timeAgo(i.stateChangedAt).replace(' ago', '')}</span>
      </Link>
    </li>
  )
}
