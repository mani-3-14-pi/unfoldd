import { Schema, model, type InferSchemaType } from 'mongoose'
import { revFields, softDeleteFields, type Transition } from '../../lib/concurrency.ts'
import { PLATFORMS } from '../content/content.model.ts'

/** §6.11: planning → active → completed → archived. Progress is derived from its content states (P36). */
export const CAMPAIGN_STATUSES = ['planning', 'active', 'completed', 'archived'] as const
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number]

export const CAMPAIGN_TRANSITIONS = {
  activate: { from: ['planning', 'completed'], to: 'active' },
  complete: { from: ['active'], to: 'completed' },
  archive: { from: ['planning', 'active', 'completed'], to: 'archived' },
} as const satisfies Record<string, Transition<CampaignStatus>>

/** A campaign for one client (P32–P36): its objective, dates and brief, grouping content. */
const campaignSchema = new Schema(
  {
    agency: { type: Schema.Types.ObjectId, ref: 'Agency', required: true },
    client: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    name: { type: String, required: true, trim: true },
    objective: { type: String, default: '' },
    audience: { type: String, default: '' },
    keyMessage: { type: String, default: '' },
    /** Date-only, in the client's timezone. */
    startDate: { type: String, default: '' },
    endDate: { type: String, default: '' },
    platforms: { type: [{ type: String, enum: PLATFORMS }], default: [] },
    owner: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    team: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
    /** The brief is agency-internal; the client sees name, objective, key message, dates and progress. */
    brief: {
      background: { type: String, default: '' },
      strategy: { type: String, default: '' },
      deliverables: { type: String, default: '' },
      references: { type: String, default: '' },
      successCriteria: { type: String, default: '' },
    },
    status: { type: String, enum: CAMPAIGN_STATUSES, default: 'planning' },
    statusBeforeArchive: { type: String, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    ...revFields,
    ...softDeleteFields,
  },
  { timestamps: true },
)

campaignSchema.index({ agency: 1, client: 1, status: 1, deletedAt: 1 })

export type Campaign = InferSchemaType<typeof campaignSchema>
export const CampaignModel = model('Campaign', campaignSchema)
