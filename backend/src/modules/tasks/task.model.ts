import { Schema, model, type InferSchemaType } from 'mongoose'
import { revFields, softDeleteFields } from '../../lib/concurrency.ts'
import { PRIORITIES } from '../content/content.model.ts'

/** §6.7 / D37: To Do → In Progress → In Review → Done (+ Cancelled). Any state can go back. */
export const TASK_STATUSES = ['todo', 'in_progress', 'in_review', 'done', 'cancelled'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]
/** A dependency in one of these states no longer blocks (D38: completed *or* cancelled). */
export const TASK_END_STATES: readonly TaskStatus[] = ['done', 'cancelled']

/** Where a task came from. Feedback and checklist tasks are unique per source (one item → at most one task, D21). */
export const TASK_SOURCES = ['manual', 'feedback', 'checklist', 'meeting', 'template'] as const

/**
 * Agency work. "Blocked" is a flag, not a column (D37): set by hand with a reason, or automatically while any
 * dependency is unfinished (D38). Agency-only — never visible to client people.
 */
const taskSchema = new Schema(
  {
    agency: { type: Schema.Types.ObjectId, ref: 'Agency', required: true },
    client: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    campaign: { type: Schema.Types.ObjectId, ref: 'Campaign', default: null },
    content: { type: Schema.Types.ObjectId, ref: 'Content', default: null },
    thread: { type: Schema.Types.ObjectId, ref: 'Thread', default: null },
    checklistItem: { type: Schema.Types.ObjectId, ref: 'ChecklistItem', default: null },
    meeting: { type: Schema.Types.ObjectId, ref: 'Meeting', default: null },
    source: { type: String, enum: TASK_SOURCES, default: 'manual' },

    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    owner: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    collaborators: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
    /** Date-only, in the client's timezone. */
    due: { type: String, default: '' },
    priority: { type: String, enum: PRIORITIES, default: 'normal' },
    status: { type: String, enum: TASK_STATUSES, default: 'todo' },
    statusChangedAt: { type: Date, default: Date.now },
    /** Order inside its board column; lower first. */
    position: { type: Number, default: 0 },

    blocked: {
      manual: { type: Boolean, default: false },
      reason: { type: String, default: '' },
      /** True while any dependency is unfinished. Kept in sync by the task service. */
      byDependency: { type: Boolean, default: false },
    },
    dependencies: {
      type: [new Schema({ type: { type: String, enum: ['task', 'request'], required: true }, id: { type: Schema.Types.ObjectId, required: true } }, { _id: false })],
      default: [],
    },
    attachments: { type: [{ type: Schema.Types.ObjectId, ref: 'File' }], default: [] },
    completedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    ...revFields,
    ...softDeleteFields,
  },
  { timestamps: true },
)

taskSchema.index({ agency: 1, client: 1, status: 1, position: 1 })
taskSchema.index({ agency: 1, owner: 1, status: 1 })
taskSchema.index({ 'dependencies.id': 1 })
// One task per feedback item and per checklist item, so converting twice can never duplicate.
taskSchema.index({ thread: 1 }, { unique: true, partialFilterExpression: { source: 'feedback', deletedAt: null } })
taskSchema.index({ checklistItem: 1 }, { unique: true, partialFilterExpression: { checklistItem: { $type: 'objectId' }, deletedAt: null } })

export type Task = InferSchemaType<typeof taskSchema>
export const TaskModel = model('Task', taskSchema)
