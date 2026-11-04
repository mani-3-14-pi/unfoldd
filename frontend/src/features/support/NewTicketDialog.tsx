import { useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { useIdempotencyKey } from '@/hooks/useIdempotencyKey'
import { errorMessage, fieldErrors } from '@/lib/errors'
import { supportApi, TICKET_CATEGORIES, type Ticket, type TicketCategory } from './api'
import { categoryLabel } from './labels'

/** "Report issue" (D67): a ticket to the Unfoldd team, with the page it was raised from. */
export function NewTicketDialog({ fromUrl, onClose, onCreated }: { fromUrl?: string; onClose: () => void; onCreated: (t: Ticket) => void }) {
  const [category, setCategory] = useState<TicketCategory>('question')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const idem = useIdempotencyKey()
  const create = useMutation({
    mutationFn: () => supportApi.create({ category, subject: subject.trim(), message: message.trim(), context: fromUrl ? { url: fromUrl } : undefined }, idem.key),
    onSuccess: ({ ticket }) => onCreated(ticket),
  })
  const errors = fieldErrors(create.error)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    create.mutate()
  }
  return (
    <Dialog
      title="Contact Unfoldd support"
      description="We answer here and by email. For anything about a client’s work, talk to your team instead."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="ticket-form" loading={create.isPending} disabled={subject.trim().length < 3 || !message.trim()}>
            Send
          </Button>
        </>
      }
    >
      <form id="ticket-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field label="What’s it about?" htmlFor="tk-category" error={errors.category}>
          <Select id="tk-category" value={category} onChange={(e) => setCategory(e.target.value as TicketCategory)}>
            {TICKET_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {categoryLabel[c]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Subject" htmlFor="tk-subject" error={errors.subject}>
          <Input id="tk-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} autoFocus aria-invalid={!!errors.subject} />
        </Field>
        <Field label="Message" htmlFor="tk-message" hint="What happened, and what you expected. Include the page or client if it helps." error={errors.message}>
          <Textarea id="tk-message" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={10_000} className="min-h-32" />
        </Field>
        {create.isError && Object.keys(errors).length === 0 && <p className="text-[13px] text-negative">{errorMessage(create.error)}</p>}
      </form>
    </Dialog>
  )
}
