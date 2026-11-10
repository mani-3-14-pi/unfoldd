import { useState, type ReactNode } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Ban, CalendarClock, CheckCircle2, Clock, EllipsisVertical, ExternalLink, Hammer, ListChecks, Pencil, RotateCcw, Send, ThumbsDown, Upload } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Menu, type MenuItem } from '@/components/ui/Menu'
import { canUploadCreative, isManagerPlus } from '@/features/agency/roles'
import { useAgencySession } from '@/features/agency/session'
import { templatesApi } from '@/features/templates/api'
import { cn } from '@/lib/cn'
import { errorMessage, fieldErrors } from '@/lib/errors'
import { toast } from '@/lib/toast'
import { formatInZone, isoToZonedInput, zonedInputToIso } from '@/lib/zonedTime'
import { contentApi, type ContentRecord } from './api'
import { canCancelIn, canUploadIn, versionLabel } from './labels'

type DialogKind = 'request_changes' | 'send' | 'resend' | 'schedule' | 'published' | 'cancel' | 'task_list'

/**
 * The next steps for this content, from its state (§6.1). Each button maps to one server transition; the server
 * checks again and answers 409 if someone moved it first, in which case the page reloads to the current state.
 */
export function ContentActions({ content: c, onChanged, onUpload, onEdit }: { content: ContentRecord; onChanged: () => void; onUpload: () => void; onEdit: () => void }) {
  const s = useAgencySession()
  const [dialog, setDialog] = useState<DialogKind | null>(null)
  const current = c.versions.find((v) => v._id === c.currentVersion)
  const next = versionLabel((c.versions[0]?.number ?? 0) + 1)
  const canReview = isManagerPlus(s.role) || c.reviewer === s.user.id
  const canCancel = canCancelIn.includes(c.state) && (isManagerPlus(s.role) || c.owner === s.user.id)

  const run = useMutation({
    mutationFn: ({ call }: { call: () => Promise<unknown>; done: string }) => call(),
    onSuccess: (_, { done }) => {
      toast(done)
      onChanged()
    },
    onError: (err) => {
      toast(errorMessage(err), 'error')
      onChanged()
    },
  })
  const act = (call: () => Promise<unknown>, done: string) => run.mutate({ call, done })

  const canUpload = canUploadCreative(s.role)
  const upload = (primary: boolean) =>
    canUpload && (
      <Button variant={primary ? 'primary' : 'secondary'} onClick={onUpload}>
        <Upload size={15} /> Upload {next}
      </Button>
    )
  const busy = run.isPending

  let buttons: ReactNode = null
  let note: ReactNode = null
  switch (c.state) {
    case 'planned':
      buttons = (
        <>
          <Button loading={busy} onClick={() => act(() => contentApi.startProduction(c._id), 'Production started')}>
            <Hammer size={15} /> Start production
          </Button>
          {upload(true)}
        </>
      )
      break
    case 'in_production':
      buttons = (
        <>
          {upload(!current)}
          {current && (
            <Button variant="primary" loading={busy} onClick={() => act(() => contentApi.submit(c._id), c.client.contract.internalReview ? 'Sent for internal review' : 'Ready for the client')}>
              <Send size={15} /> {c.client.contract.internalReview ? `Submit ${versionLabel(current.number)} for review` : `Mark ${versionLabel(current.number)} ready`}
            </Button>
          )}
        </>
      )
      break
    case 'internal_review':
      if (canReview) {
        buttons = (
          <>
            <Button onClick={() => setDialog('request_changes')}>
              <ThumbsDown size={15} /> Request changes
            </Button>
            <Button loading={busy} onClick={() => act(() => contentApi.internalReview(c._id, 'approve', ''), 'Approved internally')}>
              <CheckCircle2 size={15} /> Approve
            </Button>
            <Button variant="primary" loading={busy} onClick={() => act(() => contentApi.internalReview(c._id, 'approve_and_send', ''), 'Approved and sent to the client')}>
              <Send size={15} /> Approve & send
            </Button>
          </>
        )
      } else note = 'Waiting for a manager or the reviewer to approve it.'
      break
    case 'ready_for_client':
      buttons = (
        <>
          <Button loading={busy} onClick={() => act(() => contentApi.continueEditing(c._id), 'Back in production')}>
            <Pencil size={15} /> Continue editing
          </Button>
          <Button variant="primary" onClick={() => setDialog('send')}>
            <Send size={15} /> Send to client
          </Button>
        </>
      )
      if (c.sendAt) note = `Sending to the client ${formatInZone(c.sendAt, c.client.timezone)}.`
      break
    case 'client_review':
      buttons = upload(false)
      note = c.derived.approvalStatus === 'viewed' ? 'The client has opened it. Waiting for their decision.' : 'Sent. Waiting for the client to open it.'
      break
    case 'changes_requested':
      buttons = (
        <>
          <Button onClick={() => setDialog('resend')}>
            <Send size={15} /> Re-send {current ? versionLabel(current.number) : ''} with a reply
          </Button>
          {upload(true)}
        </>
      )
      break
    case 'approved':
      if (s.canPublish) {
        buttons = (
          <>
            <Button onClick={() => setDialog('published')}>
              <ExternalLink size={15} /> Mark as published
            </Button>
            <Button variant="primary" onClick={() => setDialog('schedule')}>
              <CalendarClock size={15} /> Schedule
            </Button>
          </>
        )
      } else note = 'Approved. Someone who can publish will schedule it.'
      break
    case 'scheduled': {
      const failed = c.publishJob && ['failed', 'unknown'].includes(c.publishJob.status)
      if (s.canPublish) {
        buttons = (
          <>
            <Button loading={busy} onClick={() => act(() => contentApi.unschedule(c._id), 'Unscheduled')}>
              <Clock size={15} /> Unschedule
            </Button>
            {failed && (
              <Button loading={busy} onClick={() => act(() => contentApi.retryPublish(c._id), 'Publishing again')}>
                <RotateCcw size={15} /> Retry
              </Button>
            )}
            <Button variant={failed ? 'primary' : 'secondary'} onClick={() => setDialog('published')}>
              <ExternalLink size={15} /> Mark as published
            </Button>
          </>
        )
      }
      note = failed
        ? c.publishJob!.status === 'unknown'
          ? 'We couldn’t confirm the post went out. Check the account before retrying, so it isn’t posted twice.'
          : `Publishing failed: ${c.publishJob!.error || 'unknown error'}.`
        : `Goes out ${formatInZone(c.publishDate, c.client.timezone)} via ${c.publishJob?.account.label ?? 'manual publishing'}.`
      break
    }
    case 'publishing':
      note = 'Being published right now.'
      break
    case 'published':
      buttons = c.externalUrl && (
        <a href={c.externalUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#e6e5e8] bg-white px-3.5 text-[13px] font-medium hover:bg-[#f6f6f7]">
          <ExternalLink size={15} /> View post
        </a>
      )
      break
    case 'cancelled':
      buttons = (
        <Button loading={busy} onClick={() => act(() => contentApi.restore(c._id), 'Restored')}>
          <RotateCcw size={15} /> Restore
        </Button>
      )
      break
  }

  const more: MenuItem[] = [
    ...(!['published', 'cancelled'].includes(c.state) ? [{ label: 'Edit details', icon: Pencil, onSelect: onEdit }] : []),
    ...(!['published', 'cancelled'].includes(c.state) ? [{ label: 'Apply a task list', icon: ListChecks, onSelect: () => setDialog('task_list') }] : []),
    ...(canUpload && canUploadIn.includes(c.state) && !['planned', 'in_production', 'changes_requested', 'client_review'].includes(c.state)
      ? [{ label: `Upload ${next}`, icon: Upload, onSelect: onUpload }]
      : []),
    ...(canCancel ? [{ label: 'Cancel content', icon: Ban, tone: 'danger' as const, onSelect: () => setDialog('cancel'), separated: true }] : []),
  ]

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <div className="flex flex-wrap gap-2 sm:justify-end">
        {buttons}
        {more.length > 0 && (
          <Menu label="More actions" items={more} className="grid size-9 place-items-center rounded-lg border border-[#e6e5e8] bg-white hover:bg-[#f6f6f7]">
            <EllipsisVertical size={17} />
          </Menu>
        )}
      </div>
      {note && <p className="text-xs text-text-3 sm:text-right">{note}</p>}

      {dialog === 'request_changes' && (
        <NoteDialog
          title="Request changes"
          label="What needs to change?"
          hint="The team sees this with the version. Add pins on the creative as internal notes for detail."
          confirm="Send back to production"
          required
          action={(text) => contentApi.internalReview(c._id, 'request_changes', text)}
          done="Sent back to production"
          onClose={() => setDialog(null)}
          onDone={onChanged}
        />
      )}
      {dialog === 'resend' && (
        <NoteDialog
          title={`Re-send ${current ? versionLabel(current.number) : 'this version'}`}
          label="Your reply to the client"
          hint="For when no change is needed, e.g. the guidelines don’t allow it. It goes back to them for review."
          confirm="Re-send"
          required
          action={(text) => contentApi.send(c._id, { note: text })}
          done="Sent back to the client"
          onClose={() => setDialog(null)}
          onDone={onChanged}
        />
      )}
      {dialog === 'cancel' && (
        <NoteDialog
          title={`Cancel ${c.title}?`}
          label="Reason (optional)"
          hint="It stops here: any schedule is cancelled and open requests and tasks only for it are closed. You can restore it later."
          confirm="Cancel content"
          danger
          action={(text) => contentApi.cancel(c._id, text)}
          done="Cancelled"
          onClose={() => setDialog(null)}
          onDone={onChanged}
        />
      )}
      {dialog === 'send' && <SendDialog content={c} onClose={() => setDialog(null)} onDone={onChanged} />}
      {dialog === 'schedule' && <ScheduleDialog content={c} onClose={() => setDialog(null)} onDone={onChanged} />}
      {dialog === 'published' && <PublishedDialog content={c} onClose={() => setDialog(null)} onDone={onChanged} />}
      {dialog === 'task_list' && <TaskListDialog content={c} onClose={() => setDialog(null)} onDone={onChanged} />}
    </div>
  )
}

