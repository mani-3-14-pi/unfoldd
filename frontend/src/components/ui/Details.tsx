import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/** Label/value pairs in a two-column grid inside a Card. Empty values show a dash. */
export function Details({ rows, className }: { rows: { label: string; value: ReactNode; wide?: boolean }[]; className?: string }) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-4 px-5 py-4 sm:grid-cols-2', className)}>
      {rows.map(({ label, value, wide }) => (
        <div key={label} className={cn('min-w-0', wide && 'sm:col-span-2')}>
          <dt className="text-xs text-text-3">{label}</dt>
          <dd className="mt-0.5 text-[13px] break-words whitespace-pre-line">{value || value === 0 ? value : '—'}</dd>
        </div>
      ))}
    </dl>
  )
}
