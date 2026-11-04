import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, CornerDownRight, MessageSquare, PenLine, RotateCcw, Send, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Field'
import type { Anchor, Thread } from '@/features/content/api'
import { formatTime, pinLabel, versionLabel } from '@/features/content/labels'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { timeAgo } from '@/lib/format'
import { toast } from '@/lib/toast'
import { clientContentApi, clientThreadsKey, type ClientContentDetail } from './api'
import { REOPENABLE } from './labels'

/** Where a comment points: "slide 2 · 0:17". */
function where(t: Thread, slides: Record<string, number>) {
  const parts: string[] = []
  const slide = t.anchor?.versionFile ? slides[t.anchor.versionFile] : undefined
  if (slide !== undefined) parts.push(`slide ${slide + 1}`)
  if (t.anchor?.timeMs != null) parts.push(formatTime(t.anchor.timeMs))
  return parts.join(' · ')
}

const statusText = (t: Thread) =>
  t.status === 'resolved' ? 'Resolved' : t.status === 'in_progress' ? 'In progress' : t.reopenedAt ? 'Reopened' : 'Open'
const statusClass = (t: Thread) =>
  t.status === 'resolved' ? 'bg-green-soft text-green-ink' : t.status === 'in_progress' ? 'bg-blue-soft text-blue-ink' : 'bg-amber-soft text-amber-ink'

/**
 * The client's side of feedback (F24–F37). New comments are drafts in the person's pending review (D14): only
 * they see them, and they can edit or discard them until they send feedback or decide. Replies to existing
 * threads post at once.
 */
export function ReviewFeedback({
  content: c,
  threads,
  canFeedback,
  selected,
  onSelect,
  annotating,
  onAnnotate,
  draft,
  onClearDraft,
}: {
  content: ClientContentDetail
  threads: Thread[]
  /** The person's role may comment at all (viewers can't). */
  canFeedback: boolean
  selected: string | null
  onSelect: (id: string | null) => void
  annotating: boolean
  onAnnotate: (on: boolean) => void
  draft: Anchor | null
  onClearDraft: () => void
}) {
  const current = c.version?.isCurrent ? c.version._id : null
  const slides = Object.fromEntries((c.version?.files ?? []).map((f, i) => [f.id, i]))
  const drafts = threads.filter((t) => t.draft)
  const submitted = threads.filter((t) => !t.draft)
  const open = submitted.filter((t) => t.status !== 'resolved')
  const resolved = submitted.filter((t) => t.status === 'resolved')
  const [showResolved, setShowResolved] = useState(false)

  return (
    <section className="flex flex-col gap-4" aria-label="Feedback">
      {drafts.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold tracking-wide text-text-3 uppercase">Your unsent comments · {drafts.length}</h2>
          <p className="-mt-1 text-xs text-text-4">Only you can see these until you send feedback or make a decision.</p>
          {drafts.map((t) => (
            <DraftCard key={t._id} content={c} thread={t} currentVersion={current} slides={slides} />
          ))}
        </div>
      )}

      {c.can.comment && (
        <Composer content={c} annotating={annotating} onAnnotate={onAnnotate} draft={draft} onClearDraft={onClearDraft} slides={slides} />
      )}

      <div className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold tracking-wide text-text-3 uppercase">Feedback {open.length > 0 && `· ${open.length} open`}</h2>
        {open.length === 0 && resolved.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border-strong px-4 py-6 text-center text-[13px] text-text-3">
            {c.can.comment ? 'No feedback yet. Tap the creative or write a comment above.' : 'No feedback yet.'}
          </p>
        ) : (
          open.map((t) => (
            <ThreadCard key={t._id} content={c} thread={t} slides={slides} canFeedback={canFeedback} active={t._id === selected} onSelect={() => onSelect(t._id === selected ? null : t._id)} />
          ))
        )}
        {resolved.length > 0 && (
          <>
            <button type="button" onClick={() => setShowResolved((v) => !v)} className="self-start py-2 text-[13px] font-medium text-brand">
              {showResolved ? 'Hide resolved' : `Show ${resolved.length} resolved`}
            </button>
            {showResolved &&
              resolved.map((t) => (
                <ThreadCard key={t._id} content={c} thread={t} slides={slides} canFeedback={canFeedback} active={t._id === selected} onSelect={() => onSelect(t._id === selected ? null : t._id)} />
              ))}
          </>
        )}
      </div>
    </section>
  )
}