function NoteDialog({
  title,
  label,
  hint,
  confirm,
  required,
  danger,
  action,
  done,
  onClose,
  onDone,
}: {
  title: string
  label: string
  hint: string
  confirm: string
  required?: boolean
  danger?: boolean
  action: (text: string) => Promise<unknown>
  done: string
  onClose: () => void
  onDone: () => void
}) {
  const [text, setText] = useState('')
  const m = useMutation({
    mutationFn: () => action(text.trim()),
    onSuccess: () => {
      toast(done)
      onDone()
      onClose()
    },
  })
  return (
    <Dialog
      title={title}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Back</Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={m.isPending} disabled={required && !text.trim()} onClick={() => m.mutate()}>
            {confirm}
          </Button>
        </>
      }
    >
      <Field label={label} htmlFor="note-text" hint={hint}>
        <Textarea id="note-text" autoFocus value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} />
      </Field>
      {m.isError && <p className="mt-2 text-[13px] text-negative">{errorMessage(m.error)}</p>}
    </Dialog>
  )
}

/** P52: send now, or later at a set time (in the client's timezone). */
function SendDialog({ content: c, onClose, onDone }: { content: ContentRecord; onClose: () => void; onDone: () => void }) {
  const [later, setLater] = useState(false)
  const [at, setAt] = useState('')
  const [note, setNote] = useState('')
  const iso = at ? zonedInputToIso(at, c.client.timezone) : null
  const m = useMutation({
    mutationFn: () => contentApi.send(c._id, { sendAt: later ? iso : null, note: note.trim() }),
    onSuccess: () => {
      toast(later ? `Will be sent ${formatInZone(iso, c.client.timezone, { withViewer: false })}` : 'Sent to the client')
      onDone()
      onClose()
    },
  })
  const errors = fieldErrors(m.error)
  const current = c.versions.find((v) => v._id === c.currentVersion)
  return (
    <Dialog
      title={`Send ${current ? versionLabel(current.number) : ''} to ${c.client.brandName}`}
      description="They’ll see Review Required and get a notification."
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Back</Button>
          <Button variant="primary" loading={m.isPending} disabled={later && !at} onClick={() => m.mutate()}>
            {later ? 'Schedule send' : 'Send now'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="When">
          {[false, true].map((v) => (
            <button
              key={String(v)}
              type="button"
              role="radio"
              aria-checked={later === v}
              onClick={() => setLater(v)}
              className={cn('rounded-lg border px-3 py-2.5 text-left text-[13px]', later === v ? 'border-brand-border bg-green-soft/40 font-medium' : 'border-border-strong hover:bg-surface')}
            >
              {v ? 'Send later' : 'Send now'}
            </button>
          ))}
        </div>
        {later && (
          <Field label="Send at (client time)" htmlFor="send-at" error={errors.sendAt} hint={iso ? formatInZone(iso, c.client.timezone) : c.client.timezone.replace(/_/g, ' ')}>
            <Input id="send-at" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
          </Field>
        )}
        <Field label="Message (optional)" htmlFor="send-note" hint="Shown to the client with the version.">
          <Textarea id="send-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
        </Field>
        {m.isError && Object.keys(errors).length === 0 && <p className="text-[13px] text-negative">{errorMessage(m.error)}</p>}
      </div>
    </Dialog>
  )
}

/** P116: pick the account and time. Scheduling writes the content's publish date, which the job reads (D28). */
function ScheduleDialog({ content: c, onClose, onDone }: { content: ContentRecord; onClose: () => void; onDone: () => void }) {
  const tz = c.client.timezone
  const [at, setAt] = useState(() => (c.publishDate && new Date(c.publishDate).getTime() > Date.now() ? isoToZonedInput(c.publishDate, tz) : ''))
  const [account, setAccount] = useState('')
  const connections = useQuery({ queryKey: ['agency', 'connections', c.client._id], queryFn: () => contentApi.connections(c.client._id), retry: false })
  const usable = (connections.data?.items ?? []).filter((x) => x.platform === c.platform && x.status === 'active')
  const iso = at ? zonedInputToIso(at, tz) : null
  const m = useMutation({
    mutationFn: () => contentApi.schedule(c._id, iso!, account || null),
    onSuccess: () => {
      toast(`Scheduled for ${formatInZone(iso, tz, { withViewer: false })}`)
      onDone()
      onClose()
    },
  })
  const errors = fieldErrors(m.error)
  const approved = c.versions.find((v) => v._id === c.approvedVersion)
  return (
    <Dialog
      title="Schedule"
      description={`Publishes ${approved ? versionLabel(approved.number) : 'the approved version'} with its approved caption. Nothing else.`}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Back</Button>
          <Button variant="primary" loading={m.isPending} disabled={!at} onClick={() => m.mutate()}>
            Schedule
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Publish at (client time)" htmlFor="sch-at" error={errors.publishDate} hint={iso ? formatInZone(iso, tz) : tz.replace(/_/g, ' ')}>
          <Input id="sch-at" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} autoFocus />
        </Field>
        <Field
          label="Account"
          htmlFor="sch-account"
          error={errors.account}
          hint={account ? 'Published automatically at that time.' : 'Manual: at that time you’re reminded to post it, then mark it published.'}
        >
          <Select id="sch-account" value={account} onChange={(e) => setAccount(e.target.value)}>
            <option value="">Manual publishing</option>
            {usable.map((x) => (
              <option key={x._id} value={x._id}>
                {x.name}
              </option>
            ))}
          </Select>
        </Field>
        {m.isError && Object.keys(errors).length === 0 && <p className="text-[13px] text-negative">{errorMessage(m.error)}</p>}
      </div>
    </Dialog>
  )
}

