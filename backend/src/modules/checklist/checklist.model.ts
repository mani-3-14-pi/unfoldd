import { Schema, model, type InferSchemaType } from 'mongoose'

/**
 * One item of a content version's revision checklist (Flow 7). AI suggestions start as `suggested` and are
 * agency-only; the agency accepts (optionally editing), removes, or adds its own. Only `accepted` items are
 * ever shown to the client (D21). Raw AI output never reaches the client.
 */
export const CHECKLIST_STATUSES = ['suggested', 'accepted', 'removed'] as const

const checklistItemSchema = new Schema(
  {
    agency: { type: Schema.Types.ObjectId, ref: 'Agency', required: true },
    client: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    content: { type: Schema.Types.ObjectId, ref: 'Content', required: true },
    version: { type: Schema.Types.ObjectId, ref: 'Version', required: true },
    versionNumber: { type: Number, required: true },
    text: { type: String, required: true, trim: true },
    /** The AI's wording, kept when a person edits it (every acceptance is logged with what changed). */
    suggestedText: { type: String, default: '' },
    sourceThreads: { type: [{ type: Schema.Types.ObjectId, ref: 'Thread' }], default: [] },
    origin: { type: String, enum: ['ai', 'human'], required: true },
    status: { type: String, enum: CHECKLIST_STATUSES, default: 'suggested' },
    run: { type: Schema.Types.ObjectId, ref: 'ChecklistRun', default: null },
    order: { type: Number, default: 0 },
    decidedBy: { id: Schema.Types.ObjectId, name: String },
    decidedAt: Date,
    /** Set by the task service when converted (at most one task per item). */
    task: { type: Schema.Types.ObjectId, ref: 'Task', default: null },
  },
  { timestamps: true },
)

checklistItemSchema.index({ content: 1, version: 1, status: 1, order: 1 })

export type ChecklistItem = InferSchemaType<typeof checklistItemSchema>
export const ChecklistItemModel = model('ChecklistItem', checklistItemSchema)

/** One AI pass over a version's feedback. Claimed atomically by the worker; failures can be retried (D21). */
const checklistRunSchema = new Schema(
  {
    agency: { type: Schema.Types.ObjectId, ref: 'Agency', required: true },
    client: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    content: { type: Schema.Types.ObjectId, ref: 'Content', required: true },
    version: { type: Schema.Types.ObjectId, ref: 'Version', required: true },
    status: { type: String, enum: ['queued', 'running', 'done', 'failed', 'skipped'], default: 'queued' },
    attempts: { type: Number, default: 0 },
    /** When a running job is considered dead and can be claimed again. */
    leaseUntil: { type: Date, default: null },
    runAfter: { type: Date, default: Date.now },
    error: { type: String, default: '' },
    provider: String,
    model: String,
    usage: { inputTokens: Number, outputTokens: Number },
    suggestions: { type: Number, default: 0 },
    requestedBy: { id: Schema.Types.ObjectId, name: String },
    finishedAt: Date,
  },
  { timestamps: true },
)

checklistRunSchema.index({ status: 1, runAfter: 1 })
checklistRunSchema.index({ content: 1, createdAt: -1 })

export type ChecklistRun = InferSchemaType<typeof checklistRunSchema>
export const ChecklistRunModel = model('ChecklistRun', checklistRunSchema)
