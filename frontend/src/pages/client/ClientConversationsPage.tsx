import { useQuery } from '@tanstack/react-query'
import { ChevronRight, LoaderCircle, MessagesSquare } from 'lucide-react'
import { Link } from 'react-router'
import { EmptyState } from '@/components/ui/Card'
import { useClientSession } from '@/features/agency/session'
import { clientConversationsApi } from '@/features/client-app/conversations/api'
import { conversationTitle } from '@/features/client-app/conversations/labels'
import { errorMessage } from '@/lib/errors'
import { timeAgo } from '@/lib/format'

/**
 * F66 messages: the General thread with the agency first (D18, "Contact agency" opens it, D67), then the
 * conversations attached to content, plans, requests and meetings. Only client-visible threads exist here (D20).
 */
export function ClientConversationsPage() {
  const s = useClientSession()
  const list = useQuery({ queryKey: ['client', 'conversations'], queryFn: clientConversationsApi.list, refetchInterval: 60_000 })

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="font-serif text-[32px] leading-tight text-brand">Messages</h1>
        <p className="mt-1 text-[14px] text-text-2">Talk to the people at {s.agency.name} making your content.</p>
      </header>
      {list.isPending ? (
        <div className="grid place-items-center py-16 text-text-3">
          <LoaderCircle className="animate-spin" />
        </div>
      ) : list.isError ? (
        <EmptyState title="Couldn’t load messages">{errorMessage(list.error)}</EmptyState>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-2xl border border-border bg-white">
          {list.data.items.map((c) => (
            <li key={c.id}>
              <Link to={`/c/conversations/${c.id}`} className="flex items-center gap-3 px-4 py-4 hover:bg-surface">
                <span className="grid size-11 shrink-0 place-items-center rounded-full bg-green-soft text-green-ink">
                  <MessagesSquare size={19} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[15px] font-semibold">{conversationTitle(c, s.agency.name)}</span>
                    {c.lastMessageAt && <span className="shrink-0 text-[11px] text-text-4">{timeAgo(c.lastMessageAt)}</span>}
                  </span>
                  <span className="block truncate text-[13px] text-text-3">{c.last ? `${c.last.author.name}: ${c.last.body || 'Attachment'}` : 'No messages yet. Say hello.'}</span>
                </span>
                <ChevronRight size={17} className="shrink-0 text-text-4" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
