import { createContext, useContext } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { homeFor, sessionApi, type AgencySession, type ClientSession } from './api'

/** Provided by the portal shell once `/auth/me` says we're in an agency. */
export const AgencySessionContext = createContext<AgencySession | null>(null)
/** Provided by the client app shell. */
export const ClientSessionContext = createContext<ClientSession | null>(null)

/** The signed-in agency person. Only inside the agency portal shell. */
export function useAgencySession() {
  const session = useContext(AgencySessionContext)
  if (!session) throw new Error('useAgencySession() is only available inside the agency portal')
  return session
}

export function useClientSession() {
  const session = useContext(ClientSessionContext)
  if (!session) throw new Error('useClientSession() is only available inside the client app')
  return session
}

/**
 * Moving between agencies and client spaces. Every cached query belongs to the old context, so the whole cache
 * goes: nothing from one agency or client may show up in another.
 */
export function useSessionActions() {
  const qc = useQueryClient()
  const navigate = useNavigate()

  const switchTo = async (target: { agencyId: string } | { clientId: string }) => {
    const { context } = await sessionApi.switchTo(target)
    qc.clear()
    navigate(homeFor(context), { replace: true })
  }

  const logout = async (support: boolean) => {
    await sessionApi.logout()
    qc.clear()
    // A support view was opened in its own tab from the platform admin; close it if we can.
    if (support) {
      window.close()
      navigate('/admin', { replace: true })
    } else navigate('/login', { replace: true })
  }

  return { switchTo, logout }
}
