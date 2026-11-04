import type { Tone } from '@/components/ui/Pill'
import type { AttentionKind, WorkloadStatus } from './api'

/** What each Needs Attention item means, in a few words. */
export const attentionLabel: Record<AttentionKind, string> = {
  overdue_for_approval: 'Overdue for approval',
  at_risk: 'At risk',
  slot_missed: 'Slot missed: pick a new date',
  publish_failed: 'Publishing failed',
  changes_requested: 'Changes requested',
  internal_review: 'Waiting for internal review',
  ready_for_client: 'Ready to send',
  task_overdue: 'Task overdue',
  task_blocked: 'Task blocked',
  request_overdue: 'Client request overdue',
  request_submitted: 'Client sent files',
}

export const severityTone: Record<'urgent' | 'high' | 'normal', Tone> = { urgent: 'red', high: 'amber', normal: 'blue' }

/** D56: Available < 80% ≤ At capacity ≤ 100% < Overloaded. */
export const workloadLabel: Record<WorkloadStatus, string> = { available: 'Available', at_capacity: 'At capacity', overloaded: 'Overloaded' }
export const workloadTone: Record<WorkloadStatus, Tone> = { available: 'green', at_capacity: 'amber', overloaded: 'red' }
export const loadStatus = (load: number): WorkloadStatus => (load < 80 ? 'available' : load <= 100 ? 'at_capacity' : 'overloaded')
