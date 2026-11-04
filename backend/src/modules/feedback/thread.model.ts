import { Schema, model, type InferSchemaType } from 'mongoose'

/** §6.5: open → in_progress → resolved; reopen → open with `reopenedAt`. Discussions have no status. */
export const THREAD_STATUSES = ['open', 'in_progress', 'resolved'] as const
export const THREAD_CONTEXTS = ['content', 'content_plan', 'campaign', 'task', 'meeting', 'request', 'client_general'] as const

/**
 * D17: feedback items and conversations are one Thread + Message engine. A feedback item is a thread with an
 * anchor and a status. A thread whose `submittedAt` is null is a draft that only its author can see (D14).
 */
const threadSchema = new Schema(
  {
    agency: { type: Schema.Types.ObjectId, ref: 'Agency', required: true },
    client: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    context: {
      type: { type: String, enum: THREAD_CONTEXTS, required: true },
      id: { type: Schema.Types.ObjectId, default: null },
    },
    /** For content feedback: the content and the version it was given on. */
    content: { type: Schema.Types.ObjectId, ref: 'Content', default: null },
    version: { type: Schema.Types.ObjectId, ref: 'Version', default: null },
    versionNumber: { type: Number, default: null },
    kind: { type: String, enum: ['feedback', 'discussion'], default: 'feedback' },
    visibility: { type: String, enum: ['internal', 'client'], required: true },
    /** D75: per content and per visibility, increasing across versions. Given at submit, so drafts leave no gaps. */
    pin: { type: Number, default: null },
    /** D11/D12/D13: a file of its own version, a video time, and shapes in 0–1 coordinates. */
    anchor: {
      versionFile: { type: Schema.Types.ObjectId, default: null },
      timeMs: { type: Number, default: null, min: 0 },
      shapes: { type: [Schema.Types.Mixed], default: undefined },
    },
    /** The rendered annotation (or video frame) image. */
    snapshot: { type: Schema.Types.ObjectId, ref: 'File', default: null },
    assignee: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    status: { type: String, enum: [...THREAD_STATUSES, null], default: null },
    reopenedAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
    resolvedBy: { id: Schema.Types.ObjectId, name: String },
    resolvedInVersion: { id: { type: Schema.Types.ObjectId, ref: 'Version' }, number: Number },
    resolutionNote: { type: String, default: '' },
    /** D16: closed because the client approved the version. */
    closedOnApproval: { type: Boolean, default: false },
    author: { id: { type: Schema.Types.ObjectId, ref: 'User' }, name: String, side: { type: String, enum: ['agency', 'client'] } },
    /** Null = pending draft (D14). */
    submittedAt: { type: Date, default: null },
    messageCount: { type: Number, default: 0 },
    lastMessageAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
)

threadSchema.index({ content: 1, visibility: 1, submittedAt: 1, deletedAt: 1 })
threadSchema.index({ agency: 1, kind: 1, visibility: 1, status: 1, submittedAt: -1 })
threadSchema.index({ 'author.id': 1, submittedAt: 1, content: 1 })

export type Thread = InferSchemaType<typeof threadSchema>
export const ThreadModel = model('Thread', threadSchema)
