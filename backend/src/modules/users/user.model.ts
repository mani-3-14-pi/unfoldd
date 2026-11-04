import { Schema, model, type InferSchemaType } from 'mongoose'
import { twoFactorFields } from '../sessions/mfaChallenge.model.ts'

/**
 * A person with one login (one email). Their access is memberships: Membership for agencies,
 * ClientMember for clients (D43). The same login can hold both, with switchers.
 */
const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    timezone: { type: String, default: '' },
    /** Per category × channel (D68). Missing = on. Mandatory categories ignore this. */
    notificationPrefs: { type: Map, of: new Schema({ email: Boolean, push: Boolean }, { _id: false }), default: {} },
    lastLoginAt: Date,
    /** Mandatory for agency owners; not used by anyone else. */
    ...twoFactorFields,
  },
  { timestamps: true },
)

export type User = InferSchemaType<typeof userSchema>
export const UserModel = model('User', userSchema)
