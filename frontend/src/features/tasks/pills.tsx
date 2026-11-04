import { Ban } from 'lucide-react'
import { Pill } from '@/components/ui/Pill'
import type { Blocked, TaskStatus } from './api'
import { taskStatusLabel, taskStatusTone } from './labels'

export function TaskStatusPill({ status }: { status: TaskStatus }) {
  return <Pill tone={taskStatusTone[status]}>{taskStatusLabel[status]}</Pill>
}

/** D37: a flag shown beside the status, never a column of its own. */
export function BlockedBadge({ blocked }: { blocked: Blocked }) {
  if (!blocked.isBlocked) return null
  const why = blocked.manual ? blocked.reason : 'Waiting on something it depends on'
  return (
    <span title={why} className="inline-flex h-6 items-center gap-1 rounded-full bg-red-soft px-2 text-[11px] font-medium text-red-ink">
      <Ban size={11} /> Blocked
    </span>
  )
}
