import { Schema, model, type InferSchemaType } from 'mongoose'

/**
 * The background job queue, stored in MongoDB (no extra infrastructure). Workers claim a job atomically and
 * hold a lease while they run it; a job whose worker died is picked up again when the lease runs out.
 * queued → running → done | failed (will retry) → dead (out of attempts).
 */
export const JOB_STATUSES = ['queued', 'running', 'done', 'dead'] as const

const jobSchema = new Schema(
  {
    type: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, enum: JOB_STATUSES, default: 'queued' },
    runAt: { type: Date, default: Date.now },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    leaseUntil: { type: Date, default: null },
    lastError: { type: String, default: '' },
    /** At most one queued or running job per key (e.g. one recurring tick, one publish per content). */
    uniqueKey: { type: String, default: null },
    finishedAt: Date,
  },
  { timestamps: true },
)

jobSchema.index({ status: 1, runAt: 1 })
jobSchema.index({ uniqueKey: 1 }, { unique: true, partialFilterExpression: { uniqueKey: { $type: 'string' }, status: { $in: ['queued', 'running'] } } })
// Finished jobs are kept for a week for debugging, then removed.
jobSchema.index({ finishedAt: 1 }, { expireAfterSeconds: 7 * 86_400 })

export type Job = InferSchemaType<typeof jobSchema>
export const JobModel = model('Job', jobSchema)
