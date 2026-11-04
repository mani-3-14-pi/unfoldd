import { useQuery } from '@tanstack/react-query'
import { LoaderCircle, LogOut } from 'lucide-react'
import { Navigate } from 'react-router'
import { BrandMark } from '@/components/BrandMark'
import { Button } from '@/components/ui/Button'
import { sessionApi, sessionKey } from '@/features/agency/api'
import { ContextSwitcher } from '@/features/agency/ContextSwitcher'
import { clientRoleLabel } from '@/features/agency/roles'
import { useSessionActions } from '@/features/agency/session'
import { ApiError } from '@/lib/api'
import { errorMessage } from '@/lib/errors'

/**
 * Where client people land until the (mobile-first) Client App is built: says who they are, lets them switch to
 * another space they belong to, and log out.
 */
export function ClientPlaceholderPage() {
  const me = useQuery({ queryKey: sessionKey, queryFn: sessionApi.me, retry: false })
  const { logout } = useSessionActions()

  if (me.isPending) {
    return (
      <div className="grid min-h-screen place-items-center text-text-3">
        <LoaderCircle className="animate-spin" />
      </div>
    )
  }
  if (me.isError) {
    if (me.error instanceof ApiError && me.error.status === 401) return <Navigate to="/login" replace />
    return <div className="grid min-h-screen place-items-center px-4 text-sm text-negative">{errorMessage(me.error)}</div>
  }
  if (me.data.context === 'agency') return <Navigate to="/app" replace />
  const s = me.data

  return (
    <div className="grid min-h-screen place-items-center bg-sidebar-bg px-4 text-sidebar-text">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center gap-3">
          <BrandMark />
          <span className="text-[22px] font-semibold tracking-tight">unfoldd</span>
        </div>
        <div>
          <p className="text-[13px] text-sidebar-muted">
            {s.agency.name} · {clientRoleLabel[s.role]}
          </p>
          <h1 className="mt-1 font-serif text-4xl">Welcome, {s.user.name.split(' ')[0]}</h1>
          <p className="mt-3 text-[13px] text-sidebar-muted">
            You’re in the {s.client.brandName} client space. The client app is on its way: you’ll review content, give feedback and approve
            posts here.
          </p>
        </div>
        <ContextSwitcher current={{ clientId: s.client.id }} label={s.client.brandName} contexts={s.contexts} />
        <Button onClick={() => void logout(false)} className="self-start">
          <LogOut size={16} /> Log out
        </Button>
      </div>
    </div>
  )
}
