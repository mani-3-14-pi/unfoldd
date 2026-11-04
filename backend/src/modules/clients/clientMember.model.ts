import { Schema, model, type InferSchemaType } from 'mongoose'

/** D47. Admin: everything + invite colleagues. Approver: approve. Contributor: feedback + uploads. Viewer: read only. */
export const CLIENT_ROLES = ['admin', 'approver', 'contributor', 'viewer'] as const
export type ClientRole = (typeof CLIENT_ROLES)[number]
export const CLIENT_MEMBER_STATUSES = ['active', 'disabled'] as const

/** A brand-side person's access to one client. A client always keeps at least one active Admin. */
const clientMemberSchema = new Schema(
  {
    agency: { type: Schema.Types.ObjectId, ref: 'Agency', required: true },
    client: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: CLIENT_ROLES, default: 'contributor' },
    status: { type: String, enum: CLIENT_MEMBER_STATUSES, default: 'active' },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
)

clientMemberSchema.index({ client: 1, user: 1 }, { unique: true })
clientMemberSchema.index({ user: 1 })

export type ClientMember = InferSchemaType<typeof clientMemberSchema>
export const ClientMemberModel = model('ClientMember', clientMemberSchema)
