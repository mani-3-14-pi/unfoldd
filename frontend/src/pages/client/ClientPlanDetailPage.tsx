import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, ChevronRight, MessageSquare, Send, Sparkles, ThumbsDown } from 'lucide-react'
import { useParams } from 'react-router'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/Card'
import { Dialog } from '@/components/ui/Dialog'
import { Details } from '@/components/ui/Details'
import { Pill } from '@/components/ui/Pill'
import { useClientSession } from '@/features/agency/session'
import { ClientPageHeader } from '@/features/client-app/ClientPageHeader'
import { clientPlanKey, clientPlansApi, monthLabel, type ClientPlan, type PlanItem } from '@/features/client-app/plans/api'
import { PlanComments } from '@/features/client-app/plans/PlanComments'
import { PlanStatusPill } from '@/features/client-app/plans/pills'
import { formatLabel, platformLabel } from '@/features/content/labels'
import { useIdempotencyKey } from '@/hooks/useIdempotencyKey'
import { ApiError } from '@/lib/api'
import { errorMessage } from '@/lib/errors'
import { formatDate, timeAgo } from '@/lib/format'
import { toast } from '@/lib/toast'
import { formatInZone } from '@/lib/zonedTime'

/**
 * F46/F47: one monthly plan. The client comments on the whole plan or on items (drafts until sent), then an
 * Admin or Approver approves it or requests changes (D34: a checkpoint, not a gate; D80: changes need a comment).
 */