function Composer({
  content: c,
  annotating,
  onAnnotate,
  draft,
  onClearDraft,
  slides,
}: {
  content: ClientContentDetail
  annotating: boolean
  onAnnotate: (on: boolean) => void
  draft: Anchor | null
  onClearDraft: () => void
  slides: Record<string, number>
}) {
  const qc = useQueryClient()
  const [body, setBody] = useState('')
  const add = useMutation({
    mutationFn: () => clientContentApi.addDraft(c.id, { versionId: c.version!._id, body: body.trim(), ...(draft?.shapes?.length ? { anchor: draft } : {}) }),
    onSuccess: () => {
      setBody('')
      onClearDraft()
      onAnnotate(false)
      void qc.invalidateQueries({ queryKey: clientThreadsKey(c.id) })
    },
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (body.trim()) add.mutate()
  }
  const slide = draft?.versionFile ? slides[draft.versionFile] : undefined

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 rounded-xl border border-border-strong bg-white p-3">
      {draft?.shapes?.length ? (
        <span className="flex items-center gap-2 self-start rounded-full bg-surface-input px-3 py-1.5 text-xs text-text-2">
          <PenLine size={13} /> Pointing at {slide !== undefined && (c.version?.files.length ?? 0) > 1 ? `slide ${slide + 1}` : 'the creative'}
          {draft.timeMs != null && ` at ${formatTime(draft.timeMs)}`}
          <button type="button" aria-label="Remove drawing" onClick={onClearDraft} className="grid size-5 place-items-center text-text-4">
            <X size={13} />
          </button>
        </span>
      ) : null}
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} placeholder="What would you like changed?" aria-label="Your comment" className="min-h-20 text-[15px]" />
      {add.isError && <p className="text-xs text-negative">{errorMessage(add.error)}</p>}
      <div className="flex items-center justify-between gap-2">
        <Button variant={annotating ? 'primary' : 'secondary'} onClick={() => onAnnotate(!annotating)} aria-pressed={annotating} className="h-10">
          <PenLine size={15} /> {annotating ? 'Drawing…' : 'Draw on it'}
        </Button>
        <Button type="submit" variant="primary" loading={add.isPending} disabled={!body.trim()} className="h-10">
          <MessageSquare size={15} /> Add comment
        </Button>
      </div>
      <p className="text-[11px] text-text-4">Comments are saved as drafts. The agency gets them all at once when you send feedback, approve or request changes.</p>
    </form>
  )
}

function DraftCard({ content: c, thread: t, currentVersion, slides }: { content: ClientContentDetail; thread: Thread; currentVersion: string | null; slides: Record<string, number> }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [body, setBody] = useState(t.messages[0]?.body ?? '')
  const refresh = () => void qc.invalidateQueries({ queryKey: clientThreadsKey(c.id) })
  const onError = (err: unknown) => toast(errorMessage(err), 'error')
  const stale = !!currentVersion && t.version !== currentVersion
  const currentNumber = c.version?.number

  const save = useMutation({
    mutationFn: () => clientContentApi.editDraft(c.id, t._id, { body: body.trim() }),
    onSuccess: () => {
      setEditing(false)
      refresh()
    },
    onError,
  })
  const discard = useMutation({ mutationFn: () => clientContentApi.discardDraft(c.id, t._id), onSuccess: refresh, onError })
  const copy = useMutation({
    mutationFn: () => clientContentApi.copyToCurrent(c.id, t._id),
    onSuccess: () => {
      toast(`Copied to ${currentNumber ? versionLabel(currentNumber) : 'the current version'}`)
      refresh()
    },
    onError,
  })

  return (
    <article className={cn('rounded-xl border border-dashed p-3', stale ? 'border-amber-dot/40 bg-[#fdf8f1]' : 'border-border-strong bg-white')}>
      {stale && (
        <p className="mb-2 text-xs text-amber-ink">
          Written on {t.versionNumber ? versionLabel(t.versionNumber) : 'an older version'}, which was replaced{currentNumber ? ` by ${versionLabel(currentNumber)}` : ''}.
        </p>
      )}
      {editing ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (body.trim()) save.mutate()
          }}
        >
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} autoFocus maxLength={5000} className="min-h-20 text-[15px]" />
          <div className="flex justify-end gap-2">
            <Button onClick={() => setEditing(false)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={save.isPending} disabled={!body.trim()}>
              <Check size={15} /> Save
            </Button>
          </div>
        </form>
      ) : (
        <>
          <p className="text-[15px] whitespace-pre-line">{t.messages[0]?.body}</p>
          {where(t, slides) && <p className="mt-1 text-xs text-text-4">{where(t, slides)}</p>}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {stale ? (
              <>
                <Button size="sm" variant="primary" loading={copy.isPending} onClick={() => copy.mutate()}>
                  Copy to {currentNumber ? versionLabel(currentNumber) : 'current'}
                </Button>
                <Button size="sm" loading={discard.isPending} onClick={() => discard.mutate()}>
                  <Trash2 size={13} /> Discard
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" onClick={() => setEditing(true)}>
                  <PenLine size={13} /> Edit
                </Button>
                <Button size="sm" variant="ghost" loading={discard.isPending} onClick={() => discard.mutate()}>
                  <Trash2 size={13} /> Discard
                </Button>
              </>
            )}
          </div>
        </>
      )}
    </article>
  )
}

