import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { CircleAlert } from 'lucide-react'
import { cn } from '@/lib/cn'

const control =
  'rounded-lg border border-border-strong bg-white px-3 text-[13px] text-text placeholder:text-text-4 ' +
  'transition-shadow focus:border-brand-border focus:outline-none focus:ring-4 focus:ring-brand/10 disabled:bg-surface-input'

/**
 * Controls are full width unless the caller gives a width (`w-44`, `sm:w-1/2` …). Both can't just be listed:
 * in Tailwind the stylesheet order decides between two width classes, not the order in `className`.
 */
const width = (className?: string) => (/(^|\s)([a-z0-9]+:)*w-/.test(className ?? '') ? undefined : 'w-full')

/** Label, control, then an error (or a hint). Pass the control's id as `htmlFor`. */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
  className,
}: {
  label: string
  htmlFor: string
  error?: string
  hint?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-text-2">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="flex items-center gap-1.5 text-xs text-negative">
          <CircleAlert size={13} strokeWidth={2} />
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-text-4">{hint}</p>
      )}
    </div>
  )
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(control, width(className), 'h-9', props['aria-invalid'] && 'border-negative', className)}
      aria-describedby={props['aria-invalid'] && props.id ? `${props.id}-error` : undefined}
      {...props}
    />
  )
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(control, width(className), 'min-h-20 py-2', props['aria-invalid'] && 'border-negative', className)}
      aria-describedby={props['aria-invalid'] && props.id ? `${props.id}-error` : undefined}
      {...props}
    />
  )
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(control, width(className), 'h-9 pr-8', className)} {...props}>
      {children}
    </select>
  )
}
