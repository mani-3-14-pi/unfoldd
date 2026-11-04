import { dateIn } from '../../lib/time.ts'
import type { ContentState } from './content.model.ts'

// §6.2 and §6.3: labels are derived from the state machine, never stored (rule §12.12).

export const CLIENT_BUCKETS = ['review_required', 'in_progress', 'changes_requested', 'approved', 'scheduled', 'published', 'cancelled'] as const
export type ClientBucket = (typeof CLIENT_BUCKETS)[number]

const BUCKET: Record<ContentState, ClientBucket | null> = {
  planned: null,
  in_production: 'in_progress',
  internal_review: 'in_progress',
  ready_for_client: 'in_progress',
  client_review: 'review_required',
  changes_requested: 'changes_requested',
  approved: 'approved',
  scheduled: 'scheduled',
  publishing: 'scheduled',
  published: 'published',
  cancelled: 'cancelled',
}

/** States per client filter bucket, for queries. */
export const STATES_FOR_BUCKET = Object.fromEntries(
  ([...new Set(Object.values(BUCKET))].filter(Boolean) as ClientBucket[]).map((b) => [
    b,
    (Object.keys(BUCKET) as ContentState[]).filter((s) => BUCKET[s] === b),
  ]),
) as Record<ClientBucket, ContentState[]>

const LABEL: Record<ClientBucket, string> = {
  review_required: 'Review Required',
  in_progress: 'In Progress',
  changes_requested: 'Changes Requested',
  approved: 'Approved',
  scheduled: 'Scheduled',
  published: 'Published',
  cancelled: 'Cancelled',
}

/** What the client sees. A failed or unknown publish shows only a neutral "Publishing delayed" badge (D65). */
export function clientStatus(state: ContentState, jobStatus?: string | null) {
  const bucket = BUCKET[state]
  return {
    bucket,
    label: bucket ? LABEL[bucket] : 'Planned',
    delayed: state === 'scheduled' && (jobStatus === 'failed' || jobStatus === 'unknown'),
  }
}

export type ApprovalStatus = 'not_sent' | 'sent' | 'viewed' | 'changes_requested' | 'approved'

/** P83 approval status for the portal (D04). */
export function approvalStatus(state: ContentState, current?: { sentToClientAt?: Date | null; firstViewedAt?: Date | null } | null): ApprovalStatus {
  if (['approved', 'scheduled', 'publishing', 'published'].includes(state)) return 'approved'
  if (state === 'changes_requested') return 'changes_requested'
  if (state === 'client_review') return current?.firstViewedAt ? 'viewed' : 'sent'
  return 'not_sent'
}

/** §6.10: "needed by" = publish date − approval lead time; at risk inside the 3-day window; overdue once passed. */
export function timing(
  content: { state: ContentState; publishDate?: Date | null },
  leadHours: number,
  riskDays = 3,
  now = Date.now(),
) {
  if (!content.publishDate) return null
  const neededBy = new Date(content.publishDate.getTime() - leadHours * 3_600_000)
  const decided = ['approved', 'scheduled', 'publishing', 'published', 'cancelled'].includes(content.state)
  const msLeft = neededBy.getTime() - now
  return {
    neededBy,
    daysRemaining: Math.ceil(msLeft / 86_400_000),
    atRisk: !decided && msLeft >= 0 && msLeft < riskDays * 86_400_000,
    overdueForApproval: !decided && msLeft < 0,
  }
}

/** D29 "Schedule shifted · N days": calendar days between the date the client first saw and the current one. */
export function shiftedDays(c: { publishDate?: Date | null; sharedPublishDate?: Date | null }, tz: string) {
  if (!c.publishDate || !c.sharedPublishDate) return 0
  const a = new Date(`${dateIn(c.sharedPublishDate, tz)}T00:00:00Z`).getTime()
  const b = new Date(`${dateIn(c.publishDate, tz)}T00:00:00Z`).getTime()
  return Math.round((b - a) / 86_400_000)
}
