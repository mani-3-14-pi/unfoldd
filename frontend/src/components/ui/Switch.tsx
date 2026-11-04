import { cn } from '@/lib/cn'

/** On/off switch: a real button with role="switch", so it's announced and keyboard-operable. */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
  id,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean
  id?: string
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
        checked ? 'bg-brand' : 'bg-[#d9d8dc]',
      )}
    >
      <span
        className={cn('inline-block size-4.5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-5' : 'translate-x-0.75')}
      />
    </button>
  )
}