/** D26: posted by hand (or confirmed after an unknown outcome): record the live post's link. */
function PublishedDialog({ content: c, onClose, onDone }: { content: ContentRecord; onClose: () => void; onDone: () => void }) {
  const [url, setUrl] = useState('')
  const m = useMutation({
    mutationFn: () => contentApi.markPublished(c._id, url.trim()),
    onSuccess: () => {
      toast('Marked as published')
      onDone()
      onClose()
    },
  })
  const errors = fieldErrors(m.error)
  return (
    <Dialog
      title="Mark as published"
      description="Paste the link to the live post. The client sees it as Published."
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Back</Button>
          <Button variant="primary" loading={m.isPending} disabled={!url.trim()} onClick={() => m.mutate()}>
            Mark published
          </Button>
        </>
      }
    >
      <Field label="Post link" htmlFor="pub-url" error={errors.url}>
        <Input id="pub-url" type="url" autoFocus placeholder="https://www.instagram.com/p/…" value={url} onChange={(e) => setUrl(e.target.value)} aria-invalid={!!errors.url} />
      </Field>
      {m.isError && Object.keys(errors).length === 0 && <p className="mt-2 text-[13px] text-negative">{errorMessage(m.error)}</p>}
    </Dialog>
  )
}

/**
 * P44/D55: generate a task-list (or content) template's production tasks for this content. Due dates count
 * from the anchor date: the production deadline by default.
 */
