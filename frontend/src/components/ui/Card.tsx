import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { Tone } from './Pill'

export function Card({
  title,
  description,
  action,
  children,
  className,
  tone,
}: {
  title?: string
  description?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  tone?: 'danger'
}) {
  return (
    <section className={cn('rounded-xl border bg-surface', tone === 'danger' ? 'border-red-soft' : 'border-border', className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            {title && <h2 className="text-sm font-semibold">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-text-3">{description}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  )
}

const iconTones: Record<Tone, string> = {
  green: 'bg-[#e9f0ec] text-[#1f4a3a]',
  amber: 'bg-[#faf0e3] text-[#b36d27]',
  red: 'bg-[#fceae8] text-[#c3313d]',
  indigo: 'bg-indigo-soft text-indigo-ink',
  blue: 'bg-blue-soft text-blue-ink',
  gray: 'bg-gray-soft text-gray-ink',
}

/** Icon tile, label and a large number, as in the prototype's dashboard. */
export function StatCard({
  label,
  value,
  icon: Icon,
  tone,
  note,
}: {
  label: string
  value: ReactNode
  icon: LucideIcon
  tone: Tone
  note?: ReactNode
}) {
  return (
    <article className="flex items-start gap-5 rounded-xl border border-border bg-surface px-4 py-3.5">
      <div className={cn('grid size-11 shrink-0 place-items-center rounded-lg', iconTones[tone])}>
        <Icon size={24} strokeWidth={1.8} />
      </div>
      <div className="min-w-0">
        <div className="text-[13px] text-[#4d5058]">{label}</div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-[32px] leading-none font-semibold tracking-tight">{value}</span>
          {note && <span className="text-xs text-text-3">{note}</span>}
        </div>
      </div>
    </article>
  )
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-2 px-4 py-12 text-center">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children && <p className="text-[13px] text-text-3">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
