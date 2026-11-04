import { Schema, model, type InferSchemaType } from 'mongoose'

/** A remembered response for an `Idempotency-Key`, so a retried request gets the first result (rule §12.4). */
const idempotencySchema = new Schema({
  /** Whose key it is: a user id, or a hash of a public token. */
  scope: { type: String, required: true },
  key: { type: String, required: true },
  route: { type: String, required: true },
  state: { type: String, enum: ['in_progress', 'done'], default: 'in_progress' },
  status: Number,
  body: Schema.Types.Mixed,
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true, expires: 0 },
})

idempotencySchema.index({ scope: 1, key: 1 }, { unique: true })

export type IdempotencyRecord = InferSchemaType<typeof idempotencySchema>
export const IdempotencyModel = model('IdempotencyKey', idempotencySchema)
