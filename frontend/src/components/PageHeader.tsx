import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router'

export function PageHeader({
  title,
  description,
  actions,
  back,
  meta,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  back?: { to: string; label: string }
  meta?: ReactNode
}) {
  return (
    <header className="mb-6">
      {back && (
        <Link to={back.to} className="mb-3 inline-flex items-center gap-1.5 text-xs text-text-3 hover:text-text">
          <ArrowLeft size={14} /> {back.label}
        </Link>
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-[30px] leading-[1.1] font-bold tracking-[-0.02em] sm:text-[38px]">{title}</h1>
            {meta}
          </div>
          {description && <p className="mt-1.5 text-sm text-text-2 sm:text-[15px]">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </div>
    </header>
  )
}
