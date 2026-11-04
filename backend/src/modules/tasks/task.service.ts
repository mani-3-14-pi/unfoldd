import type { Request } from 'express'
import type { Types } from 'mongoose'
import { logActivity } from '../../lib/activity.ts'
import { notify } from '../../lib/notify.ts'
import { AppError, invalid, notFound } from '../../utils/AppError.ts'
import { ChecklistItemModel } from '../checklist/checklist.model.ts'
import { ThreadModel } from '../feedback/thread.model.ts'
import { REQUEST_END_STATES, RequestModel } from '../requests/request.model.ts'
import { TASK_END_STATES, TaskModel, type Task, type TaskStatus } from './task.model.ts'

export type TaskDoc = Task & { _id: Types.ObjectId }

const taskLink = (t: { _id: Types.ObjectId }) => `/app/tasks/${t._id}`

const event = (req: Request | null, task: TaskDoc, action: string, message: string, extra: Record<string, unknown> = {}) =>
  logActivity(req, { action, message, agency: task.agency, client: task.client, target: { type: 'task', id: task._id, label: task.title }, ...extra })

// ── Dependencies (D38) ───────────────────────────────────────────────────────

/** True while any dependency (a task or a client request) is unfinished. */
async function hasOpenDependency(deps: { type: string; id: Types.ObjectId }[]) {
  const taskIds = deps.filter((d) => d.type === 'task').map((d) => d.id)
  const requestIds = deps.filter((d) => d.type === 'request').map((d) => d.id)
  const [task, request] = await Promise.all([
    taskIds.length ? TaskModel.exists({ _id: { $in: taskIds }, deletedAt: null, status: { $nin: TASK_END_STATES } }) : null,
    requestIds.length ? RequestModel.exists({ _id: { $in: requestIds }, deletedAt: null, status: { $nin: REQUEST_END_STATES } }) : null,
  ])
  return !!(task || request)
}

/** Refuses a dependency that would make a task (indirectly) wait on itself. */
async function assertNoCycle(taskId: Types.ObjectId, deps: Types.ObjectId[]) {
  const seen = new Set<string>()
  let frontier = deps
  while (frontier.length) {
    if (frontier.some((id) => String(id) === String(taskId))) throw invalid('dependencies', 'That would make the task wait on itself')
    frontier = frontier.filter((id) => !seen.has(String(id)))
    frontier.forEach((id) => seen.add(String(id)))
    const rows = await TaskModel.find({ _id: { $in: frontier } }, { dependencies: 1 }).lean()
    frontier = rows.flatMap((r) => r.dependencies.filter((d) => d.type === 'task').map((d) => d.id))
  }
}

export async function setDependencies(req: Request, task: TaskDoc, deps: { type: 'task' | 'request'; id: Types.ObjectId }[]) {
  const ids = deps.filter((d) => d.type === 'task').map((d) => d.id)
  const requestIds = deps.filter((d) => d.type === 'request').map((d) => d.id)
  const [tasks, requests] = await Promise.all([
    TaskModel.countDocuments({ _id: { $in: ids }, agency: task.agency, deletedAt: null }),
    RequestModel.countDocuments({ _id: { $in: requestIds }, agency: task.agency, deletedAt: null }),
  ])
  if (tasks !== new Set(ids.map(String)).size || requests !== new Set(requestIds.map(String)).size) throw invalid('dependencies', 'Pick tasks or requests from this agency')
  await assertNoCycle(task._id, ids)
  const byDependency = await hasOpenDependency(deps)
  const updated = await TaskModel.findOneAndUpdate({ _id: task._id }, { $set: { dependencies: deps, 'blocked.byDependency': byDependency } }, { returnDocument: 'after' })
  await event(req, task, 'task.dependencies_changed', `${req.agencyAuth!.user.name} changed what ${task.title} waits on`, {
    before: { dependencies: task.dependencies },
    after: { dependencies: deps },
  })
  return updated!
}

/**
 * A task reached an end state: every task that waited on it is re-checked, and the ones that are no longer
 * blocked are unblocked with a notification to their owner (D38). The task keeps its column.
 */
export async function releaseDependents(req: Request | null, done: { _id: Types.ObjectId; title: string; status: string }) {
  const dependents = await TaskModel.find({ 'dependencies.id': done._id, 'blocked.byDependency': true, deletedAt: null }).lean()
  for (const dep of dependents) {
    if (await hasOpenDependency(dep.dependencies)) continue
    const freed = await TaskModel.findOneAndUpdate({ _id: dep._id, 'blocked.byDependency': true }, { $set: { 'blocked.byDependency': false } })
    if (!freed) continue
    await event(req, dep as TaskDoc, 'task.unblocked', `${dep.title} is no longer blocked: ${done.title} is ${done.status}`)
    if (dep.owner && !dep.blocked?.manual) {
      await notify({
        recipients: [dep.owner],
        audience: 'agency',
        agency: dep.agency,
        client: dep.client,
        category: 'team',
        event: 'task.unblocked',
        title: `${dep.title} can start now`,
        body: `${done.title} is ${done.status === 'cancelled' ? 'cancelled' : 'done'}.`,
        entity: { type: 'task', id: dep._id },
        link: taskLink(dep),
      })
    }
  }
}

/** A dependency re-opened (done → back on the board): tasks waiting on it are blocked again. */
async function reblockDependents(reopened: TaskDoc) {
  await TaskModel.updateMany({ 'dependencies.id': reopened._id, deletedAt: null }, { $set: { 'blocked.byDependency': true } })
}

