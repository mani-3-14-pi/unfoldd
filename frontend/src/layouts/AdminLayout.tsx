import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, CreditCard, Ellipsis, LayoutDashboard, LifeBuoy, LoaderCircle, LogOut, ScrollText, Settings, UserCheck } from 'lucide-react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { Menu } from '@/components/ui/Menu'
import { adminApi, adminMeKey } from '@/features/admin/api'
import { ApiError } from '@/lib/api'
import { initials } from '@/lib/format'
import { SidebarShell, SidebarUserCard } from './SidebarShell'

/** Signed-in platform admin shell: dark sidebar from the prototype, content on the right. */
export function AdminLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const me = useQuery({ queryKey: adminMeKey, queryFn: adminApi.me, retry: false, staleTime: 5 * 60_000 })
  const overview = useQuery({ queryKey: ['admin', 'overview'], queryFn: adminApi.overview, enabled: me.isSuccess, staleTime: 30_000 })
  const pending = overview.data?.agencies.byStatus.pending ?? 0
  const openTickets = overview.data?.support.open ?? 0

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
      return <Navigate to={`/admin/login${next !== '/admin' ? `?next=${encodeURIComponent(next)}` : ''}`} replace />
    }
    return <div className="grid min-h-screen place-items-center text-sm text-negative">{me.error.message}</div>
  }

  const admin = me.data.admin
  const logout = async () => {
    await adminApi.logout()
    qc.clear()
    navigate('/admin/login', { replace: true })
  }

  return (
    <SidebarShell
      product="PLATFORM ADMIN"
      mobileTitle="unfoldd admin"
      groups={[
        {
          label: 'Platform',
          items: [
            { label: 'Overview', to: '/admin', icon: LayoutDashboard, end: true },
            { label: 'Agencies', to: '/admin/agencies', icon: Building2 },
            { label: 'Approvals', to: '/admin/approvals', icon: UserCheck, badge: { count: pending, label: 'agencies waiting for approval' } },
            { label: 'Support', to: '/admin/support', icon: LifeBuoy, badge: { count: openTickets, label: 'support tickets waiting for an answer' } },
            { label: 'Subscriptions', to: '/admin/subscriptions', icon: CreditCard },
            { label: 'Activity log', to: '/admin/activity', icon: ScrollText },
          ],
        },
        { label: 'Administration', items: [{ label: 'Settings', to: '/admin/settings', icon: Settings }] },
      ]}
      footer={(close) => (
        <SidebarUserCard
          name={admin.name}
          detail={`@${admin.username}`}
          initials={initials(admin.name)}
          menu={
            <Menu
              label="Account menu"
              heading={admin.name}
              items={[
                { label: 'Settings', icon: Settings, to: '/admin/settings', onSelect: close },
                { label: 'Log out', icon: LogOut, onSelect: () => void logout(), separated: true },
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
