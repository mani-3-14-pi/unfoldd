import type { Tone } from '@/components/ui/Pill'
import type { TaskSource, TaskStatus } from './api'

export const taskStatusLabel: Record<TaskStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  in_review: 'In review',
  done: 'Done',
  cancelled: 'Cancelled',
}

export const taskStatusTone: Record<TaskStatus, Tone> = { todo: 'gray', in_progress: 'blue', in_review: 'indigo', done: 'green', cancelled: 'gray' }

export const taskSourceLabel: Record<TaskSource, string> = {
  manual: 'Added by hand',
  feedback: 'From client feedback',
  checklist: 'From the revision checklist',
  meeting: 'From a meeting',
  template: 'From a template',
}

/** "2026-11-04" in the viewer's own day. Due dates are date-only, so a string compare tells overdue. */
export const todayString = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const isOverdue = (t: { due: string; status: TaskStatus }, today: string) => !!t.due && t.due < today && t.status !== 'done' && t.status !== 'cancelled'
