import { useState, type ComponentType, type ReactNode } from 'react'
import { Menu as MenuIcon, X } from 'lucide-react'
import { NavLink, Outlet } from 'react-router'
import { BrandMark } from '@/components/BrandMark'
import { cn } from '@/lib/cn'

type Icon = ComponentType<{ size?: number; strokeWidth?: number }>

export interface NavItem {
  label: string
  to: string
  icon: Icon
  end?: boolean
  /** A count shown at the right, e.g. pending approvals or unread notifications. */
  badge?: { count: number; label: string }
}

/**
 * The signed-in shell from the prototype: dark sidebar with nav groups and a footer card, content on the right.
 * Below `lg` the sidebar becomes a drawer behind a top bar. Shared by the platform admin and the agency portal.
 */
export function SidebarShell({
  product,
  header,
  groups,
  footer,
  banner,
  mobileTitle,
}: {
  /** The small caps line under the wordmark, e.g. "PLATFORM ADMIN". */
  product: string
  /** Optional block under the wordmark (the agency switcher). */
  header?: ReactNode
  groups: { label: string; items: NavItem[] }[]
  /** Gets a `close` callback so links inside it can shut the mobile drawer. */
  footer: (close: () => void) => ReactNode
  banner?: ReactNode
  mobileTitle: string
}) {
  const [navOpen, setNavOpen] = useState(false)
  const close = () => setNavOpen(false)

  const link = (item: NavItem) => (
    <NavLink
      key={item.to}
      to={item.to}
      end={item.end}
      onClick={close}
      className={({ isActive }) =>
        cn('flex h-10 items-center gap-4 rounded-lg pr-1.5 pl-4 text-[13px] transition-colors', isActive ? 'bg-sidebar-active' : 'hover:bg-white/6')
      }
    >
      <item.icon size={20} strokeWidth={1.6} />
      <span>{item.label}</span>
      {item.badge && item.badge.count > 0 && (
        <span className="ml-auto grid h-6 min-w-6 place-items-center rounded-full bg-[#f1d9d9] px-1.5 text-[11px] font-medium text-[#c9485e]">
          {item.badge.count > 99 ? '99+' : item.badge.count}
          <span className="sr-only"> {item.badge.label}</span>
        </span>
      )}
    </NavLink>
  )

  return (
    <div className="flex min-h-screen flex-col">
      {banner}
      <div className="flex min-h-0 flex-1">
        {navOpen && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" aria-hidden="true" onClick={close} />}
        <aside
          aria-label="Main navigation"
          className={cn(
            'fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col overflow-y-auto bg-sidebar-bg px-4 pt-6 pb-7 text-sidebar-text transition-transform',
            'lg:sticky lg:top-0 lg:h-screen lg:translate-x-0',
            navOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <div className="mb-7 flex h-10 items-center gap-3.5 pl-2">
            <BrandMark />
            <div>
              <div className="text-[22px] leading-none font-semibold tracking-tight">unfoldd</div>
              <div className="mt-1 text-[10px] font-medium tracking-wider text-sidebar-text/90">{product}</div>
            </div>
            <button type="button" onClick={close} aria-label="Close navigation" className="ml-auto grid size-8 place-items-center rounded-lg hover:bg-white/10 lg:hidden">
              <X size={20} />
            </button>
          </div>

          {header && <div className="mb-5">{header}</div>}

          {groups.map((group, i) => (
            <div key={group.label}>
              {i > 0 && <hr className="mt-6 mb-3 border-sidebar-line" />}
              <nav className="flex flex-col gap-1" aria-label={group.label}>
                {group.items.map(link)}
              </nav>
            </div>
          ))}

          <div className="mt-auto pt-6">{footer(close)}</div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-bg/90 px-4 backdrop-blur lg:hidden">
            <button type="button" onClick={() => setNavOpen(true)} aria-label="Open navigation" className="grid size-9 place-items-center rounded-lg hover:bg-black/5">
              <MenuIcon size={21} />
            </button>
            <span className="truncate font-semibold">{mobileTitle}</span>
          </header>
          <main className="flex-1 px-4 pt-6 pb-14 sm:px-7 lg:px-8 lg:pt-8">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  )
}

/** Avatar, name, a second line and a menu: the card at the bottom of the sidebar. */
export function SidebarUserCard({ name, detail, initials, menu }: { name: string; detail: ReactNode; initials: string; menu: ReactNode }) {
  return (
    <div className="flex h-14 items-center gap-2.5 rounded-xl border border-sidebar-line bg-sidebar-card pr-2 pl-2.5">
      <div className="grid size-9 shrink-0 place-items-center rounded-full bg-[#e6d2f5] text-xs font-medium text-[#3a1a3d]">{initials}</div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium">{name}</div>
        <div className="truncate text-[11px] text-sidebar-muted">{detail}</div>
      </div>
      {menu}
    </div>
  )
}
