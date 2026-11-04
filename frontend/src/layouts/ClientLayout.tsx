import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bell, CalendarDays, Check, ChevronDown, House, Inbox, LayoutGrid, LoaderCircle, LogOut, Menu as MenuIcon, Store } from 'lucide-react'
import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router'
import { Popover } from '@/components/ui/Popover'
import { sessionApi, sessionKey, type ClientSession } from '@/features/agency/api'
import { clientRoleLabel } from '@/features/agency/roles'
import { ClientSessionContext, useSessionActions } from '@/features/agency/session'
import { useClientSpace } from '@/features/client-app/space'
import { ClientSearchButton } from '@/features/search/ClientSearchButton'
import { workspaceApi } from '@/features/workspace/api'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { initials } from '@/lib/format'
import { toast } from '@/lib/toast'

/**
 * The Client App shell (mobile-first): the brand at the top, the bell, and five tabs at the bottom.
 * Checks the session for every page under /c: not signed in → login, in an agency → the portal.
 */
export function ClientLayout() {
  const location = useLocation()
  const me = useQuery({ queryKey: sessionKey, queryFn: sessionApi.me, retry: false, staleTime: 5 * 60_000 })

  if (me.isPending) {
    return (
      <div className="grid min-h-screen place-items-center text-text-3">
        <LoaderCircle className="animate-spin" />
      </div>
    )
  }
  if (me.isError) {
    if (me.error instanceof ApiError && me.error.status === 401) {
      const next = location.pathname + location.search
      return <Navigate to={`/login${next !== '/c' ? `?next=${encodeURIComponent(next)}` : ''}`} replace />
    }
    return <div className="grid min-h-screen place-items-center px-4 text-center text-sm text-negative">{errorMessage(me.error)}</div>
  }
  if (me.data.context === 'agency') return <Navigate to="/app" replace />

  return (
    <ClientSessionContext.Provider value={me.data}>
      <Shell session={me.data} />
    </ClientSessionContext.Provider>
  )
}

const TABS = [
  { to: '/c', label: 'Home', icon: House, end: true },
  { to: '/c/content', label: 'Content', icon: LayoutGrid },
  { to: '/c/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/c/requests', label: 'Needed', icon: Inbox },
  { to: '/c/more', label: 'More', icon: MenuIcon },
]

function Shell({ session: s }: { session: ClientSession }) {
  const space = useClientSpace()
  const unread = useQuery({ queryKey: ['client', 'notifications', 'unread'], queryFn: workspaceApi.unreadCount, refetchInterval: 60_000, staleTime: 30_000 })
  const count = unread.data?.count ?? 0
  const logo = space.data?.client.logoUrl

  return (
    <div className="min-h-screen bg-bg">
      <header className="sticky top-0 z-30 border-b border-border bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
          <BrandSwitcher session={s} logo={logo ?? null} />
          <div className="ml-auto flex items-center gap-1">
          <ClientSearchButton />
          <Link to="/c/notifications" aria-label={count ? `Notifications, ${count} unread` : 'Notifications'} className="relative grid size-10 place-items-center rounded-full hover:bg-black/5">
            <Bell size={20} strokeWidth={1.8} />
            {count > 0 && (
              <span className="absolute top-1.5 right-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-[#e5484d] px-1 text-[10px] font-semibold text-white">{count > 9 ? '9+' : count}</span>
            )}
          </Link>
          </div>
        </div>
      </header>

      {/* Room at the bottom for the tab bar. */}
      <main className="mx-auto max-w-3xl px-4 pt-5 pb-28">
        <Outlet />
      </main>

      <nav aria-label="Client app" className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="mx-auto grid max-w-3xl grid-cols-5">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) => cn('flex h-16 flex-col items-center justify-center gap-1 text-[11px]', isActive ? 'font-semibold text-brand' : 'text-text-3 hover:text-text')}
            >
              <t.icon size={21} strokeWidth={1.8} />
              {t.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}

/** The brand at the top. With more than one place to go (D43), it opens the switcher and log out. */
function BrandSwitcher({ session: s, logo }: { session: ClientSession; logo: string | null }) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const { switchTo, logout } = useSessionActions()
  const { agencies, clients } = s.contexts

  const go = async (target: { agencyId: string } | { clientId: string }) => {
    setOpen(false)
    try {
      await switchTo(target)
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }

  return (
    <>
      <button ref={trigger} type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex min-w-0 items-center gap-2.5 rounded-lg py-1 pr-2 pl-1 hover:bg-black/5">
        <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-lg bg-surface-input text-xs font-semibold text-text-2">
          {logo ? <img src={logo} alt="" className="size-full object-cover" /> : initials(s.client.brandName)}
        </span>
        <span className="min-w-0 text-left">
          <span className="block truncate text-sm font-semibold">{s.client.brandName}</span>
          <span className="block truncate text-[11px] text-text-3">with {s.agency.name}</span>
        </span>
        <ChevronDown size={16} className="shrink-0 text-text-3" />
      </button>
      {open && (
        <Popover anchor={trigger} onClose={() => setOpen(false)} width={290} align="start" label="Switch brand" role="menu">
          <div className="py-1.5">
            {clients.length > 1 && <div className="px-3.5 pt-1 pb-1 text-[11px] font-medium text-text-4">Brands</div>}
            {clients.length > 1 &&
              clients.map((c) => (
                <button
                  key={c.clientId}
                  type="button"
                  role="menuitem"
                  disabled={c.clientId === s.client.id}
                  onClick={() => void go({ clientId: c.clientId })}
                  className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left hover:bg-surface-input disabled:hover:bg-transparent"
                >
                  <Store size={16} className="shrink-0 text-text-3" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{c.brandName}</span>
                    <span className="block truncate text-[11px] text-text-3">
                      {c.agencyName} · {clientRoleLabel[c.role]}
                    </span>
                  </span>
                  {c.clientId === s.client.id && <Check size={16} className="text-brand" />}
                </button>
              ))}
            {agencies.length > 0 && <div className="mt-1 border-t border-border px-3.5 pt-2.5 pb-1 text-[11px] font-medium text-text-4">Your agencies</div>}
            {agencies.map((a) => (
              <button key={a.agencyId} type="button" role="menuitem" onClick={() => void go({ agencyId: a.agencyId })} className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[13px] hover:bg-surface-input">
                <House size={16} className="text-text-3" /> {a.name}
              </button>
            ))}
            <button type="button" role="menuitem" onClick={() => void logout(false)} className="mt-1 flex w-full items-center gap-2.5 border-t border-border px-3.5 py-2.5 text-left text-[13px] text-negative hover:bg-surface-input">
              <LogOut size={16} /> Log out
            </button>
          </div>
        </Popover>
      )}
    </>
  )
}
