import { Schema, model, type InferSchemaType } from 'mongoose'

/**
 * One decision on one version (P84 approval history). Internal decisions come from the agency reviewer;
 * client decisions from a client Admin/Approver. `pulled` is an approval taken back (D08).
 * Revision count = distinct versions with a client `changes_requested` (D09).
 */
const reviewDecisionSchema = new Schema({
  agency: { type: Schema.Types.ObjectId, ref: 'Agency', required: true },
  client: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
  content: { type: Schema.Types.ObjectId, ref: 'Content', required: true },
  version: { type: Schema.Types.ObjectId, ref: 'Version', required: true },
  versionNumber: { type: Number, required: true },
  scope: { type: String, enum: ['internal', 'client'], required: true },
  decision: { type: String, enum: ['approved', 'changes_requested', 'pulled'], required: true },
  by: { id: { type: Schema.Types.ObjectId, ref: 'User' }, name: String },
  note: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
})

reviewDecisionSchema.index({ content: 1, createdAt: -1 })
reviewDecisionSchema.index({ content: 1, scope: 1, decision: 1, version: 1 })

export type ReviewDecision = InferSchemaType<typeof reviewDecisionSchema>
export const ReviewDecisionModel = model('ReviewDecision', reviewDecisionSchema)
