import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Textarea } from '@/components/ui/Field'
import { errorMessage, fieldErrors } from '@/lib/errors'
import { toast } from '@/lib/toast'
import { adminApi } from './api'
import { actionCopy, type Action, type Target } from './agencyActions'

export function AgencyActionDialog({ action, agency, onClose }: { action: Action; agency: Target; onClose: () => void }) {
  const c = actionCopy[action]
  const qc = useQueryClient()
  const [reason, setReason] = useState('')

  const mutation = useMutation({
    mutationFn: async () => {
      if (action !== 'impersonate') return adminApi.agencyAction(agency._id, action, reason.trim())
      // Open the tab now, while the click still counts as a user gesture, then point it at the portal.
      const tab = window.open('', '_blank')
      try {
        const { url } = await adminApi.impersonate(agency._id)
        if (tab) tab.location.href = url
        else window.location.href = url
      } catch (err) {
        tab?.close()
        throw err
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin'] })
      toast(c.done(agency.name))
      onClose()
    },
  })
  const errors = fieldErrors(mutation.error)

  return (
    <Dialog
      title={c.title(agency.name)}
      description={c.body}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={c.variant} loading={mutation.isPending} onClick={() => mutation.mutate()}>
            {c.confirm}
          </Button>
        </>
      }
    >
      {action === 'impersonate' && agency.status !== 'active' && (
        <p className="mb-3 rounded-lg bg-amber-soft px-3 py-2 text-xs text-amber-ink">
          This agency is {agency.status}. Its own team can’t log in, but you can still look around.
        </p>
      )}
      {c.reason && (
        <Field label="Reason" htmlFor="action-reason" error={errors.reason} hint="Shown to the agency when they try to log in, and kept in the activity log.">
          <Textarea
            id="action-reason"
            value={reason}
            maxLength={500}
            autoFocus
            placeholder={action === 'suspend' ? 'e.g. Payment overdue' : 'e.g. Not a creative agency'}
            onChange={(e) => {
              setReason(e.target.value)
              if (mutation.isError) mutation.reset()
            }}
            aria-invalid={!!errors.reason}
          />
        </Field>
      )}
      {mutation.isError && !errors.reason && <p className="text-[13px] text-negative">{errorMessage(mutation.error)}</p>}
    </Dialog>
  )
}
