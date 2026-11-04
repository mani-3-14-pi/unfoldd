import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export type Tone = 'green' | 'amber' | 'blue' | 'red' | 'gray' | 'indigo'

const tones: Record<Tone, string> = {
  green: 'bg-green-soft text-green-ink [--dot:var(--color-green-dot)]',
  amber: 'bg-amber-soft text-amber-ink [--dot:var(--color-amber-dot)]',
  blue: 'bg-blue-soft text-blue-ink [--dot:var(--color-blue-dot)]',
  red: 'bg-red-soft text-red-ink [--dot:var(--color-red-dot)]',
  gray: 'bg-gray-soft text-gray-ink [--dot:var(--color-gray-dot)]',
  indigo: 'bg-indigo-soft text-indigo-ink [--dot:var(--color-indigo-ink)]',
}

/** Rounded status label with a coloured dot, as in the prototype's client table. */
export function Pill({ tone, children, dot = true, className }: { tone: Tone; children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[11px] font-medium',
        tones[tone],
        className,
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-(--dot)" aria-hidden="true" />}
      {children}
    </span>
  )
}
