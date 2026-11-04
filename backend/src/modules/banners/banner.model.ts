import { Schema, model, type InferSchemaType } from 'mongoose'
import { revFields, softDeleteFields } from '../../lib/concurrency.ts'

/**
 * A banner on the client's Home (F12/F13, D52). §6.11: draft → live → ended, where live/ended come from the
 * start/end dates (derived), and an agency can end one by hand. Auto banners are created by events (plan sent)
 * and are unique per `autoKey`, so a repeated event never duplicates them.
 */
const bannerSchema = new Schema(
  {
    agency: { type: Schema.Types.ObjectId, ref: 'Agency', required: true },
    client: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    image: { type: Schema.Types.ObjectId, ref: 'File', default: null },
    headline: { type: String, required: true, trim: true },
    text: { type: String, default: '' },
    /** A deep link inside the Client App (`/c/...`), opened by the CTA. */
    cta: { label: { type: String, default: '' }, link: { type: String, default: '' } },
    startAt: { type: Date, default: null },
    endAt: { type: Date, default: null },
    order: { type: Number, default: 0 },
    source: { type: String, enum: ['manual', 'auto'], default: 'manual' },
    autoKey: { type: String, default: null },
    publishedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    createdBy: { id: Schema.Types.ObjectId, name: String },
    ...revFields,
    ...softDeleteFields,
  },
  { timestamps: true },
)

bannerSchema.index({ client: 1, publishedAt: 1, endedAt: 1, deletedAt: 1, order: 1 })
bannerSchema.index({ autoKey: 1 }, { unique: true, partialFilterExpression: { autoKey: { $type: 'string' } } })

export type Banner = InferSchemaType<typeof bannerSchema>
export const BannerModel = model('Banner', bannerSchema)

export type BannerState = 'draft' | 'scheduled' | 'live' | 'ended'

/** Derived, never stored (rule §12.12). */
export function bannerState(b: { publishedAt?: Date | null; endedAt?: Date | null; startAt?: Date | null; endAt?: Date | null }, now = Date.now()): BannerState {
  if (!b.publishedAt) return 'draft'
  if (b.endedAt || (b.endAt && b.endAt.getTime() <= now)) return 'ended'
  if (b.startAt && b.startAt.getTime() > now) return 'scheduled'
  return 'live'
}

/** Mongo filter for banners live at `now`. */
export const liveFilter = (now = new Date()) => ({
  publishedAt: { $ne: null },
  endedAt: null,
  deletedAt: null,
  $and: [{ $or: [{ startAt: null }, { startAt: { $lte: now } }] }, { $or: [{ endAt: null }, { endAt: { $gt: now } }] }],
})
