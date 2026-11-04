import { Schema, model, type InferSchemaType } from 'mongoose'

export const ACTOR_TYPES = ['platform_admin', 'agency_user', 'client_user', 'system'] as const

/**
 * Who may read an event (D20). `client` events show in the client's feed as well as the agency's;
 * `internal` ones only to the agency; `platform` ones only to platform admins.
 */
export const VISIBILITIES = ['internal', 'client', 'platform'] as const
export type Visibility = (typeof VISIBILITIES)[number]

/**
 * The append-only event log (D54): activity feeds, change history, audit and notification sources all read from it.
 * The app never updates an event; the hooks below refuse it.
 */
const activitySchema = new Schema({
  action: { type: String, required: true },
  actor: {
    type: { type: String, enum: ACTOR_TYPES, required: true },
    id: Schema.Types.ObjectId,
    name: String,
  },
  /** Set when a platform admin acted inside an agency portal (support view). */
  impersonator: { id: Schema.Types.ObjectId, name: String },
  agency: { type: Schema.Types.ObjectId, ref: 'Agency' },
  client: { type: Schema.Types.ObjectId, ref: 'Client' },
  visibility: { type: String, enum: VISIBILITIES, default: 'internal' },
  /** The entity the event is about. */
  target: { type: { type: String }, id: Schema.Types.ObjectId, label: String },
  message: { type: String, required: true },
  before: Schema.Types.Mixed,
  after: Schema.Types.Mixed,
  meta: Schema.Types.Mixed,
  ip: String,
  userAgent: String,
  createdAt: { type: Date, default: Date.now },
})

activitySchema.index({ createdAt: -1 })
activitySchema.index({ agency: 1, createdAt: -1 })
activitySchema.index({ agency: 1, client: 1, visibility: 1, createdAt: -1 })
activitySchema.index({ 'target.id': 1, createdAt: -1 })
activitySchema.index({ action: 1, createdAt: -1 })

for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace'] as const) {
  activitySchema.pre(op, () => {
    throw new Error('The activity log is append-only.')
  })
}

export type Activity = InferSchemaType<typeof activitySchema>
export const ActivityModel = model('Activity', activitySchema)
