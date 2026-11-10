import { useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink } from 'react-router'
import { cn } from '@/lib/cn'

/** Underlined section tabs that are routes (`/clients/:id/members`), so each tab has its own URL. */
export function TabNav({ label, tabs }: { label: string; tabs: { to: string; label: string; count?: ReactNode }[] }) {
  const ref = useRef<HTMLElement>(null)
  // True while tabs are hidden past the right edge; the edge then fades to show there's more to scroll to.
  const [more, setMore] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
    check()
    el.addEventListener('scroll', check, { passive: true })
    const observer = new ResizeObserver(check)
    observer.observe(el)
    return () => {
      el.removeEventListener('scroll', check)
      observer.disconnect()
    }
  }, [tabs.length])

  return (
    <nav
      ref={ref}
      className={cn(
        'mb-5 flex gap-1 overflow-x-auto border-b border-border [scrollbar-width:thin]',
        more && '[mask-image:linear-gradient(to_right,black_calc(100%-48px),transparent)]',
      )}
      aria-label={label}
    >
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
