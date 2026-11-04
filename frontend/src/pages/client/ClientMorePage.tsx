import { BarChart3, Bell, ChevronRight, FolderOpen, LifeBuoy, Megaphone, MessagesSquare, Palette, UserRound, Users, Video } from 'lucide-react'
import { Link } from 'react-router'
import type { LucideIcon } from 'lucide-react'
import { useClientSession } from '@/features/agency/session'
import { clientRoleLabel } from '@/features/agency/roles'
import { ClientPageHeader, ClientRow } from '@/features/client-app/ClientPageHeader'
import { useClientSpace } from '@/features/client-app/space'

interface Entry {
  to: string
  label: string
  detail: string
  icon: LucideIcon
}

/** F63 "Workspace": everything that isn't a bottom tab, in one list. */
export function ClientMorePage() {
  const s = useClientSession()
  const space = useClientSpace()
  const showAnalytics = !!space.data?.client.showAnalytics

  const groups: { label: string; items: Entry[] }[] = [
    {
      label: s.client.brandName,
      items: [
        { to: '/c/brand', label: 'Brand DNA', detail: 'Your brand, tone, likes and references', icon: Palette },
        { to: '/c/campaigns', label: 'Campaigns', detail: 'What we’re working on together', icon: Megaphone },
        { to: '/c/meetings', label: 'Meetings', detail: 'Upcoming and past, with summaries', icon: Video },
        { to: '/c/conversations', label: 'Conversations', detail: 'Talk to your agency team', icon: MessagesSquare },
        { to: '/c/library', label: 'Library', detail: 'Brand assets and shared files', icon: FolderOpen },
        ...(showAnalytics ? [{ to: '/c/analytics', label: 'Analytics', detail: 'How your posts are doing, and reports', icon: BarChart3 }] : []),
      ],
    },
    {
      label: 'You',
      items: [
        { to: '/c/people', label: 'People', detail: `Your team at ${s.client.brandName}`, icon: Users },
        { to: '/c/profile', label: 'Profile and password', detail: `${s.user.email} · ${clientRoleLabel[s.role]}`, icon: UserRound },
        { to: '/c/profile#notifications', label: 'Notification settings', detail: 'What reaches you by email and push', icon: Bell },
        { to: '/c/help', label: 'Help', detail: `Contact ${s.agency.name} or report a problem`, icon: LifeBuoy },
      ],
    },
  ]

  return (
    <>
      <ClientPageHeader title="More" />
      <div className="flex flex-col gap-6">
        {groups.map((g) => (
          <section key={g.label}>
            <h2 className="mb-2 px-1 text-xs font-semibold tracking-wide text-text-3 uppercase">{g.label}</h2>
            <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
              {g.items.map((e) => (
                <li key={e.to}>
                  <Link to={e.to} className="block hover:bg-[#f6f5f6]">
                    <ClientRow icon={<e.icon size={19} />} title={e.label} detail={e.detail} end={<ChevronRight size={18} className="shrink-0 text-text-4" />} />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  )
}
