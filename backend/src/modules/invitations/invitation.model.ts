import { Schema, model, type InferSchemaType } from 'mongoose'
import type { Transition } from '../../lib/concurrency.ts'

/** §6.8: pending → accepted | declined | expired | revoked. `expired` is also derived from `expiresAt`. */
export const INVITATION_STATUSES = ['pending', 'accepted', 'declined', 'expired', 'revoked'] as const
export type InvitationStatus = (typeof INVITATION_STATUSES)[number]

export const INVITATION_TRANSITIONS = {
  accept: { from: ['pending'], to: 'accepted' },
  decline: { from: ['pending'], to: 'declined' },
  revoke: { from: ['pending'], to: 'revoked' },
  expire: { from: ['pending'], to: 'expired' },
} as const satisfies Record<string, Transition<InvitationStatus>>

/** D49 */
export const INVITE_TTL_DAYS = 7

/**
 * An invitation to an agency team or to a client. Bound to the invited email; only a hash of the token is stored.
 * Resending creates a new invitation and revokes this one, so only the latest link works.
 */
const invitationSchema = new Schema(
  {
    kind: { type: String, enum: ['agency', 'client'], required: true },
    agency: { type: Schema.Types.ObjectId, ref: 'Agency', required: true },
    client: { type: Schema.Types.ObjectId, ref: 'Client', default: null },
    email: { type: String, required: true, lowercase: true, trim: true },
    /** An agency role (MEMBER_ROLES) or a client role (CLIENT_ROLES), depending on `kind`. */
    role: { type: String, required: true },
    message: { type: String, default: '' },
    invitedBy: { id: { type: Schema.Types.ObjectId, ref: 'User' }, name: String, side: { type: String, enum: ['agency', 'client'] } },
    tokenHash: { type: String, required: true, unique: true },
    status: { type: String, enum: INVITATION_STATUSES, default: 'pending' },
    expiresAt: { type: Date, required: true },
    /** D74: the invitee asked for a new link from an expired one. */
    reinviteRequestedAt: Date,
    /** The invitation this one replaced on resend. */
    replaces: { type: Schema.Types.ObjectId, ref: 'Invitation' },
    acceptedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    respondedAt: Date,
  },
  { timestamps: true },
)

invitationSchema.index({ agency: 1, kind: 1, status: 1, createdAt: -1 })
invitationSchema.index({ client: 1, status: 1 })
invitationSchema.index({ email: 1, status: 1 })

export type Invitation = InferSchemaType<typeof invitationSchema>
export const InvitationModel = model('Invitation', invitationSchema)
