import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, CircleAlert, Send, ThumbsDown } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Textarea } from '@/components/ui/Field'
import { useClientSession } from '@/features/agency/session'
import type { Thread } from '@/features/content/api'
import { versionLabel } from '@/features/content/labels'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { toast } from '@/lib/toast'
import { formatInZone } from '@/lib/zonedTime'
import { clientContentApi, type ClientContentDetail, type DecidedMeanwhile } from './api'
import { IN_REVIEW, PULLABLE } from './labels'

type Sheet = 'approve' | 'changes' | 'pull' | null
type DraftChoice = 'changes_instead' | 'discard' | 'post_as_messages'
type Attempt = { kind: 'approve'; drafts?: 'discard' | 'post_as_messages'; note: string } | { kind: 'changes'; note: string }

/**
 * The client's decision (F38–F41): Send feedback (anyone who can comment), Request changes and Approve
 * (Admins and Approvers). Decisions carry the state the person saw; if someone else decided in the meantime the
 * server answers 409 and the person confirms deliberately (D07). Approved or scheduled content can still be
 * pulled back until publishing starts (D08).
 */
export function DecisionBar({ content: c, threads }: { content: ClientContentDetail; threads: Thread[] }) {
  const qc = useQueryClient()
  const tz = useClientSession().client.timezone
  const [sheet, setSheet] = useState<Sheet>(null)
  const [conflict, setConflict] = useState<{ attempt: Attempt; details: DecidedMeanwhile; message: string } | null>(null)

  const version = c.version
  const current = version?.isCurrent ? version : null
  const drafts = threads.filter((t) => t.draft && t.version === current?._id)
  const openItems = threads.filter((t) => !t.draft && t.kind === 'feedback' && t.status !== 'resolved' && t.version === current?._id)
  const inReview = IN_REVIEW.includes(c.state)
  const pullable = PULLABLE.includes(c.state)

  const done = (text: string) => {
    toast(text)
    setSheet(null)
    setConflict(null)
    void qc.invalidateQueries({ queryKey: ['client'] })
  }

  const onConflict = (attempt: Attempt) => (err: unknown) => {
    if (err instanceof ApiError && err.status === 409 && err.code === 'decided_meanwhile') {
      setSheet(null)
      setConflict({ attempt, details: err.details as DecidedMeanwhile, message: err.message })
      return
    }
    toast(errorMessage(err), 'error')
    void qc.invalidateQueries({ queryKey: ['client', 'content'] })
  }

  const submit = useMutation({
    mutationFn: () => clientContentApi.submit(c.id, current!._id),
    onSuccess: ({ submitted }) => done(`Sent ${submitted} comment${submitted === 1 ? '' : 's'} to your agency`),
    onError: (err) => toast(errorMessage(err), 'error'),
  })
  const decide = useMutation({
    mutationFn: ({ attempt, confirm }: { attempt: Attempt; confirm: boolean }) => {
      const base = { versionId: current!._id, expectedState: c.state, confirm, note: attempt.note }
      return attempt.kind === 'approve' ? clientContentApi.approve(c.id, { ...base, drafts: attempt.drafts }) : clientContentApi.requestChanges(c.id, base)
    },
    onSuccess: (_, { attempt }) => done(attempt.kind === 'approve' ? `${versionLabel(current!.number)} approved` : pullable ? 'Approval withdrawn. Your agency has been told.' : 'Changes requested. Your agency has been told.'),
    onError: (err, { attempt }) => onConflict(attempt)(err),
  })

  if (!current || (!c.can.comment && !c.can.decide)) return null
  const showSend = c.can.comment && drafts.length > 0 && inReview
  const showDecide = c.can.decide && inReview
  const showPull = c.can.decide && pullable
  if (!showSend && !showDecide && !showPull) return null

  return (
    <>
      {/* Above the tab bar, so the decision is always one tap away. */}
      <div className="fixed inset-x-0 bottom-16 z-20 border-t border-border bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="mx-auto flex max-w-3xl gap-2 px-4 py-2.5">
          {showSend && (
            <Button className={cn('h-11 flex-1', !showDecide && 'flex-[2]')} loading={submit.isPending} onClick={() => submit.mutate()}>
              <Send size={16} /> Send feedback · {drafts.length}
            </Button>
          )}
          {(showDecide || showPull) && (
            <Button className="h-11 flex-1" onClick={() => setSheet(showPull ? 'pull' : 'changes')}>
              <ThumbsDown size={16} /> {showPull ? 'Request changes' : 'Changes'}
            </Button>
          )}
          {showDecide && (
            <Button variant="primary" className="h-11 flex-1" onClick={() => setSheet('approve')}>
              <CheckCircle2 size={16} /> Approve
            </Button>
          )}
        </div>
      </div>
      {/* Keeps the end of the page clear of the bar. */}
      <div className="h-16" aria-hidden="true" />

      {sheet === 'approve' && (
        <ApproveSheet
          number={current.number}
          drafts={drafts.length}
          busy={decide.isPending}
          onClose={() => setSheet(null)}
          onApprove={(drafts, note) => decide.mutate({ attempt: { kind: 'approve', drafts, note }, confirm: false })}
          onChangesInstead={() => setSheet('changes')}
        />
      )}
      {(sheet === 'changes' || sheet === 'pull') && (
        <ChangesSheet
          pull={sheet === 'pull'}
          scheduled={c.state === 'scheduled'}
          number={current.number}
          openItems={openItems.length}
          drafts={drafts.length}
          busy={decide.isPending}
          onClose={() => setSheet(null)}
          onConfirm={(note) => decide.mutate({ attempt: { kind: 'changes', note }, confirm: false })}
        />
      )}
      {conflict && (
        <Dialog
          title="Someone decided first"
          onClose={() => {
            setConflict(null)
            void qc.invalidateQueries({ queryKey: ['client', 'content'] })
          }}
          size="sm"
          footer={
            <>
              <Button
                onClick={() => {
                  setConflict(null)
                  void qc.invalidateQueries({ queryKey: ['client', 'content'] })
                }}
              >
                No, leave it
              </Button>
              <Button variant="primary" loading={decide.isPending} onClick={() => decide.mutate({ attempt: conflict.attempt, confirm: true })}>
                Yes, {conflict.attempt.kind === 'approve' ? 'approve' : 'request changes'}
              </Button>
            </>
          }
        >
          <p className="flex gap-2 text-[15px]">
            <CircleAlert size={18} className="mt-0.5 shrink-0 text-amber-ink" />
            <span>
              {conflict.details.decision
                ? `${conflict.details.decision.by} ${conflict.details.decision.decision === 'approved' ? 'approved' : conflict.details.decision.decision === 'pulled' ? 'withdrew the approval of' : 'requested changes on'} this at ${formatInZone(conflict.details.decision.at, tz, { withViewer: false })}.`
                : conflict.message}{' '}
              Still {conflict.attempt.kind === 'approve' ? 'approve' : 'request changes'}?
            </span>
          </p>
        </Dialog>
      )}
    </>
  )
}

