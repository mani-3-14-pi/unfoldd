import type { CalendarEvent, Layer } from './api'

export const layerLabel: Record<Layer, string> = { content: 'Publishing', tasks: 'Tasks', requests: 'Client requests', plans: 'Content plans', meetings: 'Meetings' }

/** Chip colours per layer: border, background and text together. */
export const layerClass: Record<Layer, string> = {
  content: 'border-green-dot/40 bg-green-soft text-green-ink',
  tasks: 'border-blue-dot/40 bg-blue-soft text-blue-ink',
  requests: 'border-amber-dot/40 bg-amber-soft text-amber-ink',
  plans: 'border-indigo-ink/30 bg-indigo-soft text-indigo-ink',
  meetings: 'border-gray-dot/40 bg-gray-soft text-gray-ink',
}

export const layerDot: Record<Layer, string> = { content: 'bg-green-dot', tasks: 'bg-blue-dot', requests: 'bg-amber-dot', plans: 'bg-indigo-ink', meetings: 'bg-gray-dot' }

/** D29: the agency's own warning on a content date. Red beats amber. */
export function riskOf(e: CalendarEvent): { tone: 'red' | 'amber'; label: string } | null {
  if (e.layer !== 'content' || !e.risk) return null
  if (e.risk.publishFailed) return { tone: 'red', label: 'Publishing failed' }
  if (e.risk.slotMissed) return { tone: 'red', label: 'Slot missed' }
  if (e.risk.overdueForApproval) return { tone: 'red', label: 'Overdue for approval' }
  if (e.risk.atRisk) return { tone: 'amber', label: 'At risk' }
  return null
}
