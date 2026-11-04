import { Schema, model, type InferSchemaType } from 'mongoose'
import { twoFactorFields } from '../sessions/mfaChallenge.model.ts'

/** A platform (super) admin: Unfoldd staff who manage every agency. Signs in with username + password. */
const platformAdminSchema = new Schema(
  {
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    status: { type: String, enum: ['active', 'disabled'], default: 'active' },
    lastLoginAt: Date,
    /** Mandatory for every platform admin. */
    ...twoFactorFields,
  },
  { timestamps: true },
)

export type PlatformAdmin = InferSchemaType<typeof platformAdminSchema>
export const PlatformAdminModel = model('PlatformAdmin', platformAdminSchema)
