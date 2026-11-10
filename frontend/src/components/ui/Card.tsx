import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Link } from 'react-router'
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

/** Icon tile, label and a large number, as in the prototype's dashboard. With `to`, the whole card links to the list behind the number. */
export function StatCard({
  label,
  value,
  icon: Icon,
  tone,
  note,
  to,
}: {
  label: string
  value: ReactNode
  icon: LucideIcon
  tone: Tone
  note?: ReactNode
  to?: string
}) {
  const body = (
    <>
      <div className={cn('grid size-12 shrink-0 place-items-center rounded-xl', iconTones[tone])}>
        <Icon size={24} strokeWidth={1.8} />
      </div>
      <div className="min-w-0">
        <div className="truncate text-[13px] text-[#4d5058]">{label}</div>
        <div className="mt-1.5 flex items-baseline gap-2">
          <span className="font-display text-[32px] leading-none font-bold tracking-tight">{value}</span>
          {note && <span className="text-xs leading-tight text-text-3">{note}</span>}
        </div>
      </div>
    </>
  )
  const box = 'flex min-h-[92px] items-start gap-4 rounded-2xl border border-border bg-surface px-5 py-4'
  return to ? (
    <Link to={to} className={cn(box, 'transition-colors hover:border-border-strong hover:bg-[#f6f5f6]')}>
      {body}
    </Link>
  ) : (
    <article className={box}>{body}</article>
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
