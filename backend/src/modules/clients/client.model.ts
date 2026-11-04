import { Schema, model, type InferSchemaType } from 'mongoose'
import { revFields, softDeleteFields, type Transition } from '../../lib/concurrency.ts'

/** §6.10: onboarding → active ↔ paused → completed → archived. Archived is read-only for everyone. */
export const CLIENT_STATUSES = ['onboarding', 'active', 'paused', 'completed', 'archived'] as const
export type ClientStatus = (typeof CLIENT_STATUSES)[number]

export const CLIENT_TRANSITIONS = {
  activate: { from: ['onboarding', 'paused'], to: 'active' },
  pause: { from: ['active'], to: 'paused' },
  complete: { from: ['active', 'paused'], to: 'completed' },
  archive: { from: ['onboarding', 'active', 'paused', 'completed'], to: 'archived' },
} as const satisfies Record<string, Transition<ClientStatus>>
export type ClientAction = keyof typeof CLIENT_TRANSITIONS | 'restore'

const contractSchema = new Schema(
  {
    /** Revisions included per content item (D09). Going over is flagged, not blocked. */
    revisionsIncluded: { type: Number, default: 2, min: 0, max: 50 },
    /** "Needed by" = publish_date − this (§6.10). */
    approvalLeadHours: { type: Number, default: 24, min: 0, max: 24 * 30 },
    /** D46: internal review before sending to the client. */
    internalReview: { type: Boolean, default: true },
  },
  { _id: false },
)

/** One brand an agency works for (D43). A company with three brands is three clients. */
const clientSchema = new Schema(
  {
    agency: { type: Schema.Types.ObjectId, ref: 'Agency', required: true },
    name: { type: String, required: true, trim: true },
    brandName: { type: String, required: true, trim: true },
    logo: { type: Schema.Types.ObjectId, ref: 'File', default: null },
    contact: {
      name: { type: String, default: '' },
      email: { type: String, default: '', lowercase: true, trim: true },
      phone: { type: String, default: '' },
    },
    services: { type: [String], default: [] },
    accountManager: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    /** Date-only, in the client's timezone. */
    startDate: { type: String, default: '' },
    notes: { type: String, default: '' },
    timezone: { type: String, required: true },
    status: { type: String, enum: CLIENT_STATUSES, default: 'onboarding' },
    /** Where `restore` returns an archived client to. */
    statusBeforeArchive: { type: String, enum: [...CLIENT_STATUSES, null], default: null },
    statusChangedAt: Date,
    contract: { type: contractSchema, default: () => ({}) },
    /** D47: the only per-client switch. Off until analytics exists. */
    showAnalytics: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    /** Bumped by every member change, so concurrent ones conflict and the last-admin check can't be raced. */
    memberRev: { type: Number, default: 0 },
    ...revFields,
    ...softDeleteFields,
  },
  { timestamps: true },
)

clientSchema.index({ agency: 1, status: 1, createdAt: -1 })
clientSchema.index({ agency: 1, brandName: 1 })

export type Client = InferSchemaType<typeof clientSchema>
export const ClientModel = model('Client', clientSchema)
