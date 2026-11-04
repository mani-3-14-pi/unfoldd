import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, ListPlus, MessageSquare, Plus, RotateCcw, Send } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { CellText, DataTable, type Column } from '@/components/list/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card, EmptyState } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Textarea } from '@/components/ui/Field'
import { Pill } from '@/components/ui/Pill'
import { isManagerPlus } from '@/features/agency/roles'
import { useAgencySession } from '@/features/agency/session'
import { formatLabel, platformLabel } from '@/features/content/labels'
import { StatePill, ThreadStatusPill } from '@/features/content/pills'
import { monthLabel } from '@/features/planning/months'
import { clientPickerQuery } from '@/features/planning/queries'
import { planKey, plansApi, type PlanDetail, type PlanItem, type PlanThread } from '@/features/plans/api'
import { AddPlanItemDialog, BulkAddDialog } from '@/features/plans/PlanItemDialogs'
import { PlanStatusPill } from '@/features/plans/pills'
import { activeTeamQuery } from '@/features/team/api'
import { errorMessage } from '@/lib/errors'
import { timeAgo } from '@/lib/format'
import { toast } from '@/lib/toast'
import { formatInZone } from '@/lib/zonedTime'

/**
 * P37–P41 / Flow 4: one client's plan for one month. Items are content rows in `planned` state (D33); approval
 * is an alignment checkpoint, not a gate (D34), so items keep moving after it and changes are flagged.
 */
export function PlanDetailPage() {
  const { id = '' } = useParams()
  const s = useAgencySession()
  const qc = useQueryClient()
  const query = useQuery({ queryKey: planKey(id), queryFn: () => plansApi.get(id) })
  const clients = useQuery(clientPickerQuery)
  const team = useQuery(activeTeamQuery)
  const [dialog, setDialog] = useState<'item' | 'bulk' | 'send' | null>(null)
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['agency', 'plans'] })
    void qc.invalidateQueries({ queryKey: ['agency', 'content'] })
  }

  const back = { to: '/app/plans', label: 'Content plans' }
  if (query.isPending) return <PageHeader title="Content plan" back={back} />
  if (query.isError) {
    return (
      <>
        <PageHeader title="Content plan" back={back} />
        <EmptyState title="Couldn’t open this plan">{errorMessage(query.error)}</EmptyState>
      </>
    )
  }
  const plan = query.data.plan
  const client = clients.data?.items.find((c) => c._id === plan.client)
  const tz = client?.timezone ?? s.agency.timezone
  const owner = (uid: string | null) => (uid ? (team.data?.items.find((m) => m.user._id === uid)?.user.name ?? '') : '')
  const canSend = isManagerPlus(s.role) && ['draft', 'changes_requested'].includes(plan.status)
  const threads = plan.threads.filter((t) => !t.draft)
  const commentsOn = (itemId: string) => threads.filter((t) => t.content === itemId).length

  const columns: Column<PlanItem>[] = [
    {
      key: 'title',
      header: 'Item',
      className: 'w-[34%]',
      cell: (i) => (
        <CellText
          primary={
            <span className="flex items-center gap-2">
              <Link to={`/app/content/${i._id}`} className="hover:underline">
                {i.title}
              </Link>
              {i.updatedSinceApproval && (
                <Pill tone="amber" dot={false}>
                  Updated since approval
                </Pill>
              )}
            </span>
          }
          secondary={`${platformLabel[i.platform]} · ${formatLabel[i.format]}`}
        />
      ),
    },
    { key: 'date', header: 'Planned for', cell: (i) => <span className="text-text-2">{i.publishDate ? formatInZone(i.publishDate, tz, { withViewer: false }) : 'No date'}</span> },
    { key: 'owner', header: 'Owner', cell: (i) => <span className="text-text-2">{owner(i.owner) || '—'}</span> },
    { key: 'state', header: 'Status', cell: (i) => <StatePill state={i.state} /> },
    {
      key: 'comments',
      header: 'Comments',
      cell: (i) =>
        commentsOn(i._id) > 0 ? (
          <span className="inline-flex items-center gap-1 text-text-2">
            <MessageSquare size={13} /> {commentsOn(i._id)}
          </span>
        ) : (
          <span className="text-text-4">—</span>
        ),
    },
  ]

  return (
    <>
      <PageHeader
        back={back}
        title={`${monthLabel(plan.month)} plan`}
        meta={<PlanStatusPill status={plan.status} />}
        description={
          <>
            {client && (
              <Link to={`/app/clients/${client._id}`} className="font-medium text-text-2 hover:underline">
                {client.brandName}
              </Link>
            )}
            {plan.decidedAt
              ? ` · ${plan.decidedBy?.name ?? 'The client'} ${plan.status === 'approved' ? 'approved it' : 'asked for changes'} ${timeAgo(plan.decidedAt)}`
              : plan.sentAt
                ? ` · sent by ${plan.sentBy?.name ?? 'your team'} ${timeAgo(plan.sentAt)}`
                : ' · not sent yet'}
          </>
        }
        actions={
          <>
            <Button onClick={() => setDialog('bulk')}>
              <ListPlus size={15} /> Add many
            </Button>
            <Button onClick={() => setDialog('item')}>
              <Plus size={15} /> Add item
            </Button>
            {canSend && (
              <Button variant="primary" disabled={!plan.items.length} onClick={() => setDialog('send')}>
                <Send size={15} /> {plan.status === 'changes_requested' ? 'Send again' : 'Send for review'}
              </Button>
            )}
          </>
        }
      />

      {plan.status === 'approved' && plan.items.some((i) => i.updatedSinceApproval) && (
        <p className="mb-4 rounded-lg border border-amber-soft bg-[#fdf8f1] px-4 py-2.5 text-[13px] text-amber-ink">
          Some items changed after the client approved the plan. The approval stands; the client was told what changed.
        </p>
      )}
      {plan.note && <p className="mb-4 rounded-lg bg-surface-input px-4 py-2.5 text-[13px] text-text-2">{plan.note}</p>}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <DataTable
          label="Plan items"
          columns={columns}
          rows={plan.items}
          rowKey={(i) => i._id}
          empty={
            <EmptyState
              title="No items yet"
              action={
                <Button variant="primary" onClick={() => setDialog('bulk')}>
                  <ListPlus size={16} /> Add many at once
                </Button>
              }
            >
              Add each idea one by one, or rough out the month, e.g. 12 Instagram posts and 4 LinkedIn posts.
            </EmptyState>
          }
        />
        <PlanComments plan={plan} threads={threads} onChanged={refresh} />
      </div>

      {dialog === 'item' && <AddPlanItemDialog plan={plan} timezone={tz} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === 'bulk' && <BulkAddDialog plan={plan} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === 'send' && (
        <ConfirmDialog
          title={`Send the ${monthLabel(plan.month)} plan to ${client?.brandName ?? 'the client'}?`}
          confirm="Send for review"
          action={() => plansApi.send(plan._id)}
          onClose={() => setDialog(null)}
          onDone={() => {
            toast('Plan sent for review')
            refresh()
          }}
        >
          <p>
            They’ll see all {plan.items.length} items, a banner on their home and a notification. Each creative is still approved on its own later; this is
            about agreeing the plan.
          </p>
        </ConfirmDialog>
      )}
    </>
  )
}

