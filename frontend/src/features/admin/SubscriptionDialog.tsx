import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { errorMessage, fieldErrors } from '@/lib/errors'
import { toDateInput } from '@/lib/format'
import { toast } from '@/lib/toast'
import { adminApi, PLANS, SUBSCRIPTION_STATUSES, type Agency, type Plan, type SubscriptionStatus } from './api'
import { planLabel, subscriptionStatusLabel } from './labels'

/** Edit an agency's subscription record. Placeholder only: nothing is billed or enforced yet. */
export function SubscriptionDialog({ agency, onClose }: { agency: Pick<Agency, '_id' | 'name' | 'subscription'>; onClose: () => void }) {
  const qc = useQueryClient()
  const s = agency.subscription
  const [plan, setPlan] = useState<Plan>(s.plan)
  const [status, setStatus] = useState<SubscriptionStatus>(s.status)
  const [seats, setSeats] = useState(String(s.seats))
  const [renewsAt, setRenewsAt] = useState(toDateInput(s.renewsAt))
  const [notes, setNotes] = useState(s.notes ?? '')

  const mutation = useMutation({
    mutationFn: () => adminApi.updateSubscription(agency._id, { plan, status, seats: Number(seats), renewsAt: renewsAt || undefined, notes }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin'] })
      toast(`Updated ${agency.name}’s subscription`)
      onClose()
    },
  })
  const errors = fieldErrors(mutation.error)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    mutation.mutate()
  }

  return (
    <Dialog
      title="Edit subscription"
      description={
        <>
          {agency.name}. Billing isn’t connected yet, so these fields are a record only: changing them doesn’t charge the agency or
          change what they can use.
        </>
      }
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="subscription-form" loading={mutation.isPending}>
            Save subscription
          </Button>
        </>
      }
    >
      <form id="subscription-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Plan" htmlFor="sub-plan" error={errors.plan}>
          <Select id="sub-plan" value={plan} onChange={(e) => setPlan(e.target.value as Plan)}>
            {PLANS.map((p) => (
              <option key={p} value={p}>
                {planLabel[p]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status" htmlFor="sub-status" error={errors.status}>
          <Select id="sub-status" value={status} onChange={(e) => setStatus(e.target.value as SubscriptionStatus)}>
            {SUBSCRIPTION_STATUSES.map((st) => (
              <option key={st} value={st}>
                {subscriptionStatusLabel[st]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Seats" htmlFor="sub-seats" error={errors.seats}>
          <Input id="sub-seats" type="number" min={1} max={10000} value={seats} onChange={(e) => setSeats(e.target.value)} aria-invalid={!!errors.seats} />
        </Field>
        <Field label="Renews on" htmlFor="sub-renews" error={errors.renewsAt}>
          <Input id="sub-renews" type="date" value={renewsAt} onChange={(e) => setRenewsAt(e.target.value)} aria-invalid={!!errors.renewsAt} />
        </Field>
        <Field label="Internal notes" htmlFor="sub-notes" error={errors.notes} className="sm:col-span-2">
          <Textarea id="sub-notes" value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Annual deal, invoiced manually" />
        </Field>
        {mutation.isError && Object.keys(errors).length === 0 && <p className="text-[13px] text-negative sm:col-span-2">{errorMessage(mutation.error)}</p>}
      </form>
    </Dialog>
  )
}
