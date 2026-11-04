import type { Tone } from '@/components/ui/Pill'
import type { PlanStatus } from './api'

/** "Review required" is the client's word for a sent plan (D63); the agency sees "With client". */
export const planStatusLabel: Record<PlanStatus, string> = { draft: 'Draft', sent: 'With client', approved: 'Approved', changes_requested: 'Changes requested' }
export const planStatusTone: Record<PlanStatus, Tone> = { draft: 'gray', sent: 'amber', approved: 'green', changes_requested: 'red' }
