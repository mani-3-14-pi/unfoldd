import type { Tone } from '@/components/ui/Pill'
import type { AgencyStatus, Plan, SubscriptionStatus } from './api'

export const agencyStatusLabel: Record<AgencyStatus, string> = {
  pending: 'Pending approval',
  active: 'Active',
  suspended: 'Suspended',
  rejected: 'Rejected',
}
export const agencyStatusTone: Record<AgencyStatus, Tone> = { pending: 'amber', active: 'green', suspended: 'red', rejected: 'gray' }

export const planLabel: Record<Plan, string> = {
  trial: 'Trial',
  starter: 'Starter',
  growth: 'Growth',
  scale: 'Scale',
  enterprise: 'Enterprise',
}

export const subscriptionStatusLabel: Record<SubscriptionStatus, string> = {
  trialing: 'Trialing',
  active: 'Active',
  past_due: 'Past due',
  cancelled: 'Cancelled',
}
export const subscriptionTone: Record<SubscriptionStatus, Tone> = { trialing: 'blue', active: 'green', past_due: 'amber', cancelled: 'gray' }

export const actorTypeLabel = { platform_admin: 'Platform admin', agency_user: 'Agency user', system: 'System' } as const
export const roleLabel = { owner: 'Owner', admin: 'Admin', manager: 'Manager', member: 'Member' } as const
export const memberStatusLabel = { active: 'Active', disabled: 'Disabled' } as const

/** "agency.impersonation_started" → "Impersonation started" (prefixed with the area when it helps). */
export function actionLabel(action: string) {
  const [area, verb = ''] = action.split('.')
  const text = verb.replace(/_/g, ' ')
  const areaLabel: Record<string, string> = { agency: 'Agency', platform: 'Admin', user: 'User', settings: 'Settings' }
  return `${areaLabel[area!] ?? area} ${text}`.trim()
}
