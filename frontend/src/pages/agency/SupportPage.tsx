import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LifeBuoy, Plus, Send } from 'lucide-react'
import { useSearchParams } from 'react-router'
import { Pagination } from '@/components/list/Pagination'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card, EmptyState } from '@/components/ui/Card'
import { Textarea } from '@/components/ui/Field'
import { supportApi } from '@/features/support/api'
import { categoryLabel } from '@/features/support/labels'
import { NewTicketDialog } from '@/features/support/NewTicketDialog'
import { TicketStatusPill } from '@/features/support/pills'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { formatDateTime, timeAgo } from '@/lib/format'
import { toast } from '@/lib/toast'

/** P161–P163: your tickets to the Unfoldd team. Pick one to read the conversation and reply. */
export function SupportPage() {
  const [params, setParams] = useSearchParams()
  const qc = useQueryClient()
  const [creating, setCreating] = useState(false)
  const page = Number(params.get('page') ?? 1)
  const selected = params.get('ticket')
  const select = (id: string | null) => setParams((p) => ({ ...Object.fromEntries(p), ...(id ? { ticket: id } : {}) }), { replace: true })

  const list = useQuery({
    queryKey: ['agency', 'support', 'list', page],
    queryFn: () => supportApi.list(new URLSearchParams({ page: String(page), pageSize: '25' }).toString()),
    placeholderData: keepPreviousData,
  })
  const current = selected ?? list.data?.items[0]?._id ?? null

  return (
    <>
      <PageHeader
        title="Support"
        description="Questions, problems and ideas for the Unfoldd team. Replies arrive here and by email."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus size={16} /> New ticket
          </Button>
        }
      />
      {list.isPending ? (
        <div className="h-48" />
      ) : list.isError ? (
        <EmptyState title="Couldn’t load your tickets">{errorMessage(list.error)}</EmptyState>
      ) : list.data.items.length === 0 ? (
        <EmptyState
          title="No tickets yet"
          action={
            <Button variant="primary" onClick={() => setCreating(true)}>
              <LifeBuoy size={16} /> Contact support
            </Button>
          }
        >
          Something broken, or a question about Unfoldd? We’re here.
        </EmptyState>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <Card>
            <ul className="divide-y divide-border">
              {list.data.items.map((t) => (
                <li key={t._id}>
                  <button
                    type="button"
                    onClick={() => select(t._id)}
                    aria-current={t._id === current ? 'true' : undefined}
                    className={cn('flex w-full items-start gap-3 px-5 py-3 text-left', t._id === current ? 'bg-surface-input' : 'hover:bg-[#f6f5f6]')}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold">{t.subject}</span>
                      <span className="block text-xs text-text-3">
                        {categoryLabel[t.category]} · {timeAgo(t.lastMessageAt)}
                      </span>
                    </span>
                    <TicketStatusPill status={t.status} />
                  </button>
                </li>
              ))}
            </ul>
            {list.data.total > list.data.pageSize && (
              <Pagination {...list.data} noun="tickets" onPage={(p) => setParams({ page: String(p) }, { replace: true })} onPageSize={() => undefined} />
            )}
          </Card>
          {current && <TicketThread id={current} />}
        </div>
      )}
      {creating && (
        <NewTicketDialog
          onClose={() => setCreating(false)}
          onCreated={(t) => {
            setCreating(false)
            toast('Sent to Unfoldd support')
            void qc.invalidateQueries({ queryKey: ['agency', 'support'] })
            select(t._id)
          }}
        />
      )}
    </>
  )
}

function TicketThread({ id }: { id: string }) {
  const qc = useQueryClient()
  const key = ['agency', 'support', 'ticket', id]
  const ticket = useQuery({ queryKey: key, queryFn: () => supportApi.get(id) })
  const [body, setBody] = useState('')
  const reply = useMutation({
    mutationFn: () => supportApi.reply(id, body.trim()),
    onSuccess: (data) => {
      setBody('')
      qc.setQueryData(key, data)
      void qc.invalidateQueries({ queryKey: ['agency', 'support', 'list'] })
    },
  })

  if (ticket.isPending) return <Card><div className="h-48" /></Card>
  if (ticket.isError) return <EmptyState title="Couldn’t open this ticket">{errorMessage(ticket.error)}</EmptyState>
  const t = ticket.data.ticket
  return (
    <Card title={t.subject} description={`${categoryLabel[t.category]} · opened ${formatDateTime(t.createdAt)}`} action={<TicketStatusPill status={t.status} />}>
      <ol className="flex flex-col gap-3 px-5 py-4">
        {t.messages.map((m, i) => (
          <li key={i} className={cn('max-w-[85%] rounded-xl px-4 py-3', m.from === 'support' ? 'self-start bg-green-soft' : 'self-end bg-surface-input')}>
            <div className="text-xs text-text-3">
              {m.from === 'support' ? `${m.author.name} · Unfoldd support` : 'You'} · {timeAgo(m.at)}
            </div>
            <p className="mt-1 text-[13px] whitespace-pre-line">{m.body}</p>
          </li>
        ))}
      </ol>
      <form
        className="flex flex-col gap-2 border-t border-border px-5 py-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (body.trim()) reply.mutate()
        }}
      >
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={10_000} placeholder={t.status === 'resolved' ? 'Reply to reopen this ticket…' : 'Reply…'} aria-label="Reply" />
        <div className="flex items-center justify-end gap-3">
          {reply.isError && <span className="mr-auto text-[13px] text-negative">{errorMessage(reply.error)}</span>}
          <Button type="submit" variant="primary" loading={reply.isPending} disabled={!body.trim()}>
            <Send size={14} /> Reply
          </Button>
        </div>
      </form>
    </Card>
  )
}
