import { CircleCheck, CirclePause, CirclePlay, CircleX, ExternalLink, type LucideIcon } from 'lucide-react'
import type { ButtonVariant } from '@/components/ui/Button'
import type { Agency, AgencyAction, AgencyStatus } from './api'

export type Action = AgencyAction | 'impersonate'
export type Target = Pick<Agency, '_id' | 'name' | 'status'>

export const actionCopy: Record<
  Action,
  { label: string; icon: LucideIcon; title: (n: string) => string; body: string; confirm: string; variant: ButtonVariant; reason?: 'required' | 'optional'; done: (n: string) => string }
> = {
  approve: {
    label: 'Approve',
    icon: CircleCheck,
    title: (n) => `Approve ${n}?`,
    body: 'Their team can log in straight away and their 14-day trial starts now (if it hasn’t already).',
    confirm: 'Approve agency',
    variant: 'primary',
    done: (n) => `${n} approved`,
  },
  reject: {
    label: 'Reject',
    icon: CircleX,
    title: (n) => `Reject ${n}?`,
    body: 'They won’t be able to log in. You can still approve them later from the Rejected tab.',
    confirm: 'Reject signup',
    variant: 'danger',
    reason: 'required',
    done: (n) => `${n} rejected`,
  },
  suspend: {
    label: 'Suspend',
    icon: CirclePause,
    title: (n) => `Suspend ${n}?`,
    body: 'Everyone in the agency is signed out immediately and can’t log in until you reactivate it. Their data is kept.',
    confirm: 'Suspend agency',
    variant: 'danger',
    reason: 'required',
    done: (n) => `${n} suspended`,
  },
  reactivate: {
    label: 'Reactivate',
    icon: CirclePlay,
    title: (n) => `Reactivate ${n}?`,
    body: 'Their team can log in again straight away.',
    confirm: 'Reactivate agency',
    variant: 'primary',
    done: (n) => `${n} reactivated`,
  },
  impersonate: {
    label: 'Open admin portal',
    icon: ExternalLink,
    title: (n) => `Open ${n}’s admin portal?`,
    body: 'You’ll be signed in to their portal as the agency owner in a new tab, without their password. The session is time-limited, and everything you do there is recorded in the activity log under your name.',
    confirm: 'Open support view',
    variant: 'primary',
    done: (n) => `Opened ${n}’s portal in a new tab`,
  },
}

/** Status changes allowed from each status (mirrors the backend's transitions). */
const allowed: Record<AgencyStatus, AgencyAction[]> = {
  pending: ['approve', 'reject'],
  rejected: ['approve'],
  active: ['suspend'],
  suspended: ['reactivate'],
}
export const actionsFor = (status: AgencyStatus) => allowed[status]
