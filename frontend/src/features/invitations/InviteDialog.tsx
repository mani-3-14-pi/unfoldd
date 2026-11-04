import { useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Input, Textarea } from '@/components/ui/Field'
import { useIdempotencyKey } from '@/hooks/useIdempotencyKey'
import { cn } from '@/lib/cn'
import { errorMessage, fieldErrors } from '@/lib/errors'
import { toast } from '@/lib/toast'

export interface RoleOption<R extends string> {
  value: R
  label: string
  hint: string
}

/**
 * Invite someone by email with a role. The link is bound to that email and expires in 7 days (D49).
 * Used for the agency team and for a client's people.
 */
export function InviteDialog<R extends string>({
  title,
  description,
  roles,
  defaultRole,
  send,
  onClose,
  onSent,
}: {
  title: string
  description: string
  roles: RoleOption<R>[]
  defaultRole: R
  send: (body: { email: string; role: R; message?: string }, idempotencyKey: string) => Promise<unknown>
  onClose: () => void
  onSent: () => void
}) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<R>(defaultRole)
  const [message, setMessage] = useState('')
  const idem = useIdempotencyKey()

  const mutation = useMutation({
    mutationFn: () => send({ email: email.trim(), role, message: message.trim() || undefined }, idem.key),
    onSuccess: () => {
      toast(`Invitation sent to ${email.trim()}`)
      onSent()
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
      title={title}
      description={description}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="invite-form" loading={mutation.isPending}>
            Send invitation
          </Button>
        </>
      }
    >
      <form id="invite-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field label="Email" htmlFor="invite-email" error={errors.email}>
          <Input
            id="invite-email"
            type="email"
            autoComplete="off"
            autoFocus
            value={email}
            placeholder="name@company.com"
            aria-invalid={!!errors.email}
            onChange={(e) => {
              setEmail(e.target.value)
              if (mutation.isError) mutation.reset()
            }}
          />
        </Field>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-xs font-medium text-text-2">Role</legend>
          {roles.map((r) => (
            <label
              key={r.value}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5',
                role === r.value ? 'border-brand-border bg-green-soft/40' : 'border-border-strong hover:bg-surface',
              )}
            >
              <input type="radio" name="invite-role" className="mt-0.5 size-4 accent-brand" checked={role === r.value} onChange={() => setRole(r.value)} />
              <span>
                <span className="block text-[13px] font-medium">{r.label}</span>
                <span className="block text-xs text-text-3">{r.hint}</span>
              </span>
            </label>
          ))}
          {errors.role && <p className="text-xs text-negative">{errors.role}</p>}
        </fieldset>
        <Field label="Message (optional)" htmlFor="invite-message" hint="Shown on the invitation." error={errors.message}>
          <Textarea id="invite-message" maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} />
        </Field>
        {mutation.isError && Object.keys(errors).length === 0 && <p className="text-[13px] text-negative">{errorMessage(mutation.error)}</p>}
      </form>
    </Dialog>
  )
}
