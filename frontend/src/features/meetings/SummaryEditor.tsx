import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { CheckCircle2, ClipboardList, Plus, Send, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Pill } from '@/components/ui/Pill'
import { useIdempotencyKey } from '@/hooks/useIdempotencyKey'
import { errorMessage, fieldErrors } from '@/lib/errors'
import { formatDate, formatDateTime } from '@/lib/format'
import { toast } from '@/lib/toast'
import { meetingsApi, type ActionItem, type Meeting } from './api'

type Draft = Pick<ActionItem, 'text' | 'side' | 'assignee' | 'due'>

/**
 * P106–P109 / D23–D24: the summary, decisions and action items. A draft only your team sees; sharing locks it,
 * shows it to the client, and turns agency items into tasks and client items into requests ("needed from you").
 */
export function SummaryEditor({ meeting: m, people, writable, onChanged }: { meeting: Meeting; people: { _id: string; name: string }[]; writable: boolean; onChanged: () => void }) {
  const shared = m.summary.status === 'shared'
  const [text, setText] = useState(m.summary.text)
  const [decisions, setDecisions] = useState(m.summary.decisions)
  const [items, setItems] = useState<Draft[]>(m.summary.actionItems.map(({ text: t, side, assignee, due }) => ({ text: t, side, assignee, due })))
  const [confirming, setConfirming] = useState(false)
  const idem = useIdempotencyKey()

  const clean = () => ({
    text,
    decisions: decisions.map((d) => d.trim()).filter(Boolean),
    actionItems: items.filter((i) => i.text.trim()).map((i) => ({ ...i, text: i.text.trim(), assignee: i.side === 'agency' ? i.assignee : null })),
  })
  const save = useMutation({
    mutationFn: () => meetingsApi.summary(m._id, clean()),
    onSuccess: () => {
      toast('Summary saved')
      onChanged()
    },
  })
  const errors = fieldErrors(save.error)
  const name = (id: string | null) => people.find((p) => p._id === id)?.name

  if (shared) {
    return (
      <Card title="Summary" description={`Shared with the client ${formatDateTime(m.summary.sharedAt)}${m.summary.sharedBy ? ` by ${m.summary.sharedBy.name}` : ''}. It’s locked now.`}>
        <div className="flex flex-col gap-5 px-5 py-4">
          <p className="text-[13px] whitespace-pre-line">{m.summary.text || <span className="text-text-4">No summary text.</span>}</p>
          {m.summary.decisions.length > 0 && (
            <div>
              <h3 className="mb-1.5 text-xs font-semibold text-text-3">Decisions</h3>
              <ul className="flex list-disc flex-col gap-1 pl-5 text-[13px]">
                {m.summary.decisions.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </div>
          )}
          {m.summary.actionItems.length > 0 && (
            <div>
              <h3 className="mb-1.5 text-xs font-semibold text-text-3">Action items</h3>
              <ul className="flex flex-col gap-2">
                {m.summary.actionItems.map((a, i) => (
                  <li key={a._id ?? i} className="flex flex-wrap items-center gap-2 text-[13px]">
                    <CheckCircle2 size={14} className="text-text-4" />
                    <span className="flex-1">{a.text}</span>
                    <Pill tone={a.side === 'client' ? 'amber' : 'blue'} dot={false}>
                      {a.side === 'client' ? 'Needed from client · request' : `${name(a.assignee) ?? 'Team'} · task`}
                    </Pill>
                    {a.due && <span className="text-xs text-text-3">due {formatDate(a.due)}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Card>
    )
  }

  return (
    <Card
      title="Summary"
      description="A draft only your team sees, until you share it. The transcript is never shared."
      action={
        writable && (
          <div className="flex gap-2">
            <Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>
              Save draft
            </Button>
            <Button size="sm" variant="primary" onClick={() => setConfirming(true)} disabled={!text.trim() && !decisions.length && !items.length}>
              <Send size={13} /> Share with client
            </Button>
          </div>
        )
      }
    >
      <fieldset disabled={!writable} className="flex flex-col gap-5 px-5 py-4">
        <Field label="Summary" htmlFor="sum-text">
          <Textarea id="sum-text" maxLength={20_000} value={text} onChange={(e) => setText(e.target.value)} className="min-h-28" placeholder="What was discussed, in a few lines." />
        </Field>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-xs font-medium text-text-2">Decisions</legend>
          {decisions.map((d, i) => (
            <div key={i} className="flex gap-2">
              <Input aria-label={`Decision ${i + 1}`} maxLength={1000} value={d} onChange={(e) => setDecisions((x) => x.map((y, j) => (j === i ? e.target.value : y)))} />
              <Button variant="ghost" aria-label="Remove decision" onClick={() => setDecisions((x) => x.filter((_, j) => j !== i))}>
                <Trash2 size={14} />
              </Button>
            </div>
          ))}
          <Button size="sm" className="self-start" onClick={() => setDecisions((x) => [...x, ''])} disabled={decisions.length >= 50}>
            <Plus size={14} /> Add decision
          </Button>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-xs font-medium text-text-2">Action items</legend>
          <p className="-mt-1 text-xs text-text-3">Your team’s become tasks; the client’s become requests in their Needed From You.</p>
          {items.map((a, i) => {
            const update = (patch: Partial<Draft>) => setItems((x) => x.map((y, j) => (j === i ? { ...y, ...patch } : y)))
            return (
              <div key={i} className="grid gap-2 rounded-lg border border-border-strong bg-white p-2.5 sm:grid-cols-[minmax(0,1fr)_140px_160px_140px_auto]">
                <Input aria-label="Action" maxLength={500} placeholder="What needs doing" value={a.text} onChange={(e) => update({ text: e.target.value })} />
                <Select aria-label="Whose" value={a.side} onChange={(e) => update({ side: e.target.value as Draft['side'] })}>
                  <option value="agency">Our team</option>
                  <option value="client">The client</option>
                </Select>
                {a.side === 'agency' ? (
                  <Select aria-label="Assignee" value={a.assignee ?? ''} onChange={(e) => update({ assignee: e.target.value || null })}>
                    <option value="">Whoever shares</option>
                    {people.map((p) => (
                      <option key={p._id} value={p._id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <span className="flex items-center px-1 text-xs text-text-3">Needed from client</span>
                )}
                <Input aria-label="Due" type="date" value={a.due} onChange={(e) => update({ due: e.target.value })} />
                <Button variant="ghost" aria-label="Remove action item" onClick={() => setItems((x) => x.filter((_, j) => j !== i))}>
                  <Trash2 size={14} />
                </Button>
              </div>
            )
          })}
          <Button size="sm" className="self-start" onClick={() => setItems((x) => [...x, { text: '', side: 'agency', assignee: null, due: '' }])} disabled={items.length >= 50}>
            <ClipboardList size={14} /> Add action item
          </Button>
          {errors.actionItems && <p className="text-xs text-negative">{errors.actionItems}</p>}
        </fieldset>
        {save.isError && Object.keys(errors).length === 0 && <p className="text-[13px] text-negative">{errorMessage(save.error)}</p>}
      </fieldset>

      {confirming && (
        <ConfirmDialog
          title="Share the summary with the client?"
          confirm="Share"
          action={async () => {
            // Save what's on screen first, so the client gets exactly this.
            await meetingsApi.summary(m._id, clean())
            return meetingsApi.share(m._id, idem.key)
          }}
          onClose={() => setConfirming(false)}
          onDone={() => {
            toast('Summary shared with the client')
            onChanged()
          }}
        >
          <p>The client sees the summary, decisions and action items. After this the summary can’t be changed.</p>
          {(() => {
            const tasks = items.filter((i) => i.text.trim() && i.side === 'agency').length
            const requests = items.filter((i) => i.text.trim() && i.side === 'client').length
            return tasks + requests > 0 ? (
              <p>
                It creates {tasks} task{tasks === 1 ? '' : 's'} for your team and {requests} request{requests === 1 ? '' : 's'} for the client.
              </p>
            ) : null
          })()}
        </ConfirmDialog>
      )}
    </Card>
  )
}
