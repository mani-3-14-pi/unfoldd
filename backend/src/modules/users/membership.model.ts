import { Schema, model, type InferSchemaType } from 'mongoose'

/**
 * Agency permission roles (D44, without Viewer). Job titles and departments are separate, free tags.
 * Owner: everything, exactly one. Admin: team, settings, every client. Manager and Member: assigned clients only.
 */
export const MEMBER_ROLES = ['owner', 'admin', 'manager', 'member'] as const
export type MemberRole = (typeof MEMBER_ROLES)[number]
/** Invited people have an Invitation, not a membership, until they accept. */
export const MEMBER_STATUSES = ['active', 'disabled'] as const

/** D56: maximum active tasks per person. */
export const DEFAULT_CAPACITY = 10

/** A person's place in one agency: an AgencyMember in the design doc. */
const membershipSchema = new Schema(
  {
    agency: { type: Schema.Types.ObjectId, ref: 'Agency', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: MEMBER_ROLES, default: 'member' },
    /** D25: lets a Manager or Member publish. Always true in effect for Owner/Admin. */
    canPublish: { type: Boolean, default: false },
    titles: { type: [String], default: [] },
    departments: { type: [String], default: [] },
    capacity: { type: Number, default: DEFAULT_CAPACITY, min: 1, max: 100 },
    status: { type: String, enum: MEMBER_STATUSES, default: 'active' },
    disabledAt: Date,
  },
  { timestamps: true },
)

membershipSchema.index({ agency: 1, user: 1 }, { unique: true })
membershipSchema.index({ user: 1 })

export type Membership = InferSchemaType<typeof membershipSchema>
export const MembershipModel = model('Membership', membershipSchema)
