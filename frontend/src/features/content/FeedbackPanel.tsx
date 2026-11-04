import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, CircleDot, ListTodo, Lock, MessageSquare, PenLine, PlayCircle, RotateCcw, Send, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Select, Textarea } from '@/components/ui/Field'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { timeAgo } from '@/lib/format'
import { toast } from '@/lib/toast'
import { contentApi, type Anchor, type ContentRecord, type Message, type Thread, type ThreadStatus } from './api'
import { useClientPeople } from './useClientPeople'
import { formatTime, pinLabel, versionLabel } from './labels'
import { ThreadStatusPill } from './pills'
import { VoicePlayer, VoiceRecorder, type RecordedVoice } from './VoiceNote'

type Tab = 'client' | 'internal'

const voiceOf = (v: RecordedVoice | null) => (v ? { voice: { file: v.file, durationMs: v.durationMs } } : {})

/** A comment or reply may be text, a voice note, or both (feedback.service `buildMessage`). */
const postComment = (contentId: string, body: { visibility: Tab; body: string; anchor?: Anchor; voice?: { file: string; durationMs: number } }) =>
  api<{ thread: Thread }>(`/content/${contentId}/threads`, { body })
const postReply = (contentId: string, threadId: string, body: { body: string; voice?: { file: string; durationMs: number } }) =>
  api<{ message: Message }>(`/content/${contentId}/threads/${threadId}/messages`, { body })

/**
 * Feedback on a content item (P53–P63): the client's items and the agency's internal notes in two separate tabs,
 * never one toggle (D20). New comments go on the current version only (D10); they can point at a spot drawn
 * in the viewer.
 */
export function FeedbackPanel({
  content,
  threads,
  selected,
  onSelect,
  viewingCurrent,
  annotating,
  onAnnotate,
  draft,
  onClearDraft,
}: {
  content: ContentRecord
  threads: Thread[]
  selected: string | null
  onSelect: (id: string | null) => void
  viewingCurrent: boolean
  annotating: boolean
  onAnnotate: (on: boolean) => void
  draft: Anchor | null
  onClearDraft: () => void
}) {
  const [tab, setTab] = useState<Tab>(content.clientVisibleAt ? 'client' : 'internal')
  const [showResolved, setShowResolved] = useState(false)
  const list = threads.filter((t) => t.visibility === tab && !t.draft)
  const open = list.filter((t) => t.kind !== 'feedback' || t.status !== 'resolved')
  const shown = showResolved ? list : open
  const count = (v: Tab) => threads.filter((t) => t.visibility === v && !t.draft && t.kind === 'feedback' && t.status !== 'resolved').length

  return (
    <section className="flex min-h-0 flex-col rounded-xl border border-border bg-surface">
      <div role="tablist" aria-label="Feedback" className="flex border-b border-border">
        {(['client', 'internal'] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={tab === v}
            onClick={() => {
              setTab(v)
              onSelect(null)
            }}
            className={cn(
              '-mb-px flex flex-1 items-center justify-center gap-2 border-b-2 px-4 py-3 text-[13px]',
              tab === v ? (v === 'internal' ? 'border-indigo-ink font-medium text-indigo-ink' : 'border-brand font-medium text-text') : 'border-transparent text-text-3 hover:text-text',
            )}
          >
            {v === 'internal' ? <Lock size={14} /> : <MessageSquare size={14} />}
            {v === 'client' ? 'Client feedback' : 'Internal'}
            {count(v) > 0 && <span className="rounded-full bg-surface-input px-1.5 text-[11px] text-text-2">{count(v)}</span>}
          </button>
        ))}
      </div>

      <div className="flex max-h-[60vh] min-h-40 flex-col gap-2 overflow-y-auto p-3">
        {shown.length === 0 ? (
          <p className="px-2 py-8 text-center text-[13px] text-text-3">
            {list.length > 0
              ? 'Everything here is resolved.'
              : tab === 'client'
                ? content.clientVisibleAt
                  ? 'No feedback from the client yet.'
                  : 'The client hasn’t been sent this content yet.'
                : 'No internal notes yet. Only your team sees them.'}
          </p>
        ) : (
          shown.map((t) => <ThreadCard key={t._id} content={content} thread={t} active={t._id === selected} onSelect={() => onSelect(t._id === selected ? null : t._id)} />)
        )}
        {list.length !== open.length && (
          <button type="button" onClick={() => setShowResolved((v) => !v)} className="self-center text-xs font-medium text-brand hover:underline">
            {showResolved ? 'Hide resolved' : `Show ${list.length - open.length} resolved`}
          </button>
        )}
      </div>

      <Composer
        key={tab}
        content={content}
        visibility={tab}
        disabledReason={
          !viewingCurrent
            ? 'You’re looking at an older version. Comments go on the current version.'
            : !content.currentVersion
              ? 'Upload a version first.'
              : tab === 'client' && !content.clientVisibleAt
                ? 'The client can’t see this content yet. Use an internal note.'
                : ['published', 'cancelled'].includes(content.state)
                  ? `This content is ${content.state}.`
                  : null
        }
        annotating={annotating}
        onAnnotate={onAnnotate}
        draft={draft}
        onClearDraft={onClearDraft}
      />
    </section>
  )
}

