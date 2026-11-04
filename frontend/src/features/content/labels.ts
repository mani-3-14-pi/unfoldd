import type { Tone } from '@/components/ui/Pill'
import type { ApprovalStatus, ContentState, Format, Platform, Priority, ShiftReason, ThreadStatus } from './api'

export const stateLabel: Record<ContentState, string> = {
  planned: 'Planned',
  in_production: 'In production',
  internal_review: 'Internal review',
  ready_for_client: 'Ready for client',
  client_review: 'With client',
  changes_requested: 'Changes requested',
  approved: 'Approved',
  scheduled: 'Scheduled',
  publishing: 'Publishing',
  published: 'Published',
  cancelled: 'Cancelled',
}

export const stateTone: Record<ContentState, Tone> = {
  planned: 'gray',
  in_production: 'blue',
  internal_review: 'indigo',
  ready_for_client: 'indigo',
  client_review: 'amber',
  changes_requested: 'red',
  approved: 'green',
  scheduled: 'green',
  publishing: 'green',
  published: 'green',
  cancelled: 'gray',
}

/** P83 approval status, as the server derives it (D04). */
export const approvalLabel: Record<ApprovalStatus, string> = {
  not_sent: 'Not sent',
  sent: 'Sent',
  viewed: 'Viewed',
  changes_requested: 'Changes requested',
  approved: 'Approved',
}
export const approvalTone: Record<ApprovalStatus, Tone> = { not_sent: 'gray', sent: 'blue', viewed: 'indigo', changes_requested: 'red', approved: 'green' }

export const platformLabel: Record<Platform, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  x: 'X',
  pinterest: 'Pinterest',
  website: 'Website',
  other: 'Other',
}

export const formatLabel: Record<Format, string> = {
  feed_4x5: 'Feed post 4:5',
  square_1x1: 'Square 1:1',
  story_9x16: 'Story 9:16',
  landscape_16x9: 'Landscape 16:9',
  carousel: 'Carousel',
  video: 'Video',
  reel: 'Reel',
  linkedin: 'LinkedIn post',
  other: 'Other',
}

/** Width ÷ height of the frame the creative is shown in, so it looks like it will on the platform. */
export const formatAspect: Record<Format, number> = {
  feed_4x5: 4 / 5,
  square_1x1: 1,
  story_9x16: 9 / 16,
  landscape_16x9: 16 / 9,
  carousel: 4 / 5,
  video: 16 / 9,
  reel: 9 / 16,
  linkedin: 1.91,
  other: 1,
}

export const priorityLabel: Record<Priority, string> = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' }
export const priorityTone: Record<Priority, Tone> = { low: 'gray', normal: 'gray', high: 'amber', urgent: 'red' }

export const threadStatusLabel: Record<ThreadStatus, string> = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved' }
export const threadStatusTone: Record<ThreadStatus, Tone> = { open: 'amber', in_progress: 'blue', resolved: 'green' }

export const shiftReasonLabel: Record<ShiftReason, string> = {
  client_delay: 'Waiting on the client',
  agency_delay: 'Our delay',
  strategy_change: 'Change of plan',
  missed_slot: 'Missed the slot',
  platform_issue: 'Platform problem',
  other: 'Other',
}

/** A video time: "0:17". */
export const formatTime = (ms: number) => {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** "V03" */
export const versionLabel = (n: number) => `V${String(n).padStart(2, '0')}`

/** D75: client pins are ① ② …, internal ones I-1, I-2 … */
export function pinLabel(visibility: 'internal' | 'client', pin: number | null) {
  if (pin == null) return 'Draft'
  if (visibility === 'internal') return `I-${pin}`
  return pin <= 20 ? String.fromCodePoint(0x2460 + pin - 1) : `#${pin}`
}

/** States in which a new version can be uploaded (D76). Refused while publishing, after publishing and when cancelled. */
export const canUploadIn: ContentState[] = ['planned', 'in_production', 'internal_review', 'ready_for_client', 'client_review', 'changes_requested', 'approved', 'scheduled']
export const canCancelIn: ContentState[] = canUploadIn
