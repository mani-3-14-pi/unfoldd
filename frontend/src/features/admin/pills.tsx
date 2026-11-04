import { Pill } from '@/components/ui/Pill'
import type { AgencyStatus, Plan, SubscriptionStatus } from './api'
import { agencyStatusLabel, agencyStatusTone, planLabel, subscriptionStatusLabel, subscriptionTone } from './labels'

export function AgencyStatusPill({ status }: { status: AgencyStatus }) {
  return <Pill tone={agencyStatusTone[status]}>{agencyStatusLabel[status]}</Pill>
}

export function SubscriptionStatusPill({ status }: { status: SubscriptionStatus }) {
  return <Pill tone={subscriptionTone[status]}>{subscriptionStatusLabel[status]}</Pill>
}

export function PlanBadge({ plan }: { plan: Plan }) {
  return (
    <span className="inline-flex h-6 items-center rounded-md border border-border-strong bg-white px-2 text-[11px] font-medium text-text-2">
      {planLabel[plan]}
    </span>
  )
}
