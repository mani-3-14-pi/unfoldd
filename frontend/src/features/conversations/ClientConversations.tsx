import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Lock, MessageSquare, Send } from 'lucide-react'
import { useParams } from 'react-router'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/Card'
import { Textarea } from '@/components/ui/Field'
import type { ClientDetail } from '@/features/clients/api'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { formatDateTime, timeAgo } from '@/lib/format'
import { conversationsApi, conversationsKey, type ContextType, type Conversation } from './api'

const contextLabel: Record<ContextType, string> = {
  client_general: 'General',
  content: 'Content',
  content_plan: 'Content plan',
  campaign: 'Campaign',
  task: 'Task',
  meeting: 'Meeting',
  request: 'Request',
}

const title = (c: Conversation) => (c.context.type === 'client_general' ? (c.visibility === 'internal' ? 'Team notes' : 'General') : `${contextLabel[c.context.type]} discussion`)

/**
 * Conversations with the client and among the team (P110–P114): one General thread each, plus discussions on
 * content, campaigns, meetings … Internal threads look different and the client never sees them (D20).
 * Notification links open `/app/clients/:id/conversations/:threadId`, so the thread can come from the URL.
 */
export function ClientConversations({ client }: { client: ClientDetail }) {
  const { threadId } = useParams()
  const list = useQuery({ queryKey: conversationsKey(client._id), queryFn: () => conversationsApi.list(client._id), refetchInterval: 30_000 })
  const [picked, setPicked] = useState<string | null>(null)

  if (list.isPending) return <div className="h-64" />
  if (list.isError) return <EmptyState title="Couldn’t load conversations">{errorMessage(list.error)}</EmptyState>

  const items = list.data.items
  const active = items.find((c) => c.id === (picked ?? threadId)) ?? items.find((c) => c.context.type === 'client_general' && c.visibility === 'client') ?? items[0]
  const groups = [
    { label: 'With the client', items: items.filter((c) => c.visibility === 'client') },
    { label: 'Team only', items: items.filter((c) => c.visibility === 'internal') },
  ]

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <nav aria-label="Conversations" className="flex flex-col gap-4">
        {groups.map((g) => (
          <div key={g.label} className="flex flex-col gap-1">
            <h3 className="mb-1 flex items-center gap-1.5 px-2 text-[11px] font-semibold tracking-wide text-text-3 uppercase">
              {g.label === 'Team only' && <Lock size={11} />} {g.label}
            </h3>
            {g.items.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setPicked(c.id)}
                aria-current={c.id === active?.id ? 'true' : undefined}
                className={cn(
                  'flex flex-col rounded-lg px-3 py-2 text-left',
                  c.id === active?.id ? (c.visibility === 'internal' ? 'bg-indigo-soft' : 'bg-white shadow-sm ring-1 ring-border-strong') : 'hover:bg-black/4',
                )}
              >
                <span className="flex items-center justify-between gap-2 text-[13px] font-medium">
                  {title(c)}
                  {c.lastMessageAt && <span className="text-[11px] font-normal text-text-4">{timeAgo(c.lastMessageAt)}</span>}
                </span>
                <span className="truncate text-xs text-text-3">{c.last ? `${c.last.author.name}: ${c.last.body || 'Voice note'}` : 'No messages yet'}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>
      {active ? <Thread key={active.id} clientId={client._id} conversation={active} writable={client.status !== 'archived'} /> : <EmptyState title="No conversations" />}
    </div>
  )
}

function Thread({ clientId, conversation: c, writable }: { clientId: string; conversation: Conversation; writable: boolean }) {
  const qc = useQueryClient()
  const internal = c.visibility === 'internal'
  const key = [...conversationsKey(clientId), c.id, 'messages']
  const messages = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => conversationsApi.messages(clientId, c.id, pageParam),
    initialPageParam: undefined as string | undefined,
    // A full page of 50 means there may be older ones.
    getNextPageParam: (last) => (last.items.length === 50 ? last.items[0]?.createdAt : undefined),
    refetchInterval: 20_000,
  })
  const [body, setBody] = useState('')
  const bottom = useRef<HTMLDivElement>(null)
  const all = [...(messages.data?.pages ?? [])].reverse().flatMap((p) => p.items)
  const lastId = all.at(-1)?._id

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'nearest' })
  }, [lastId])

  const post = useMutation({
    mutationFn: () => conversationsApi.post(clientId, c.id, body.trim()),
    onSuccess: () => {
      setBody('')
      void qc.invalidateQueries({ queryKey: conversationsKey(clientId) })
    },
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (body.trim()) post.mutate()
  }

  return (
    <section className={cn('flex min-h-[28rem] flex-col rounded-xl border', internal ? 'border-indigo-soft bg-[#faf9ff]' : 'border-border bg-surface')}>
      <header className="flex items-center gap-2 border-b border-border px-5 py-3.5">
        {internal ? <Lock size={15} className="text-indigo-ink" /> : <MessageSquare size={15} className="text-text-3" />}
        <h2 className="text-sm font-semibold">{title(c)}</h2>
        <span className="text-xs text-text-3">{internal ? '· your team only' : '· shared with the client'}</span>
      </header>

      <div className="flex max-h-[55vh] flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
        {messages.hasNextPage && (
          <Button size="sm" variant="ghost" className="self-center" loading={messages.isFetchingNextPage} onClick={() => void messages.fetchNextPage()}>
            Load earlier messages
          </Button>
        )}
        {messages.isPending ? (
          <div className="h-24" />
        ) : messages.isError ? (
          <p className="text-[13px] text-negative">{errorMessage(messages.error)}</p>
        ) : all.length === 0 ? (
          <p className="m-auto text-[13px] text-text-3">{internal ? 'Notes for your team about this client.' : 'Start the conversation. The client can reply here.'}</p>
        ) : (
          all.map((m) => (
            <article key={m._id} className={cn('flex max-w-[85%] flex-col gap-0.5', m.author.side === 'client' ? 'self-start' : 'self-end items-end')}>
              <span className="text-[11px] text-text-4">
                {m.author.name} · {m.author.side === 'client' ? 'client' : 'team'} · <time title={formatDateTime(m.createdAt)}>{timeAgo(m.createdAt)}</time>
              </span>
              <p
                className={cn(
                  'rounded-2xl px-3.5 py-2 text-[13px] whitespace-pre-line',
                  m.author.side === 'client' ? 'bg-white ring-1 ring-border-strong' : internal ? 'bg-indigo-ink text-white' : 'bg-brand text-white',
                )}
              >
                {m.body || (m.voice?.file ? 'Voice note' : '')}
              </p>
            </article>
          ))
        )}
        <div ref={bottom} />
      </div>

      {writable && (
        <form onSubmit={submit} className={cn('flex flex-col gap-2 border-t p-3', internal ? 'border-indigo-soft' : 'border-border')}>
          <span className={cn('flex items-center gap-1.5 text-[11px] font-semibold tracking-wide uppercase', internal ? 'text-indigo-ink' : 'text-text-3')}>
            {internal ? (
              <>
                <Lock size={12} /> Internal · never shown to the client
              </>
            ) : (
              <>
                <MessageSquare size={12} /> To the client
              </>
            )}
          </span>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={5000}
            placeholder={internal ? 'Note for your team…' : 'Write to the client…'}
            aria-label={internal ? 'Internal message' : 'Message to the client'}
            className="min-h-16"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e)
            }}
          />
          {post.isError && <p className="text-xs text-negative">{errorMessage(post.error)}</p>}
          <div className="flex justify-end">
            {internal ? (
              <button
                type="submit"
                disabled={!body.trim() || post.isPending}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-indigo-ink px-3 text-xs font-medium text-white hover:enabled:bg-[#3d39a8] disabled:opacity-55"
              >
                <Lock size={13} /> Post note
              </button>
            ) : (
              <Button size="sm" variant="primary" type="submit" loading={post.isPending} disabled={!body.trim()}>
                <Send size={13} /> Send
              </Button>
            )}
          </div>
        </form>
      )}
    </section>
  )
}