export function ClientPlanDetailPage() {
  const { id = '' } = useParams()
  const query = useQuery({ queryKey: clientPlanKey(id), queryFn: () => clientPlansApi.get(id) })
  const [open, setOpen] = useState<PlanItem | null>(null)
  const back = { to: '/c/plans', label: 'Plans' }

  if (query.isPending) return <ClientPageHeader title="Content plan" back={back} />
  if (query.isError) {
    return (
      <>
        <ClientPageHeader title="Content plan" back={back} />
        <EmptyState title="Couldn’t open this plan">{errorMessage(query.error)}</EmptyState>
      </>
    )
  }
  const p = query.data.plan
  const comments = (item: string) => p.threads.filter((t) => t.content === item).length
  const drafts = p.threads.filter((t) => t.draft).length

  return (
    <>
      <ClientPageHeader
        back={back}
        title={`${monthLabel(p.month)} plan`}
        description={p.decided ? `${p.status === 'approved' ? 'Approved' : 'Changes requested'} by ${p.decided.by ?? 'your team'} ${timeAgo(p.decided.at)}` : p.sentAt ? `Sent ${formatDate(p.sentAt)}` : undefined}
        action={<PlanStatusPill status={p.status} label={p.label} />}
      />

      {p.can.decide && (
        <p className="mb-4 rounded-2xl bg-amber-soft px-4 py-3 text-[13px] text-amber-ink">
          Your agency is waiting on you. Comment on anything you’d change, then approve the plan or request changes. Each creative still comes to you for approval later.
        </p>
      )}

      <section className="flex flex-col gap-2.5">
        <h2 className="text-sm font-semibold">
          {p.items.length} planned piece{p.items.length === 1 ? '' : 's'}
        </h2>
        {p.items.length === 0 ? (
          <EmptyState title="Nothing in this plan yet" />
        ) : (
          <ul className="flex flex-col gap-2.5">
            {p.items.map((i) => (
              <li key={i._id}>
                <button type="button" onClick={() => setOpen(i)} className="flex w-full items-start gap-3 rounded-2xl border border-border bg-white p-4 text-left hover:bg-surface">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-medium">{i.title}</span>
                    <span className="mt-0.5 block text-xs text-text-3">
                      {platformLabel[i.platform]} · {formatLabel[i.format]}
                      {i.publishDate && ` · ${formatDate(i.publishDate)}`}
                    </span>
                    {i.idea && <span className="mt-1.5 line-clamp-2 block text-[13px] text-text-2">{i.idea}</span>}
                    <span className="mt-2 flex flex-wrap gap-1.5">
                      {i.updatedSinceApproval && (
                        <Pill tone="indigo" dot={false}>
                          <Sparkles size={11} /> Updated since approval
                        </Pill>
                      )}
                      {i.inProduction && <Pill tone="blue">In production</Pill>}
                      {comments(i._id) > 0 && (
                        <Pill tone="gray" dot={false}>
                          <MessageSquare size={11} /> {comments(i._id)}
                        </Pill>
                      )}
                    </span>
                  </span>
                  <ChevronRight size={18} className="mt-1 shrink-0 text-text-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-7 flex flex-col gap-2.5">
        <h2 className="text-sm font-semibold">Comments on the whole plan</h2>
        <PlanComments planId={p.id} threads={p.threads} item={null} canComment={p.can.comment} />
      </section>

      {(p.can.decide || (p.can.comment && drafts > 0)) && <DecisionBar plan={p} drafts={drafts} />}

      {open && <ItemSheet plan={p} item={open} onClose={() => setOpen(null)} />}
    </>
  )
}

function ItemSheet({ plan: p, item: i, onClose }: { plan: ClientPlan; item: PlanItem; onClose: () => void }) {
  const s = useClientSession()
  return (
    <Dialog title={i.title} description={`${platformLabel[i.platform]} · ${formatLabel[i.format]}`} onClose={onClose} footer={<Button onClick={onClose}>Done</Button>}>
      <div className="flex flex-col gap-5">
        {i.updatedSinceApproval && <p className="rounded-xl bg-indigo-soft px-3 py-2 text-xs text-indigo-ink">This item changed after you approved the plan.</p>}
        <Details
          className="px-0 py-0 sm:grid-cols-1"
          rows={[
            { label: 'Planned for', value: i.publishDate ? formatInZone(i.publishDate, s.client.timezone, { withViewer: false }) : 'No date yet' },
            { label: 'Idea', value: i.idea },
            { label: 'Concept', value: i.concept },
            { label: 'Objective', value: i.objective },
            { label: 'Campaign', value: i.campaign },
          ]}
        />
        <div className="flex flex-col gap-2.5">
          <h3 className="text-sm font-semibold">Comments</h3>
          <PlanComments planId={p.id} threads={p.threads} item={i._id} canComment={p.can.comment} />
        </div>
      </div>
    </Dialog>
  )
}

type Decision = 'approve' | 'request_changes'

/** Sits above the tab bar: send drafts, or decide. A 409 means someone decided first; confirming goes ahead (D07). */
function DecisionBar({ plan: p, drafts }: { plan: ClientPlan; drafts: number }) {
  const qc = useQueryClient()
  const idem = useIdempotencyKey()
  const [conflict, setConflict] = useState<{ decision: Decision; message: string } | null>(null)
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['client', 'plans'] })
    void qc.invalidateQueries({ queryKey: ['client', 'home'] })
  }

  const send = useMutation({
    mutationFn: () => clientPlansApi.sendComments(p.id),
    onSuccess: ({ submitted }) => {
      toast(submitted ? `Sent ${submitted} comment${submitted === 1 ? '' : 's'} to your agency` : 'Nothing to send')
      refresh()
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  })
  const decide = useMutation({
    mutationFn: ({ decision, confirm }: { decision: Decision; confirm?: boolean }) => {
      const body = { expectedStatus: p.status, confirm }
      return decision === 'approve' ? clientPlansApi.approve(p.id, body, idem.key) : clientPlansApi.requestChanges(p.id, body, idem.key)
    },
    onSuccess: (_, { decision }) => {
      setConflict(null)
      idem.renew()
      toast(decision === 'approve' ? 'Plan approved. Your agency has been told.' : 'Changes requested. Your agency has your comments.')
      refresh()
    },
    onError: (e, { decision }) => {
      if (e instanceof ApiError && e.code === 'decided_meanwhile') setConflict({ decision, message: e.message })
      else toast(errorMessage(e), 'error')
    },
  })

  return (
    <>
      {/* Clears the bar so the last comments aren't hidden under it. */}
      <div className="h-24" aria-hidden="true" />
      <div className="fixed inset-x-0 bottom-16 z-20 border-t border-border bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2 px-4 py-3">
          {drafts > 0 && (
            <Button loading={send.isPending} onClick={() => send.mutate()}>
              <Send size={15} /> Send {drafts} comment{drafts === 1 ? '' : 's'}
            </Button>
          )}
          {p.can.decide && (
            <>
              <Button className="ml-auto" disabled={decide.isPending} onClick={() => decide.mutate({ decision: 'request_changes' })}>
                <ThumbsDown size={15} /> Request changes
              </Button>
              <Button variant="primary" loading={decide.isPending} onClick={() => decide.mutate({ decision: 'approve' })}>
                <CheckCircle2 size={15} /> Approve plan
              </Button>
            </>
          )}
        </div>
      </div>
      {conflict && (
        <Dialog
          title="Someone already decided"
          description={conflict.message}
          size="sm"
          onClose={() => setConflict(null)}
          footer={
            <>
              <Button onClick={() => setConflict(null)}>Leave it</Button>
              <Button variant="primary" loading={decide.isPending} onClick={() => decide.mutate({ decision: conflict.decision, confirm: true })}>
                {conflict.decision === 'approve' ? 'Approve anyway' : 'Request changes anyway'}
              </Button>
            </>
          }
        />
      )}
    </>
  )
}
