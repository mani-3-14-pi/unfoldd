import { Schema, model, type InferSchemaType } from 'mongoose'

/**
 * One reading of a published post's numbers (D58). Readings are appended; the latest per post is the current
 * value. Engagements = likes + comments + shares + saves; engagement rate = engagements ÷ reach; anything a
 * platform doesn't give stays null and shows as "n/a".
 */
const snapshotSchema = new Schema({
  agency: { type: Schema.Types.ObjectId, ref: 'Agency', required: true },
  client: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
  content: { type: Schema.Types.ObjectId, ref: 'Content', required: true },
  connection: { type: Schema.Types.ObjectId, ref: 'PlatformConnection', default: null },
  platform: { type: String, required: true },
  externalId: { type: String, required: true },
  metrics: {
    impressions: { type: Number, default: null },
    reach: { type: Number, default: null },
    views: { type: Number, default: null },
    likes: { type: Number, default: null },
    comments: { type: Number, default: null },
    shares: { type: Number, default: null },
    saves: { type: Number, default: null },
    linkClicks: { type: Number, default: null },
    engagements: { type: Number, default: null },
    engagementRate: { type: Number, default: null },
  },
  collectedAt: { type: Date, default: Date.now },
})

snapshotSchema.index({ content: 1, collectedAt: -1 })
snapshotSchema.index({ client: 1, collectedAt: -1 })

export type AnalyticsSnapshot = InferSchemaType<typeof snapshotSchema>
export const AnalyticsSnapshotModel = model('AnalyticsSnapshot', snapshotSchema)

/**
 * A report for a client and period (P126–P129, D53). Its data is a frozen snapshot taken when generated, so a
 * shared report never changes underneath the client. Drafts can be regenerated; shared ones can't.
 */
export const REPORT_SECTIONS = ['summary', 'platforms', 'top_posts', 'delivery', 'notes'] as const

const reportSchema = new Schema(
  {
    agency: { type: Schema.Types.ObjectId, ref: 'Agency', required: true },
    client: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    title: { type: String, required: true, trim: true },
    /** Date-only, in the client's timezone. */
    period: { from: { type: String, required: true }, to: { type: String, required: true } },
    sections: { type: [{ type: String, enum: REPORT_SECTIONS }], default: () => [...REPORT_SECTIONS] },
    notes: { type: String, default: '' },
    snapshot: { type: Schema.Types.Mixed, default: null },
    generatedAt: { type: Date, default: null },
    status: { type: String, enum: ['draft', 'shared'], default: 'draft' },
    sharedAt: { type: Date, default: null },
    sharedBy: { id: Schema.Types.ObjectId, name: String },
    createdBy: { id: Schema.Types.ObjectId, name: String },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
)

reportSchema.index({ client: 1, status: 1, createdAt: -1 })

export type Report = InferSchemaType<typeof reportSchema>
export const ReportModel = model('Report', reportSchema)
