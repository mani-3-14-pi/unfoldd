import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, LoaderCircle, Send } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/Card'
import { Textarea } from '@/components/ui/Field'
import { useClientSession } from '@/features/agency/session'
import { clientConversationsApi } from '@/features/client-app/conversations/api'
import { useClientSpace } from '@/features/client-app/space'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { formatDateTime, timeAgo } from '@/lib/format'
import { conversationTitle } from '@/features/client-app/conversations/labels'

/** F67: one conversation, 50 messages at a time (older ones on demand), with a composer for those who may post. */
export function ClientConversationPage() {
  const { id = '' } = useParams()
  const s = useClientSession()
  const space = useClientSpace()
  const qc = useQueryClient()
  const [body, setBody] = useState('')
  const bottom = useRef<HTMLDivElement>(null)
  const list = useQuery({ queryKey: ['client', 'conversations'], queryFn: clientConversationsApi.list })
  const conversation = list.data?.items.find((c) => c.id === id)
  const key = ['client', 'conversations', id, 'messages']

  const messages = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => clientConversationsApi.messages(id, pageParam),
    initialPageParam: undefined as string | undefined,
    // Pages go backwards in time: the next "page" is everything before the oldest message we have.
    getNextPageParam: (last) => (last.items.length === 50 ? last.items[0]?.createdAt : undefined),
    refetchInterval: 30_000,
  })
  const all = [...(messages.data?.pages ?? [])].reverse().flatMap((p) => p.items)
  const newest = all.at(-1)?._id

  // Keep the latest message in view as messages arrive.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [newest])

  const post = useMutation({
    mutationFn: () => clientConversationsApi.post(id, body.trim()),
    onSuccess: () => {
      setBody('')
      void qc.invalidateQueries({ queryKey: key })
      void qc.invalidateQueries({ queryKey: ['client', 'conversations'], exact: true })
    },
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (body.trim()) post.mutate()
  }
  const canPost = !!space.data?.can.feedback

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link to="/c/conversations" className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-text-3 hover:text-text">
          <ArrowLeft size={15} /> Messages
        </Link>
        <h1 className="text-xl font-semibold">{conversation ? conversationTitle(conversation, s.agency.name) : 'Conversation'}</h1>
      </div>

      {messages.isPending ? (
        <div className="grid place-items-center py-16 text-text-3">
          <LoaderCircle className="animate-spin" />
        </div>
      ) : messages.isError ? (
        <EmptyState title="Couldn’t load this conversation">{errorMessage(messages.error)}</EmptyState>
      ) : (
        <div className="flex flex-col gap-3">
          {messages.hasNextPage && (
            <Button size="sm" className="self-center" loading={messages.isFetchingNextPage} onClick={() => void messages.fetchNextPage()}>
              Show earlier messages
            </Button>
          )}
          {all.length === 0 && <p className="py-10 text-center text-[14px] text-text-3">No messages yet. Ask your agency anything.</p>}
          <ol className="flex flex-col gap-3">
            {all.map((m) => {
              const mine = m.author.id === s.user.id
              return (
                <li key={m._id} className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}>
                  <span className="mb-0.5 px-1 text-[11px] text-text-4">
                    {mine ? 'You' : `${m.author.name}${m.author.side === 'agency' ? ` · ${s.agency.name}` : ''}`} · <time title={formatDateTime(m.createdAt)}>{timeAgo(m.createdAt)}</time>
                  </span>
                  <p className={cn('max-w-[85%] rounded-2xl px-4 py-2.5 text-[14px] whitespace-pre-line', mine ? 'rounded-br-md bg-brand text-white' : 'rounded-bl-md border border-border bg-white')}>{m.body || 'Attachment'}</p>
                </li>
              )
            })}
          </ol>
          <div ref={bottom} />
        </div>
      )}

      {canPost ? (
        <form onSubmit={submit} className="sticky bottom-20 z-10 flex items-end gap-2 rounded-2xl border border-border-strong bg-white p-2 shadow-lg">
          <Textarea
            aria-label="Message"
            value={body}
            maxLength={5000}
            placeholder={`Message ${s.agency.name}…`}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && body.trim()) {
                e.preventDefault()
                post.mutate()
              }
            }}
            className="min-h-11 flex-1 border-0 text-[15px] focus:ring-0"
          />
          <Button type="submit" variant="primary" className="h-11 w-11 shrink-0 px-0" aria-label="Send" loading={post.isPending} disabled={!body.trim()}>
            {!post.isPending && <Send size={17} />}
          </Button>
        </form>
      ) : (
        <p className="text-center text-xs text-text-3">Your role can read messages but not post.</p>
      )}
      {post.isError && <p className="text-[13px] text-negative">{errorMessage(post.error)}</p>}
    </div>
  )
}
