import type { ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import { errorMessage } from '@/lib/errors'
import { Button, type ButtonVariant } from './Button'
import { Dialog } from './Dialog'

/** "Are you sure?" for one action. Runs `action`, shows its error in place, closes on success. */
export function ConfirmDialog({
  title,
  children,
  confirm,
  variant = 'primary',
  action,
  onClose,
  onDone,
}: {
  title: string
  children?: ReactNode
  confirm: string
  variant?: ButtonVariant
  action: () => Promise<unknown>
  onClose: () => void
  onDone?: (result: unknown) => void
}) {
  const mutation = useMutation({
    mutationFn: action,
    onSuccess: (result) => {
      onDone?.(result)
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
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={variant} loading={mutation.isPending} onClick={() => mutation.mutate()} autoFocus>
            {confirm}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[13px] text-text-2">
        {children}
        {mutation.isError && <p className="text-negative">{errorMessage(mutation.error)}</p>}
      </div>
    </Dialog>
  )
}
