import { Schema, model, type InferSchemaType } from 'mongoose'
import { PLATFORM_KEYS } from '../../lib/platforms/types.ts'

/**
 * A client's social account connected for publishing (P157, D66). Tokens are encrypted at rest and never sent
 * to any browser. `expired`/`error` connections stop publishing and raise "Reconnect" alerts (D27).
 */
const connectionSchema = new Schema(
  {
    agency: { type: Schema.Types.ObjectId, ref: 'Agency', required: true },
    client: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    platform: { type: String, enum: PLATFORM_KEYS, required: true },
    externalId: { type: String, required: true },
    name: { type: String, required: true },
    handle: { type: String, default: '' },
    /** Encrypted JSON of the platform tokens. */
    tokens: { type: String, required: true, select: false },
    tokenExpiresAt: { type: Date, default: null },
    meta: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ['active', 'expired', 'error', 'disconnected'], default: 'active' },
    lastError: { type: String, default: '' },
    lastCheckedAt: { type: Date, default: null },
    connectedBy: { id: Schema.Types.ObjectId, name: String },
  },
  { timestamps: true },
)

connectionSchema.index({ client: 1, platform: 1, externalId: 1 }, { unique: true })
connectionSchema.index({ status: 1, tokenExpiresAt: 1 })

export type PlatformConnection = InferSchemaType<typeof connectionSchema>
export const ConnectionModel = model('PlatformConnection', connectionSchema)

/** An OAuth round trip in progress: binds the callback to who started it and for which client (CSRF-safe). */
const oauthStateSchema = new Schema({
  stateHash: { type: String, required: true, unique: true },
  app: { type: String, required: true },
  agency: { type: Schema.Types.ObjectId, required: true },
  client: { type: Schema.Types.ObjectId, required: true },
  user: { id: Schema.Types.ObjectId, name: String },
  /** PKCE verifier (X), encrypted. */
  codeVerifier: { type: String, default: null },
  /** Accounts found at callback, waiting for the person to pick (encrypted, includes tokens). */
  found: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true, expires: 0 },
})

export type OAuthState = InferSchemaType<typeof oauthStateSchema>
export const OAuthStateModel = model<OAuthState>('OAuthState', oauthStateSchema)
