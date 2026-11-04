import { Pill } from '@/components/ui/Pill'
import type { ApprovalStatus, ContentState, ThreadStatus } from './api'
import { approvalLabel, approvalTone, stateLabel, stateTone, threadStatusLabel, threadStatusTone } from './labels'

export function StatePill({ state }: { state: ContentState }) {
  return <Pill tone={stateTone[state]}>{stateLabel[state]}</Pill>
}

export function ApprovalPill({ status }: { status: ApprovalStatus }) {
  return <Pill tone={approvalTone[status]}>{approvalLabel[status]}</Pill>
}

export function ThreadStatusPill({ status, reopened }: { status: ThreadStatus; reopened?: boolean }) {
  // D15: "Reopened" is how an open item that was reopened is shown, not a state of its own.
  return <Pill tone={threadStatusTone[status]}>{status === 'open' && reopened ? 'Reopened' : threadStatusLabel[status]}</Pill>
}
