import type { ReactNode } from 'react'
import { ChevronLeft } from 'lucide-react'
import { Link } from 'react-router'

/** The title row of a client-app page, with an optional way back (big enough to tap). */
export function ClientPageHeader({ title, back, description, action }: { title: ReactNode; back?: { to: string; label: string }; description?: ReactNode; action?: ReactNode }) {
  return (
    <header className="mb-5">
      {back && (
        <Link to={back.to} className="-ml-2 mb-1 inline-flex h-11 items-center gap-1 rounded-lg pr-2 pl-1 text-[13px] text-text-3 hover:text-text">
          <ChevronLeft size={18} /> {back.label}
        </Link>
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-1 text-[13px] text-text-3">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </header>
  )
}

/** A row in a client-app list: a full-width tap target with an icon, a title, a detail and an end slot. */
export function ClientRow({ icon, title, detail, end, className }: { icon?: ReactNode; title: ReactNode; detail?: ReactNode; end?: ReactNode; className?: string }) {
  return (
    <span className={`flex min-h-14 items-center gap-3 px-4 py-3 ${className ?? ''}`}>
      {icon && <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-input text-text-2">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium text-text">{title}</span>
        {detail && <span className="mt-0.5 block truncate text-xs text-text-3">{detail}</span>}
      </span>
      {end}
    </span>
  )
}