function TaskListDialog({ content: c, onClose, onDone }: { content: ContentRecord; onClose: () => void; onDone: () => void }) {
  const templates = useQuery({ queryKey: ['agency', 'templates', 'task_list,content'], queryFn: () => templatesApi.list('type=task_list,content&pageSize=100') })
  const [id, setId] = useState('')
  const [anchor, setAnchor] = useState(c.due)
  const m = useMutation({
    mutationFn: () => templatesApi.apply(id, c._id, anchor || undefined),
    onSuccess: ({ tasks }) => {
      toast(tasks.length === 1 ? 'Added 1 task' : `Added ${tasks.length} tasks`)
      onDone()
      onClose()
    },
  })
  const errors = fieldErrors(m.error)
  const items = templates.data?.items ?? []
  return (
    <Dialog
      title="Apply a task list"
      description="Adds the template's production tasks to this content, owned by its owner."
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Back</Button>
          <Button variant="primary" loading={m.isPending} disabled={!id} onClick={() => m.mutate()}>
            Add tasks
          </Button>
        </>
      }
    >
      {templates.isSuccess && items.length === 0 ? (
        <p className="text-[13px] text-text-3">No task-list templates yet. Create one under Templates.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <Field label="Template" htmlFor="tl-template" error={errors.template}>
            <Select id="tl-template" value={id} onChange={(e) => setId(e.target.value)} disabled={templates.isPending} autoFocus>
              <option value="">Choose a template…</option>
              {items.map((t) => (
                <option key={t._id} value={t._id}>
                  {t.name}
                  {t.type === 'content' ? ' (content template)' : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Count due dates from" htmlFor="tl-anchor" error={errors.anchor} hint="Leave empty to count from today.">
            <Input id="tl-anchor" type="date" value={anchor} onChange={(e) => setAnchor(e.target.value)} />
          </Field>
          {m.isError && Object.keys(errors).length === 0 && <p className="text-[13px] text-negative">{errorMessage(m.error)}</p>}
        </div>
      )}
    </Dialog>
  )
}