function ThreadCard({
  content: c,
  thread: t,
  slides,
  canFeedback,
  active,
  onSelect,
}: {
  content: ClientContentDetail
  thread: Thread
  slides: Record<string, number>
  canFeedback: boolean
  active: boolean
  onSelect: () => void
}) {
  const qc = useQueryClient()
  const [replying, setReplying] = useState(false)
  const [text, setText] = useState('')
  const refresh = () => void qc.invalidateQueries({ queryKey: clientThreadsKey(c.id) })
  const onError = (err: unknown) => toast(errorMessage(err), 'error')
  const reply = useMutation({
    mutationFn: () => clientContentApi.reply(c.id, t._id, text.trim()),
    onSuccess: () => {
      setText('')
      setReplying(false)
      refresh()
    },
    onError,
  })
  const reopen = useMutation({ mutationFn: () => clientContentApi.reopen(c.id, t._id), onSuccess: refresh, onError })
  const [first, ...rest] = t.messages
  const feedback = t.kind === 'feedback'

  return (
    <article className={cn('rounded-xl border bg-white p-3', active ? 'border-brand-border ring-2 ring-brand/10' : 'border-border')}>
      <button type="button" onClick={onSelect} className="flex w-full items-start gap-2.5 text-left">
        {feedback ? (
          <span className={cn('grid size-7 shrink-0 place-items-center rounded-full bg-[#e5484d] text-xs font-semibold text-white', t.status === 'resolved' && 'opacity-50')}>
            {pinLabel('client', t.pin)}
          </span>
        ) : (
          <MessageSquare size={18} className="mt-1 shrink-0 text-text-3" />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[13px] font-semibold">{t.author.name}</span>
            <span className="text-xs text-text-4">
              {t.author.side === 'agency' ? 'Agency · ' : ''}
              {timeAgo(t.submittedAt ?? t.createdAt)}
            </span>
            {feedback && <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', statusClass(t))}>{statusText(t)}</span>}
          </span>
          {(where(t, slides) || (t.versionNumber && t.version !== c.version?._id)) && (
            <span className="mt-0.5 block text-[11px] text-text-4">
              {[t.versionNumber && t.version !== c.version?._id ? `on ${versionLabel(t.versionNumber)}` : '', where(t, slides)].filter(Boolean).join(' · ')}
            </span>
          )}
          {first && <span className="mt-1.5 block text-[15px] whitespace-pre-line">{first.body || (first.voice ? 'Voice note' : '')}</span>}
          {first?.voice?.transcript && (
            <span className="mt-1.5 block rounded-lg bg-surface-input px-2.5 py-1.5 text-xs text-text-2">
              <span className="font-medium">{first.voice.transcriptLabel ?? 'Auto-transcript'}:</span> {first.voice.transcript}
            </span>
          )}
        </span>
      </button>

      {/* F37: what the agency did about it. */}
      {t.status === 'resolved' && (
        <div className="mt-2 rounded-lg bg-green-soft px-3 py-2 text-xs text-green-ink">
          {t.closedOnApproval ? 'Closed when the content was approved.' : `Resolved${t.resolvedInVersion ? ` in ${versionLabel(t.resolvedInVersion.number)}` : ''}${t.resolvedBy ? ` by ${t.resolvedBy.name}` : ''}.`}
          {t.resolutionNote && <span className="mt-0.5 block text-text">“{t.resolutionNote}”</span>}
        </div>
      )}

      {rest.length > 0 && (
        <ul className="mt-2 flex flex-col gap-2 border-l-2 border-border-strong pl-3">
          {rest.map((m) => (
            <li key={m._id} className="text-[13px]">
              <span className="font-medium">{m.author.name}</span>
              <span className="ml-1.5 text-xs text-text-4">
                {m.author.side === 'agency' ? 'Agency · ' : ''}
                {timeAgo(m.createdAt)}
              </span>
              <p className="whitespace-pre-line text-text-2">{m.body || 'Voice note'}</p>
            </li>
          ))}
        </ul>
      )}

      {canFeedback && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => setReplying((v) => !v)}>
            <CornerDownRight size={13} /> Reply
          </Button>
          {feedback && t.status === 'resolved' && !t.closedOnApproval && REOPENABLE.includes(c.state) && (
            <Button size="sm" variant="ghost" loading={reopen.isPending} onClick={() => reopen.mutate()}>
              <RotateCcw size={13} /> Reopen
            </Button>
          )}
        </div>
      )}
      {replying && (
        <form
          className="mt-2 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (text.trim()) reply.mutate()
          }}
        >
          <Textarea value={text} onChange={(e) => setText(e.target.value)} autoFocus maxLength={5000} placeholder="Your reply (sent straight away)" className="min-h-16 text-[15px]" />
          <div className="flex justify-end gap-2">
            <Button size="sm" onClick={() => setReplying(false)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" variant="primary" loading={reply.isPending} disabled={!text.trim()}>
              <Send size={13} /> Reply
            </Button>
          </div>
        </form>
      )}
    </article>
  )
}
