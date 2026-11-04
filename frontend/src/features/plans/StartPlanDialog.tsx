import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Select, Textarea } from '@/components/ui/Field'
import { ClientSelect } from '@/features/planning/ClientSelect'
import { monthLabel, upcomingMonths } from '@/features/planning/months'
import { useIdempotencyKey } from '@/hooks/useIdempotencyKey'
import { ApiError } from '@/lib/api'
import { errorMessage, fieldErrors } from '@/lib/errors'
import { plansApi } from './api'

/** P37: one plan per client per month. If it already exists, the server says so and we open that one. */
export function StartPlanDialog({ clientId: fixedClient, onClose, onSaved }: { clientId?: string; onClose: () => void; onSaved: (id: string) => void }) {
  const [months] = useState(() => upcomingMonths(new Date(), 12))
  const [clientId, setClientId] = useState(fixedClient ?? '')
  const [month, setMonth] = useState(months[1] ?? months[0]!)
  const [note, setNote] = useState('')
  const idem = useIdempotencyKey()
  const save = useMutation({
    mutationFn: () => plansApi.create({ client: clientId, month, note: note.trim() }, idem.key),
    onSuccess: ({ plan }) => onSaved(plan._id),
  })
  const errors = fieldErrors(save.error)
  const existing = save.error instanceof ApiError && save.error.code === 'plan_exists' ? (save.error.details as { planId?: string } | undefined)?.planId : undefined

  return (
    <Dialog
      title="Start a content plan"
      description="Plan a month of content for one client, then send it for their review."
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          {existing ? (
            <Button variant="primary" onClick={() => onSaved(existing)}>
              Open that plan
            </Button>
          ) : (
            <Button variant="primary" loading={save.isPending} disabled={!clientId} onClick={() => save.mutate()}>
              Start plan
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Client" htmlFor="plan-client" error={errors.client}>
          <ClientSelect id="plan-client" value={clientId} onChange={setClientId} allLabel="Choose a client…" disabled={!!fixedClient} />
        </Field>
        <Field label="Month" htmlFor="plan-month" error={errors.month}>
          <Select id="plan-month" value={month} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Note (optional)" htmlFor="plan-note" hint="For your team, e.g. the month’s themes." error={errors.note}>
          <Textarea id="plan-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
        </Field>
        {save.isError && Object.keys(errors).length === 0 && <p className="text-[13px] text-negative">{errorMessage(save.error)}</p>}
      </div>
    </Dialog>
  )
}
