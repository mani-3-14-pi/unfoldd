import { useEffect, useId, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * Modal dialog on the native <dialog> element (focus trap, Escape and the top layer come free).
 * Render it only while open; it opens on mount and calls `onClose` on Escape, the X or a backdrop click.
 */
export function Dialog({
  title,
  description,
  onClose,
  children,
  footer,
  size = 'md',
}: {
  title: string
  description?: ReactNode
  onClose: () => void
  children?: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
      className={cn(
        'm-auto w-[calc(100%-32px)] rounded-2xl border border-border bg-white p-0 text-text shadow-2xl backdrop:bg-[#0a1325]/40',
        size === 'sm' ? 'max-w-md' : size === 'lg' ? 'max-w-3xl' : 'max-w-xl',
      )}
    >
      <div className="flex items-start justify-between gap-4 px-6 pt-5">
        <div>
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
          {description && <div className="mt-1 text-[13px] text-text-3">{description}</div>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mr-2 grid size-8 place-items-center rounded-lg text-text-3 hover:bg-black/5"
        >
          <X size={18} />
        </button>
      </div>
      {children && <div className="px-6 py-4">{children}</div>}
      {footer && <div className="flex justify-end gap-2 border-t border-border px-6 py-3.5">{footer}</div>}
    </dialog>
  )
}
