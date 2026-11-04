import { Schema, model, type InferSchemaType } from 'mongoose'

/** Every email the app sends. The dev mailer only writes here (and to the console); a real provider marks them sent. */
const outboxSchema = new Schema({
  to: { type: String, required: true },
  from: { type: String, required: true },
  subject: { type: String, required: true },
  text: { type: String, required: true },
  html: String,
  /** e.g. `invitation`, `notification`, `digest`. */
  kind: { type: String, required: true },
  // queued → sent | failed. Sending happens in the `email.send` job.
  provider: { type: String, default: 'dev' },
  status: { type: String, enum: ['queued', 'sent', 'failed'], default: 'queued' },
  error: String,
  createdAt: { type: Date, default: Date.now },
  sentAt: Date,
})

outboxSchema.index({ createdAt: -1 })
outboxSchema.index({ to: 1, createdAt: -1 })

export type OutboxEmail = InferSchemaType<typeof outboxSchema>
export const OutboxModel = model('OutboxEmail', outboxSchema)
