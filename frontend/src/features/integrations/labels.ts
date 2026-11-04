import type { Tone } from '@/components/ui/Pill'
import type { Connection } from './api'

export const connectionStatusLabel: Record<Connection['status'], string> = {
  active: 'Connected',
  expired: 'Expired: reconnect',
  error: 'Needs attention',
  disconnected: 'Disconnected',
}
export const connectionStatusTone: Record<Connection['status'], Tone> = { active: 'green', expired: 'amber', error: 'red', disconnected: 'gray' }

/** What the callback's `error` parameter means. */
export const callbackErrorText: Record<string, string> = {
  expired: 'The connection attempt took too long and expired. Start again from the client’s integrations.',
  cancelled: 'The connection was cancelled on the platform. Nothing was connected.',
  access_denied: 'Permission was declined on the platform. Nothing was connected.',
  connect_failed: 'The platform didn’t let us finish connecting. Try again, and check the account has the permissions it needs.',
}
