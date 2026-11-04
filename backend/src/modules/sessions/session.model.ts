import { Schema, model, type InferSchemaType } from 'mongoose'

/**
 * A signed-in browser. Only a hash of the cookie token is stored.
 * `platform` sessions belong to a PlatformAdmin. `agency` sessions belong to a User and point at the context
 * they are working in: an agency portal (`agency` only) or a client space (`agency` + `client`).
 * Switching agency or brand replaces the session. A support session is an agency session opened by a platform admin (`impersonator`).
 */
const sessionSchema = new Schema({
  tokenHash: { type: String, required: true, unique: true },
  kind: { type: String, enum: ['platform', 'agency'], required: true },
  subject: { type: Schema.Types.ObjectId, required: true, index: true },
  agency: { type: Schema.Types.ObjectId, ref: 'Agency', index: true },
  client: { type: Schema.Types.ObjectId, ref: 'Client', default: null },
  impersonator: { type: Schema.Types.ObjectId, ref: 'PlatformAdmin' },
  /** When the second factor was checked for this sign-in (2FA logins only). */
  mfaAt: { type: Date, default: null },
  ip: String,
  userAgent: String,
  createdAt: { type: Date, default: Date.now },
  // TTL index: MongoDB deletes the session once it expires.
  expiresAt: { type: Date, required: true, expires: 0 },
})

export type Session = InferSchemaType<typeof sessionSchema>
export const SessionModel = model('Session', sessionSchema)
