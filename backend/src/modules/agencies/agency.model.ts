import { Schema, model, type InferSchemaType } from 'mongoose'
import { revFields } from '../../lib/concurrency.ts'
import { AGENCY_STATUSES, AGENCY_TYPES, PLANS, SUBSCRIPTION_STATUSES, TEAM_SIZES } from './agency.constants.ts'

const subscriptionSchema = new Schema(
  {
    plan: { type: String, enum: PLANS, default: 'trial' },
    status: { type: String, enum: SUBSCRIPTION_STATUSES, default: 'trialing' },
    seats: { type: Number, default: 5, min: 1 },
    startedAt: Date,
    renewsAt: Date,
    notes: { type: String, default: '' },
  },
  { _id: false },
)

/** Defaults copied into each new client's contract (Flow 1, step 2). */
const clientDefaultsSchema = new Schema(
  {
    revisionsIncluded: { type: Number, default: 2, min: 0, max: 50 },
    approvalLeadHours: { type: Number, default: 24, min: 0, max: 24 * 30 },
    internalReview: { type: Boolean, default: true },
  },
  { _id: false },
)

/** A tenant: one agency using Unfoldd. Signs up, then waits for approval unless auto-approve is on. */
const agencySchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, default: '' },
    website: { type: String, default: '' },
    country: { type: String, default: '' },
    teamSize: { type: String, enum: [...TEAM_SIZES, ''], default: '' },
    // Profile (P01, P03)
    logo: { type: Schema.Types.ObjectId, ref: 'File', default: null },
    description: { type: String, default: '' },
    type: { type: String, enum: [...AGENCY_TYPES, ''], default: '' },
    services: { type: [String], default: [] },
    contactName: { type: String, default: '' },
    timezone: { type: String, default: 'Asia/Kolkata' },
    clientDefaults: { type: clientDefaultsSchema, default: () => ({}) },

    status: { type: String, enum: AGENCY_STATUSES, default: 'pending', index: true },
    /** Why it was rejected or suspended; shown to the agency when they try to log in. */
    statusReason: { type: String, default: '' },
    statusChangedAt: Date,
    approvedAt: Date,
    owner: { type: Schema.Types.ObjectId, ref: 'User' },
    subscription: { type: subscriptionSchema, default: () => ({}) },
    ...revFields,
  },
  { timestamps: true },
)

agencySchema.index({ createdAt: -1 })
agencySchema.index({ 'subscription.plan': 1, 'subscription.status': 1 })

export type Agency = InferSchemaType<typeof agencySchema>
export const AgencyModel = model('Agency', agencySchema)