/** D80: the client's comments on the plan or on single items, with replies and a status. */
function PlanComments({ plan, threads, onChanged }: { plan: PlanDetail; threads: PlanThread[]; onChanged: () => void }) {
  const itemTitle = (id: string | null) => (id ? (plan.items.find((i) => i._id === id)?.title ?? 'A removed item') : 'The whole plan')
  return (
    <Card title="Client comments" description={plan.status === 'draft' ? 'Comments appear once the plan is sent.' : undefined}>
      {threads.length === 0 ? (
        <p className="px-5 py-6 text-[13px] text-text-3">No comments yet.</p>
      ) : (
        <ul className="flex flex-col gap-2 p-3">
          {threads.map((t) => (
            <PlanComment key={t._id} planId={plan._id} thread={t} on={itemTitle(t.content)} onChanged={onChanged} />
          ))}
        </ul>
      )}
    </Card>
  )
}

function PlanComment({ planId, thread: t, on, onChanged }: { planId: string; thread: PlanThread; on: string; onChanged: () => void }) {
  const [reply, setReply] = useState('')
  const [open, setOpen] = useState(false)
  const onError = (err: unknown) => toast(errorMessage(err), 'error')
  const send = useMutation({
    mutationFn: () => plansApi.reply(planId, t._id, reply.trim()),
    onSuccess: () => {
      setReply('')
      setOpen(false)
      onChanged()
    },
    onError,
  })
  const status = useMutation({ mutationFn: (next: 'open' | 'resolved') => plansApi.setThreadStatus(planId, t._id, next), onSuccess: onChanged, onError })
  const [first, ...replies] = t.messages

  return (
    <li className="rounded-lg border border-border-strong bg-white p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[13px] font-semibold">{t.author.name}</span>
        <span className="text-xs text-text-4">{timeAgo(t.submittedAt ?? t.createdAt)}</span>
        {t.status && <ThreadStatusPill status={t.status} />}
      </div>
      <p className="mt-0.5 text-[11px] text-text-4">on {on}</p>
      {first && <p className="mt-1.5 text-[13px] whitespace-pre-line">{first.body}</p>}
      {replies.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1.5 border-l-2 border-border-strong pl-3">
          {replies.map((m) => (
            <li key={m._id} className="text-[13px]">
              <span className="font-medium">{m.author.name}</span> <span className="text-xs text-text-4">{timeAgo(m.createdAt)}</span>
              <p className="whitespace-pre-line text-text-2">{m.body}</p>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
          <MessageSquare size={13} /> Reply
        </Button>
        {t.status !== 'resolved' ? (
          <Button size="sm" variant="ghost" loading={status.isPending} onClick={() => status.mutate('resolved')}>
            <CheckCircle2 size={13} /> Resolve
          </Button>
        ) : (
          <Button size="sm" variant="ghost" loading={status.isPending} onClick={() => status.mutate('open')}>
            <RotateCcw size={13} /> Reopen
          </Button>
        )}
      </div>
      {open && (
        <form
          className="mt-2 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (reply.trim()) send.mutate()
          }}
        >
          <Textarea autoFocus value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply to the client" maxLength={5000} className="min-h-16" />
          <div className="flex justify-end gap-2">
            <Button size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" type="submit" loading={send.isPending} disabled={!reply.trim()}>
              Reply
            </Button>
          </div>
        </form>
      )}
    </li>
  )
}
