import type { Tone } from '@/components/ui/Pill'
import type { ClientBucket } from './api'

/** §6.2 client labels and filters (D03). "Review Required" is the one phrase for anything awaiting them (D63). */
export const bucketLabel: Record<ClientBucket, string> = {
  review_required: 'Review Required',
  in_progress: 'In Progress',
  changes_requested: 'Changes Requested',
  approved: 'Approved',
  scheduled: 'Scheduled',
  published: 'Published',
  cancelled: 'Cancelled',
}

export const bucketTone: Record<ClientBucket, Tone> = {
  review_required: 'amber',
  in_progress: 'blue',
  changes_requested: 'red',
  approved: 'green',
  scheduled: 'green',
  published: 'green',
  cancelled: 'gray',
}

/** States in which the client can reopen a resolved item; once approved, they request changes instead (§6.5). */
export const REOPENABLE = ['client_review', 'changes_requested']
/** States where the client is asked to decide. */
export const IN_REVIEW = ['client_review', 'changes_requested']
/** States where an approval can still be pulled (D08). */
export const PULLABLE = ['approved', 'scheduled']
