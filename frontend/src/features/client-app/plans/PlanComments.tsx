import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { MessageSquare, Send, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Field'
import { useIdempotencyKey } from '@/hooks/useIdempotencyKey'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { timeAgo } from '@/lib/format'
import { toast } from '@/lib/toast'
import { clientPlanKey, clientPlansApi, type PlanThread } from './api'

/**
 * Comments on a plan or one of its items. New ones are the person's drafts until they send them (D14), so
 * the agency gets one batch; replies in a thread the agency can already see post at once.
 */
export function PlanComments({ planId, threads, item, canComment }: { planId: string; threads: PlanThread[]; item: string | null; canComment: boolean }) {
  const mine = threads.filter((t) => (t.content ?? null) === item)
  return (
    <div className="flex flex-col gap-2.5">
      {mine.length === 0 && <p className="text-[13px] text-text-3">{canComment ? 'No comments yet.' : 'No comments.'}</p>}
      {mine.map((t) => (
        <ThreadCard key={t._id} planId={planId} thread={t} canComment={canComment} />
      ))}
      {canComment && <CommentBox planId={planId} item={item} />}
    </div>
  )
}

function ThreadCard({ planId, thread: t, canComment }: { planId: string; thread: PlanThread; canComment: boolean }) {
  const qc = useQueryClient()
  const [replying, setReplying] = useState(false)
  const [text, setText] = useState('')
  const refresh = () => void qc.invalidateQueries({ queryKey: clientPlanKey(planId) })
  const discard = useMutation({ mutationFn: () => clientPlansApi.discard(planId, t._id), onSuccess: refresh, onError: (e) => toast(errorMessage(e), 'error') })
  const reply = useMutation({
    mutationFn: () => clientPlansApi.reply(planId, t._id, text.trim()),
    onSuccess: () => {
      setText('')
      setReplying(false)
      refresh()
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  })
  const [first, ...rest] = t.messages

  return (
    <article className={cn('rounded-xl border p-3.5', t.draft ? 'border-dashed border-amber-dot/50 bg-[#fffaf2]' : 'border-border bg-white')}>
      <div className="flex items-center gap-2 text-xs text-text-3">
        <span className="font-semibold text-text">{t.author.side === 'agency' ? `${t.author.name} · agency` : t.author.name}</span>
        <span>{t.draft ? 'Not sent yet' : timeAgo(t.submittedAt ?? t.createdAt)}</span>
        {t.status === 'resolved' && <span className="text-positive">Resolved</span>}
      </div>
      {first && <p className="mt-1.5 text-[14px] whitespace-pre-line">{first.body}</p>}
      {rest.length > 0 && (
        <ul className="mt-2.5 flex flex-col gap-2 border-l-2 border-border-strong pl-3">
          {rest.map((m) => (
            <li key={m._id} className="text-[13px]">
              <span className="font-medium">{m.author.name}</span> <span className="text-xs text-text-4">{timeAgo(m.createdAt)}</span>
              <p className="whitespace-pre-line text-text-2">{m.body}</p>
            </li>
          ))}
        </ul>
      )}
      {t.draft ? (
        <button type="button" onClick={() => discard.mutate()} disabled={discard.isPending} className="mt-2 inline-flex h-9 items-center gap-1.5 text-xs font-medium text-negative">
          <Trash2 size={14} /> Discard
        </button>
      ) : (
        canComment &&
        (replying ? (
          <form
            className="mt-2.5 flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (text.trim()) reply.mutate()
            }}
          >
            <Textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} maxLength={5000} placeholder="Write a reply" className="min-h-16" />
            <div className="flex justify-end gap-2">
              <Button onClick={() => setReplying(false)}>Cancel</Button>
              <Button type="submit" variant="primary" loading={reply.isPending} disabled={!text.trim()}>
                Reply
              </Button>
            </div>
          </form>
        ) : (
          <button type="button" onClick={() => setReplying(true)} className="mt-2 inline-flex h-9 items-center gap-1.5 text-xs font-medium text-brand">
            <MessageSquare size={14} /> Reply
          </button>
        ))
      )}
    </article>
  )
}

function CommentBox({ planId, item }: { planId: string; item: string | null }) {
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const idem = useIdempotencyKey()
  const add = useMutation({
    mutationFn: () => clientPlansApi.comment(planId, { body: text.trim(), ...(item ? { item } : {}) }, idem.key),
    onSuccess: () => {
      setText('')
      idem.renew()
      void qc.invalidateQueries({ queryKey: clientPlanKey(planId) })
    },
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (text.trim()) add.mutate()
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <Textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={5000} placeholder={item ? 'Comment on this item' : 'Comment on the whole plan'} aria-label="New comment" className="min-h-16" />
      {add.isError && <p className="text-xs text-negative">{errorMessage(add.error)}</p>}
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-text-4">Saved as a draft until you send your comments.</span>
        <Button type="submit" loading={add.isPending} disabled={!text.trim()}>
          <Send size={14} /> Add
        </Button>
      </div>
    </form>
  )
}
