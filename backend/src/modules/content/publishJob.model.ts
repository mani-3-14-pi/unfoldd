import { Schema, model, type InferSchemaType } from 'mongoose'

/** §6.11: queued → running → succeeded | failed | unknown | cancelled. Content state stays the source of truth. */
export const PUBLISH_JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'unknown', 'cancelled'] as const

/**
 * A scheduled publish of the approved version (D27). The time is read from `Content.publishDate`, never stored
 * here (D28). With a `manual` account the job only reminds the publisher, who then marks it published (D26).
 * Failures stay on the job; the content returns to `scheduled` (D79).
 */
const publishJobSchema = new Schema(
  {
    agency: { type: Schema.Types.ObjectId, ref: 'Agency', required: true },
    client: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    content: { type: Schema.Types.ObjectId, ref: 'Content', required: true },
    version: { type: Schema.Types.ObjectId, ref: 'Version', required: true },
    account: {
      kind: { type: String, enum: ['manual', 'instagram', 'facebook', 'linkedin', 'youtube', 'x'], default: 'manual' },
      /** The PlatformConnection, for non-manual accounts. */
      id: { type: Schema.Types.ObjectId, ref: 'PlatformConnection', default: null },
      label: { type: String, default: 'Manual' },
    },
    status: { type: String, enum: PUBLISH_JOB_STATUSES, default: 'queued' },
    attempts: { type: Number, default: 0 },
    externalId: { type: String, default: '' },
    externalUrl: { type: String, default: '' },
    error: { type: String, default: '' },
    /** Manual accounts: when the publisher was reminded. */
    remindedAt: { type: Date, default: null },
    scheduledBy: { id: Schema.Types.ObjectId, name: String },
    finishedAt: Date,
  },
  { timestamps: true },
)

publishJobSchema.index({ content: 1, status: 1 })
publishJobSchema.index({ status: 1, 'account.kind': 1, remindedAt: 1 })

export type PublishJob = InferSchemaType<typeof publishJobSchema>
export const PublishJobModel = model('PublishJob', publishJobSchema)
