import type { ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router'
import { cn } from '@/lib/cn'

/** The dashboard's card, in the prototype's Home style: a bold display title and an optional "View all →" link. */
export function DashCard({
  title,
  description,
  viewAll,
  action,
  children,
  className,
}: {
  title: string
  description?: ReactNode
  viewAll?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('flex flex-col rounded-2xl border border-border bg-surface', className)}>
      <header className="flex items-start justify-between gap-4 px-5 pt-5 pb-3">
        <div className="min-w-0">
          <h2 className="font-display text-lg leading-tight font-bold tracking-[-0.01em]">{title}</h2>
          {description && <p className="mt-1 text-[13px] text-text-3">{description}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {action}
          {viewAll && (
            <Link to={viewAll} className="inline-flex items-center gap-1 text-xs font-medium text-text-3 hover:text-brand">
              View all <ArrowRight size={14} strokeWidth={1.8} />
            </Link>
          )}
        </div>
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  )
}
