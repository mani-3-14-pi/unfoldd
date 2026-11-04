import { Schema, model, type InferSchemaType } from 'mongoose'

/**
 * The step between "password correct" and "signed in" for people who must use 2FA (platform admins and agency
 * owners). Holds where the login was going, and for a first-time setup the new secret until it's confirmed.
 * Only a hash of the challenge token is stored; it lives 10 minutes and allows 5 wrong codes.
 */
const mfaChallengeSchema = new Schema({
  tokenHash: { type: String, required: true, unique: true },
  subjectKind: { type: String, enum: ['platform_admin', 'user'], required: true },
  subject: { type: Schema.Types.ObjectId, required: true },
  purpose: { type: String, enum: ['verify', 'setup'], required: true },
  /** Encrypted; set when setup starts. */
  pendingSecret: { type: String, default: null },
  /** Where the session goes once verified (agency or client context). */
  target: { agency: Schema.Types.ObjectId, client: Schema.Types.ObjectId },
  attempts: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true, expires: 0 },
})

export type MfaChallenge = InferSchemaType<typeof mfaChallengeSchema>
export const MfaChallengeModel = model('MfaChallenge', mfaChallengeSchema)

/** Second-factor fields on PlatformAdmin and User. The secret and backup codes are never selected by default. */
export const twoFactorFields = {
  twoFactor: {
    secret: { type: String, select: false },
    enabledAt: { type: Date, default: null },
    /** sha256 hashes of unused backup codes. */
    backupCodes: { type: [String], select: false, default: undefined },
    /** The last accepted step, so a code can't be used twice. */
    lastStep: { type: Number, default: null },
  },
}