// ── Status ──────────────────────────────────────────────────────────────────

/**
 * Moves a task on the board. Any status can go to any other (§6.7). With `expectedStatus` the move is
 * conditional, so two people dragging the same card at once get a 409 instead of a silent overwrite.
 */
export async function moveTask(req: Request, task: TaskDoc, to: TaskStatus, opts: { expectedStatus?: TaskStatus; position?: number } = {}) {
  const now = new Date()
  const set: Record<string, unknown> = { status: to, ...(opts.position !== undefined ? { position: opts.position } : {}) }
  if (to !== task.status) {
    set.statusChangedAt = now
    set.completedAt = to === 'done' ? now : null
  }
  const updated = await TaskModel.findOneAndUpdate(
    { _id: task._id, agency: task.agency, deletedAt: null, ...(opts.expectedStatus ? { status: opts.expectedStatus } : {}) },
    { $set: set },
    { returnDocument: 'after' },
  ).lean()
  if (!updated) {
    const current = await TaskModel.findById(task._id, { status: 1 }).lean()
    if (!current) throw notFound('Task not found.')
    throw new AppError(409, 'invalid_state', `This task was moved to ${current.status.replace('_', ' ')} by someone else.`, { status: current.status })
  }
  if (to === task.status) return updated as TaskDoc

  await event(req, task, 'task.moved', `${req.agencyAuth!.user.name} moved ${task.title} to ${to.replace('_', ' ')}`, {
    before: { status: task.status },
    after: { status: to },
  })
  // Flow 7, step 5: starting the work on a feedback item shows the client "In progress".
  if (to === 'in_progress' && task.thread) {
    await ThreadModel.updateOne({ _id: task.thread, status: 'open' }, { $set: { status: 'in_progress' } })
  }
  const wasEnded = TASK_END_STATES.includes(task.status as TaskStatus)
  const isEnded = TASK_END_STATES.includes(to)
  if (isEnded && !wasEnded) await releaseDependents(req, updated as TaskDoc)
  if (wasEnded && !isEnded) await reblockDependents(updated as TaskDoc)
  return updated as TaskDoc
}

// ── Converting feedback and checklist items ──────────────────────────────────

interface FromSource {
  agency: Types.ObjectId
  client: Types.ObjectId
  content: Types.ObjectId
  title: string
  description: string
  owner: Types.ObjectId | null
  createdBy: Types.ObjectId
}

/** Creates the task once; a second call (double tap, retry) returns the same task (Flow 7, step 4). */
async function createOnce(filter: Record<string, unknown>, doc: Record<string, unknown>) {
  const existing = await TaskModel.findOne({ ...filter, deletedAt: null }).lean()
  if (existing) return { task: existing as TaskDoc, created: false }
  try {
    return { task: (await TaskModel.create(doc)).toObject() as TaskDoc, created: true }
  } catch (err: any) {
    if (err?.code !== 11000) throw err
    return { task: (await TaskModel.findOne({ ...filter, deletedAt: null }).lean()) as TaskDoc, created: false }
  }
}

export async function taskFromThread(req: Request, base: FromSource, thread: { _id: Types.ObjectId; pin?: number | null; assignee?: Types.ObjectId | null }) {
  const result = await createOnce(
    { thread: thread._id, source: 'feedback' },
    { ...base, owner: thread.assignee ?? base.owner, thread: thread._id, source: 'feedback' },
  )
  if (result.created) await event(req, result.task, 'task.created_from_feedback', `${req.agencyAuth!.user.name} turned feedback #${thread.pin ?? ''} into a task`)
  return result
}

export async function taskFromChecklistItem(req: Request, base: FromSource, item: { _id: Types.ObjectId; sourceThreads: Types.ObjectId[] }) {
  const result = await createOnce(
    { checklistItem: item._id },
    { ...base, checklistItem: item._id, thread: item.sourceThreads.length === 1 ? item.sourceThreads[0] : null, source: 'checklist' },
  )
  if (result.created) {
    await ChecklistItemModel.updateOne({ _id: item._id }, { $set: { task: result.task._id } })
    await event(req, result.task, 'task.created_from_checklist', `${req.agencyAuth!.user.name} turned a checklist item into a task`)
  }
  return result
}

/**
 * D16: when the client approves, still-open tasks made from feedback that was just closed "on approval" are
 * flagged to their owners ("feedback closed on approval — cancel task?").
 */
export async function flagTasksClosedOnApproval(contentId: Types.ObjectId, contentTitle: string) {
  const threads = await ThreadModel.find({ content: contentId, closedOnApproval: true }, { _id: 1 }).lean()
  if (!threads.length) return
  const tasks = await TaskModel.find({ thread: { $in: threads.map((t) => t._id) }, status: { $nin: TASK_END_STATES }, deletedAt: null }).lean()
  for (const task of tasks) {
    if (!task.owner) continue
    await notify({
      recipients: [task.owner],
      audience: 'agency',
      agency: task.agency,
      client: task.client,
      category: 'team',
      event: 'task.feedback_closed_on_approval',
      title: `Feedback closed on approval — cancel “${task.title}”?`,
      body: `The client approved ${contentTitle}, which closed the feedback this task was made from.`,
      entity: { type: 'task', id: task._id },
      link: taskLink(task),
    })
  }
}
