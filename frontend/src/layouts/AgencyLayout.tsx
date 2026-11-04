import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  BarChart3,
  Bell,
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  Ellipsis,
  Inbox,
  LayoutDashboard,
  LayoutGrid,
  LayoutTemplate,
  LifeBuoy,
  ListTodo,
  LoaderCircle,
  LogOut,
  Megaphone,
  MessagesSquare,
  PanelTop,
  Settings,
  Store,
  UserRound,
  Users,
  Video,
} from 'lucide-react'
import { Navigate, useLocation } from 'react-router'
import { Menu } from '@/components/ui/Menu'
import { sessionApi, sessionKey, type AgencySession } from '@/features/agency/api'
import { ContextSwitcher } from '@/features/agency/ContextSwitcher'
import { SearchButton } from '@/features/search/SearchButton'
import { agencyRoleLabel } from '@/features/agency/roles'
import { AgencySessionContext, useSessionActions } from '@/features/agency/session'
import { unreadKey, workspaceApi } from '@/features/workspace/api'
import { ApiError } from '@/lib/api'
import { errorMessage } from '@/lib/errors'
import { initials } from '@/lib/format'
import { SidebarShell, SidebarUserCard } from './SidebarShell'

/**
 * The agency portal shell. Checks the session once for every page under /app: not signed in → login,
 * signed in to a client space → the client app.
 */
export function AgencyLayout() {
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
      return <Navigate to={`/login${next !== '/app' ? `?next=${encodeURIComponent(next)}` : ''}`} replace />
    }
    return <div className="grid min-h-screen place-items-center px-4 text-center text-sm text-negative">{errorMessage(me.error)}</div>
  }
  if (me.data.context === 'client') return <Navigate to="/c" replace />

  return (
    <AgencySessionContext.Provider value={me.data}>
      <Shell session={me.data} />
    </AgencySessionContext.Provider>
  )
}

function Shell({ session: s }: { session: AgencySession }) {
  const { logout } = useSessionActions()
  // Polling is enough until the backend pushes events; the badge is the only live number in the shell.
  const unread = useQuery({ queryKey: unreadKey, queryFn: workspaceApi.unreadCount, refetchInterval: 60_000, staleTime: 30_000 })

  return (
    <SidebarShell
      product="AGENCY PORTAL"
      mobileTitle={s.agency.name}
      banner={s.support && <SupportBanner session={s} onExit={() => void logout(true)} />}
      header={
        <div className="flex flex-col gap-2">
          <ContextSwitcher current={{ agencyId: s.agency.id }} label={s.agency.name} contexts={s.contexts} />
          <SearchButton />
        </div>
      }
      groups={[
        {
          label: 'Workspace',
          items: [
            { label: 'Dashboard', to: '/app', icon: LayoutDashboard, end: true },
            { label: 'Notifications', to: '/app/notifications', icon: Bell, badge: { count: unread.data?.count ?? 0, label: 'unread' } },
            { label: 'Clients', to: '/app/clients', icon: Store },
            { label: 'Content', to: '/app/content', icon: LayoutGrid },
            { label: 'Review', to: '/app/review', icon: ClipboardCheck },
            { label: 'Feedback', to: '/app/feedback', icon: MessagesSquare },
            { label: 'Tasks', to: '/app/tasks', icon: ListTodo },
            { label: 'Calendar', to: '/app/calendar', icon: CalendarDays },
          ],
        },
        {
          label: 'Planning',
          items: [
            { label: 'Campaigns', to: '/app/campaigns', icon: Megaphone },
            { label: 'Content plans', to: '/app/plans', icon: CalendarRange },
            { label: 'Requests', to: '/app/requests', icon: Inbox },
            { label: 'Meetings', to: '/app/meetings', icon: Video },
            { label: 'Analytics', to: '/app/analytics', icon: BarChart3 },
          ],
        },
        {
          label: 'Agency',
          items: [
            { label: 'Team', to: '/app/team', icon: Users },
            { label: 'Banners', to: '/app/banners', icon: PanelTop },
            { label: 'Templates', to: '/app/templates', icon: LayoutTemplate },
            { label: 'Activity', to: '/app/activity', icon: Activity },
            { label: 'Settings', to: '/app/settings', icon: Settings },
          ],
        },
      ]}
      footer={(close) => (
        <SidebarUserCard
          name={s.user.name}
          detail={agencyRoleLabel[s.role]}
          initials={initials(s.user.name)}
          menu={
            <Menu
              label="Account menu"
              heading={s.user.email}
              items={[
                { label: 'Your account', icon: UserRound, to: '/app/account', onSelect: close },
                { label: 'Settings', icon: Settings, to: '/app/settings', onSelect: close },
                { label: 'Support', icon: LifeBuoy, to: '/app/support', onSelect: close },
                { label: s.support ? 'Exit support view' : 'Log out', icon: LogOut, onSelect: () => void logout(!!s.support), separated: true },
              ]}
              className="grid size-8 place-items-center rounded-lg hover:bg-white/10"
            >
              <Ellipsis size={18} />
            </Menu>
          }
        />
      )}
    />
  )
}

function SupportBanner({ session, onExit }: { session: AgencySession; onExit: () => void }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  const minutes = Math.max(0, Math.round((new Date(session.support!.expiresAt).getTime() - now) / 60_000))

  return (
    <div role="status" className="sticky top-0 z-50 flex flex-wrap items-center gap-x-4 gap-y-2 bg-[#93591f] px-4 py-2.5 text-[13px] text-white">
      <LifeBuoy size={17} className="shrink-0" />
      <span className="flex-1">
        <strong className="font-semibold">Support view.</strong> {session.support!.by} is signed in to {session.agency.name} as{' '}
        {session.user.name} ({session.user.email}). Everything you do is logged.
        {session.agency.status !== 'active' && ` This agency is ${session.agency.status}.`} Ends in {minutes} min.
      </span>
      <button type="button" onClick={onExit} className="rounded-lg bg-white/15 px-3 py-1.5 font-medium hover:bg-white/25">
        Exit support view
      </button>
    </div>
  )
}
