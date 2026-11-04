import { api } from '@/lib/api'
import type { Priority } from '@/features/content/api'
import type { Page, UpdatedBy } from '@/types/api'

// Agency tasks and the board (P85–P89, D37, D38): /api/tasks. Agency-only.

/** §6.7: To Do → In Progress → In Review → Done (+ Cancelled). Any state can go back. */
export const TASK_STATUSES = ['todo', 'in_progress', 'in_review', 'done', 'cancelled'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]
/** The board's columns. Cancelled tasks only show when asked for. */
export const BOARD_STATUSES = ['todo', 'in_progress', 'in_review', 'done'] as const satisfies readonly TaskStatus[]
export type TaskSource = 'manual' | 'feedback' | 'checklist' | 'meeting' | 'template'

/** D37: blocked is a flag, set by hand with a reason or while a dependency is unfinished (D38). */
export interface Blocked {
  isBlocked: boolean
  manual?: boolean
  reason?: string
  byDependency?: boolean
}

export interface Dependency {
  type: 'task' | 'request'
  id: string
}

export interface Task {
  _id: string
  client: string
  campaign: string | null
  content: string | null
  thread: string | null
  checklistItem: string | null
  meeting: string | null
  source: TaskSource
  title: string
  description: string
  owner: string | null
  collaborators: string[]
  /** Date-only, in the client's timezone. */
  due: string
  priority: Priority
  status: TaskStatus
  statusChangedAt: string
  position: number
  blocked: Blocked
  dependencies: Dependency[]
  completedAt: string | null
  createdBy: string
  rev: number
  updatedBy?: UpdatedBy
  createdAt: string
  updatedAt: string
  ownerInfo?: { _id: string; name: string }
  clientInfo?: { _id: string; brandName: string }
}

type TaskRef = { _id: string; title: string; status: TaskStatus; owner: string | null }

export interface TaskDetail extends Task {
  /** The tasks it waits on. */
  dependencyTasks: TaskRef[]
  /** The tasks that wait on it. */
  dependents: TaskRef[]
}

export interface TaskInput {
  title: string
  description?: string
  owner?: string | null
  due?: string
  priority?: Priority
}

export interface TaskComment {
  _id: string
  author: { id: string; name: string }
  body: string
  createdAt: string
}

export interface RequestRef {
  _id: string
  title: string
  status: 'draft' | 'open' | 'submitted' | 'completed' | 'cancelled'
}

export const tasksApi = {
  list: (query: string) => api<Page<Task>>(`/tasks?${query}`),
  board: (query: string) => api<{ columns: { status: TaskStatus; items: Task[] }[] }>(`/tasks?view=board&${query}`),
  get: (id: string) => api<{ task: TaskDetail }>(`/tasks/${id}`),
  create: (body: TaskInput & { client: string; content?: string }, idempotencyKey: string) => api<{ task: Task }>('/tasks', { body, idempotencyKey }),
  update: (id: string, body: Partial<TaskInput> & { rev: number; blocked?: { manual: boolean; reason: string } }) =>
    api<{ task: Task }>(`/tasks/${id}`, { method: 'PATCH', body }),
  /** 409 if someone moved it first: `expectedStatus` is the column the card was picked up from. */
  move: (id: string, body: { status: TaskStatus; expectedStatus?: TaskStatus; position?: number }) => api<{ task: Task }>(`/tasks/${id}/move`, { body }),
  setDependencies: (id: string, dependencies: Dependency[]) => api<{ task: Task }>(`/tasks/${id}/dependencies`, { method: 'PUT', body: { dependencies } }),
  remove: (id: string) => api<void>(`/tasks/${id}`, { method: 'DELETE' }),
  comments: (id: string) => api<{ items: TaskComment[] }>(`/tasks/${id}/comments`),
  comment: (id: string, body: string) => api<{ message: TaskComment }>(`/tasks/${id}/comments`, { body: { body } }),
  /** A client's requests, any status, for picking dependencies and naming them. */
  requests: (client: string) => api<Page<RequestRef>>(`/requests?client=${client}&status=draft,open,submitted,completed,cancelled&pageSize=100`),
}

export const taskKey = (id: string) => ['agency', 'tasks', 'detail', id]