function ApproveSheet({
  number,
  drafts,
  busy,
  onClose,
  onApprove,
  onChangesInstead,
}: {
  number: number
  drafts: number
  busy: boolean
  onClose: () => void
  onApprove: (drafts: 'discard' | 'post_as_messages' | undefined, note: string) => void
  onChangesInstead: () => void
}) {
  const [choice, setChoice] = useState<DraftChoice>('changes_instead')
  const [note, setNote] = useState('')
  const label = versionLabel(number)

  const confirm = () => {
    if (drafts > 0 && choice === 'changes_instead') return onChangesInstead()
    onApprove(drafts > 0 ? (choice as 'discard' | 'post_as_messages') : undefined, note.trim())
  }

  return (
    <Dialog
      title={`Approve ${label}?`}
      description="You approve this creative and its caption exactly as they are. Your agency can then schedule it."
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Not yet</Button>
          <Button variant="primary" loading={busy} onClick={confirm}>
            {drafts > 0 && choice === 'changes_instead' ? 'Request changes instead' : `Approve ${label}`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {drafts > 0 && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-[13px] font-medium">
              You have {drafts} unsent comment{drafts === 1 ? '' : 's'}. What should happen to {drafts === 1 ? 'it' : 'them'}?
            </legend>
            {(
              [
                ['changes_instead', 'Request changes instead', 'Send them and ask for another version.'],
                ['discard', 'Approve and discard them', 'They’re deleted; the agency never sees them.'],
                ['post_as_messages', 'Approve and post them as messages', 'The agency sees them as notes, not changes to make.'],
              ] as const
            ).map(([value, title, hint]) => (
              <label key={value} className={cn('flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3', choice === value ? 'border-brand-border bg-green-soft/40' : 'border-border-strong')}>
                <input type="radio" name="drafts" className="mt-0.5 size-4 accent-brand" checked={choice === value} onChange={() => setChoice(value)} />
                <span>
                  <span className="block text-[14px] font-medium">{title}</span>
                  <span className="block text-xs text-text-3">{hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
        {(drafts === 0 || choice !== 'changes_instead') && (
          <Field label="Note for your agency (optional)" htmlFor="approve-note">
            <Textarea id="approve-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
          </Field>
        )}
      </div>
    </Dialog>
  )
}

function ChangesSheet({
  pull,
  scheduled,
  number,
  openItems,
  drafts,
  busy,
  onClose,
  onConfirm,
}: {
  pull: boolean
  scheduled: boolean
  number: number
  openItems: number
  drafts: number
  busy: boolean
  onClose: () => void
  onConfirm: (note: string) => void
}) {
  const [note, setNote] = useState('')
  const items = openItems + drafts
  // In review the agency needs at least one comment saying what to change; a pulled approval doesn't.
  const blocked = !pull && items === 0

  return (
    <Dialog
      title={pull ? `Withdraw your approval of ${versionLabel(number)}?` : 'Request changes'}
      description={
        pull
          ? `${scheduled ? 'The scheduled post is cancelled and it' : 'It'} goes back to your agency for changes. Your agency is told straight away.`
          : blocked
            ? undefined
            : `Your ${items} comment${items === 1 ? '' : 's'} go to your agency as one set of changes${drafts ? `, including ${drafts} unsent` : ''}.`
      }
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Back</Button>
          <Button variant="primary" loading={busy} disabled={blocked} onClick={() => onConfirm(note.trim())}>
            {pull ? 'Withdraw and request changes' : 'Request changes'}
          </Button>
        </>
      }
    >
      {blocked ? (
        <p className="flex gap-2 text-[15px] text-text-2">
          <CircleAlert size={18} className="mt-0.5 shrink-0 text-amber-ink" />
          Add at least one comment first, so your agency knows what to change. Tap the creative or write one under it.
        </p>
      ) : (
        <Field label={pull ? 'What changed? (optional)' : 'Anything to add? (optional)'} htmlFor="changes-note">
          <Textarea id="changes-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} autoFocus />
        </Field>
      )}
    </Dialog>
  )
}
