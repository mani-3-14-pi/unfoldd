import type { ReactNode } from 'react'
import { NavLink } from 'react-router'
import { cn } from '@/lib/cn'

/** Underlined section tabs that are routes (`/clients/:id/members`), so each tab has its own URL. */
export function TabNav({ label, tabs }: { label: string; tabs: { to: string; label: string; count?: ReactNode }[] }) {
  return (
    <nav className="mb-5 flex gap-1 overflow-x-auto border-b border-border" aria-label={label}>
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end
          replace
          className={({ isActive }) =>
            cn('-mb-px border-b-2 px-3.5 pb-2.5 text-[13px] whitespace-nowrap', isActive ? 'border-brand font-medium text-text' : 'border-transparent text-text-3 hover:text-text')
          }
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 text-text-4">{t.count}</span>}
        </NavLink>
      ))}
    </nav>
  )
}
