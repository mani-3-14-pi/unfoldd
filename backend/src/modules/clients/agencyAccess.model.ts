import { Schema, model, type InferSchemaType } from 'mongoose'

/**
 * Which agency people work on which client (P135). Owner and Admin see every client without a row here;
 * Managers and Members see only clients they have a row for. Effective permission = role ∩ access (D45).
 */
const agencyAccessSchema = new Schema(
  {
    agency: { type: Schema.Types.ObjectId, ref: 'Agency', required: true },
    client: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    addedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
)

agencyAccessSchema.index({ client: 1, user: 1 }, { unique: true })
agencyAccessSchema.index({ agency: 1, user: 1 })

export type AgencyAccess = InferSchemaType<typeof agencyAccessSchema>
export const AgencyAccessModel = model('AgencyAccess', agencyAccessSchema)