function where(t: Thread, content: ContentRecord) {
  const parts = [t.versionNumber ? `on ${versionLabel(t.versionNumber)}` : null]
  const version = content.versions.find((v) => v._id === t.version)
  const slide = version?.files.findIndex((f) => f._id === t.anchor?.versionFile) ?? -1
  if (slide >= 0 && (version?.files.length ?? 0) > 1) parts.push(`slide ${slide + 1}`)
  if (t.anchor?.timeMs != null) parts.push(`at ${formatTime(t.anchor.timeMs)}`)
  return parts.filter(Boolean).join(' · ')
}

function ThreadCard({ content, thread: t, active, onSelect }: { content: ContentRecord; thread: Thread; active: boolean; onSelect: () => void }) {
  const qc = useQueryClient()
  const people = useClientPeople(content.client._id)
  const [replying, setReplying] = useState(false)
  const [reply, setReply] = useState('')
  const [replyVoice, setReplyVoice] = useState<RecordedVoice | null>(null)
  const [resolving, setResolving] = useState(false)
  const [note, setNote] = useState('')
  const refresh = () => void qc.invalidateQueries({ queryKey: ['agency', 'content', 'threads', content._id] })
  const writable = !['published', 'cancelled'].includes(content.state)

  const send = useMutation({
    mutationFn: () => postReply(content._id, t._id, { body: reply.trim(), ...voiceOf(replyVoice) }),
    onSuccess: () => {
      setReply('')
      setReplyVoice(null)
      setReplying(false)
      refresh()
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  })
  const update = useMutation({
    mutationFn: (body: { status?: ThreadStatus; assignee?: string | null; resolutionNote?: string }) => contentApi.updateThread(content._id, t._id, body),
    onSuccess: () => {
      setResolving(false)
      setNote('')
      refresh()
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  })
  const task = useMutation({
    mutationFn: () => contentApi.threadToTask(content._id, t._id),
    onSuccess: ({ task: created }) => {
      toast(`Task created: ${created.title}`)
      refresh()
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  })

  const internal = t.visibility === 'internal'
  const [first, ...replies] = t.messages
  return (
    <article
      className={cn(
        'rounded-lg border p-3 transition-shadow',
        active ? 'border-brand-border shadow-md ring-2 ring-brand/10' : 'border-border-strong',
        internal ? 'bg-[#faf9ff]' : 'bg-white',
      )}
    >
      <button type="button" onClick={onSelect} className="flex w-full items-start gap-2.5 text-left">
        <span className={cn('grid h-6 min-w-6 shrink-0 place-items-center rounded-full px-1.5 text-[11px] font-semibold text-white', internal ? 'bg-[#4b47c4]' : 'bg-[#e5484d]')}>
          {pinLabel(t.visibility, t.pin)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[13px] font-semibold">{t.author.name}</span>
            <span className="text-xs text-text-4">
              {t.author.side === 'client' ? 'Client' : 'Team'} · {timeAgo(t.submittedAt ?? t.createdAt)}
            </span>
            {t.kind === 'feedback' && t.status && <ThreadStatusPill status={t.status} reopened={!!t.reopenedAt} />}
          </span>
          <span className="mt-0.5 block text-[11px] text-text-4">{where(t, content)}</span>
          {first?.body && <span className="mt-1.5 block text-[13px] whitespace-pre-line text-text">{first.body}</span>}
        </span>
      </button>
      {first?.voice && (
        <div className="pl-8.5">
          <VoicePlayer voice={first.voice} />
        </div>
      )}

      {t.status === 'resolved' && (
        <p className="mt-2 rounded-md bg-green-soft px-2.5 py-1.5 text-xs text-green-ink">
          {t.closedOnApproval ? 'Closed when the client approved.' : `Resolved${t.resolvedInVersion ? ` in ${versionLabel(t.resolvedInVersion.number)}` : ''}${t.resolvedBy ? ` by ${t.resolvedBy.name}` : ''}.`}
          {t.resolutionNote && <span className="mt-0.5 block text-text-2">“{t.resolutionNote}”</span>}
        </p>
      )}

      {replies.length > 0 && (
        <ul className="mt-2 flex flex-col gap-2 border-l-2 border-border-strong pl-3">
          {replies.map((m) => (
            <li key={m._id} className="text-[13px]">
              <span className="font-medium">{m.author.name}</span> <span className="text-xs text-text-4">{timeAgo(m.createdAt)}</span>
              {m.body && <p className="whitespace-pre-line text-text-2">{m.body}</p>}
              {m.voice && <VoicePlayer voice={m.voice} />}
            </li>
          ))}
        </ul>
      )}

      {writable && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => setReplying((v) => !v)}>
            <MessageSquare size={13} /> Reply
          </Button>
          {t.kind === 'feedback' && t.status === 'open' && (
            <Button size="sm" variant="ghost" loading={update.isPending} onClick={() => update.mutate({ status: 'in_progress' })}>
              <PlayCircle size={13} /> Start
            </Button>
          )}
          {t.kind === 'feedback' && t.status !== 'resolved' && (
            <Button size="sm" variant="ghost" onClick={() => setResolving((v) => !v)}>
              <CheckCircle2 size={13} /> Resolve
            </Button>
          )}
          {t.kind === 'feedback' && t.status === 'resolved' && (
            <Button size="sm" variant="ghost" loading={update.isPending} onClick={() => update.mutate({ status: 'open' })}>
              <RotateCcw size={13} /> Reopen
            </Button>
          )}
          {t.kind === 'feedback' && t.status !== 'resolved' && (
            <Button size="sm" variant="ghost" loading={task.isPending} onClick={() => task.mutate()}>
              <ListTodo size={13} /> Make task
            </Button>
          )}
          {t.kind === 'feedback' && (
            <Select
              aria-label="Assignee"
              value={t.assignee ?? ''}
              onChange={(e) => update.mutate({ assignee: e.target.value || null })}
              className="ml-auto h-8 w-36 text-xs"
            >
              <option value="">Unassigned</option>
              {people.data?.map((u) => (
                <option key={u._id} value={u._id}>
                  {u.name}
                </option>
              ))}
            </Select>
          )}
        </div>
      )}

      {resolving && (
        <form
          className="mt-2 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            update.mutate({ status: 'resolved', resolutionNote: note.trim() })
          }}
        >
          <Textarea autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder={internal ? 'What was done (optional)' : 'Your response to the client, e.g. why no change is needed'} maxLength={2000} className="min-h-16" />
          <div className="flex justify-end gap-2">
            <Button size="sm" onClick={() => setResolving(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" type="submit" loading={update.isPending}>
              Mark resolved
            </Button>
          </div>
        </form>
      )}

      {replying && (
        <form
          className="mt-2 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (reply.trim() || replyVoice) send.mutate()
          }}
        >
          <Textarea autoFocus value={reply} onChange={(e) => setReply(e.target.value)} placeholder={internal ? 'Reply to your team' : 'Reply to the client'} maxLength={5000} className="min-h-16" />
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="mr-auto">
              <VoiceRecorder client={content.client._id} visibility={t.visibility} value={replyVoice} onChange={setReplyVoice} />
            </span>
            <Button size="sm" onClick={() => setReplying(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" type="submit" loading={send.isPending} disabled={!reply.trim() && !replyVoice}>
              <Send size={13} /> Reply
            </Button>
          </div>
        </form>
      )}
    </article>
  )
}

function Composer({
  content,
  visibility,
  disabledReason,
  annotating,
  onAnnotate,
  draft,
  onClearDraft,
}: {
  content: ContentRecord
  visibility: Tab
  disabledReason: string | null
  annotating: boolean
  onAnnotate: (on: boolean) => void
  draft: Anchor | null
  onClearDraft: () => void
}) {
  const qc = useQueryClient()
  const [body, setBody] = useState('')
  const [voice, setVoice] = useState<RecordedVoice | null>(null)
  const internal = visibility === 'internal'
  const post = useMutation({
    mutationFn: () => postComment(content._id, { visibility, body: body.trim(), ...(draft?.shapes?.length ? { anchor: draft } : {}), ...voiceOf(voice) }),
    onSuccess: () => {
      setBody('')
      setVoice(null)
      onClearDraft()
      onAnnotate(false)
      void qc.invalidateQueries({ queryKey: ['agency', 'content', 'threads', content._id] })
      toast(internal ? 'Internal note added' : 'Comment sent to the client')
    },
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (body.trim() || voice) post.mutate()
  }
  const ready = !!body.trim() || !!voice

  if (disabledReason) return <p className="border-t border-border px-4 py-3 text-xs text-text-3">{disabledReason}</p>

  const version = content.versions.find((v) => v._id === content.currentVersion)
  const slide = version?.files.findIndex((f) => f._id === draft?.versionFile) ?? -1
  return (
    <form onSubmit={submit} className={cn('flex flex-col gap-2 border-t p-3', internal ? 'border-indigo-soft bg-indigo-soft/50' : 'border-border')}>
      <span className={cn('flex items-center gap-1.5 text-[11px] font-semibold tracking-wide uppercase', internal ? 'text-indigo-ink' : 'text-text-3')}>
        {internal ? (
          <>
            <Lock size={12} /> Internal note · never shown to the client
          </>
        ) : (
          <>
            <CircleDot size={12} /> Comment to the client · sent now
          </>
        )}
      </span>
      {draft?.shapes?.length ? (
        <span className="flex items-center gap-2 self-start rounded-full bg-white px-2.5 py-1 text-xs text-text-2 ring-1 ring-border-strong">
          <PenLine size={12} /> Drawing on {slide >= 0 && (version?.files.length ?? 0) > 1 ? `slide ${slide + 1}` : 'the creative'}
          {draft.timeMs != null ? ` at ${formatTime(draft.timeMs)}` : ''}
          <button type="button" aria-label="Remove drawing" onClick={onClearDraft} className="text-text-4 hover:text-text">
            <X size={12} />
          </button>
        </span>
      ) : null}
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={5000}
        placeholder={internal ? 'Note for your team…' : 'Write to the client…'}
        className="min-h-16"
        aria-label={internal ? 'Internal note' : 'Comment to the client'}
      />
      {post.isError && <p className="text-xs text-negative">{errorMessage(post.error)}</p>}
      <div className="flex items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant={annotating ? 'primary' : 'secondary'} onClick={() => onAnnotate(!annotating)} aria-pressed={annotating}>
            <PenLine size={13} /> {annotating ? 'Drawing…' : 'Draw on creative'}
          </Button>
          <VoiceRecorder client={content.client._id} visibility={visibility} value={voice} onChange={setVoice} />
        </span>
        {internal ? (
          <button
            type="submit"
            disabled={!ready || post.isPending}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-indigo-ink px-3 text-xs font-medium text-white hover:enabled:bg-[#3d39a8] disabled:opacity-55"
          >
            <Lock size={13} /> Add note
          </button>
        ) : (
          <Button size="sm" variant="primary" type="submit" loading={post.isPending} disabled={!ready}>
            <Send size={13} /> Send
          </Button>
        )}
      </div>
    </form>
  )
}
