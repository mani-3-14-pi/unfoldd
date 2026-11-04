import type { Types } from 'mongoose'
import { BannerModel } from './banner.model.ts'

/**
 * D52: automatic banners from events. Unique per `autoKey`, so a repeated event updates the same banner
 * instead of adding another. Published straight away; they end on their own date or when `endAutoBanner` runs.
 */
export async function upsertAutoBanner(input: {
  agency: Types.ObjectId
  client: Types.ObjectId
  key: string
  headline: string
  text: string
  cta: { label: string; link: string }
  endAt?: Date | null
}) {
  const now = new Date()
  return BannerModel.findOneAndUpdate(
    { autoKey: input.key },
    {
      $set: { headline: input.headline, text: input.text, cta: input.cta, endAt: input.endAt ?? null, endedAt: null, publishedAt: now, deletedAt: null },
      $setOnInsert: { agency: input.agency, client: input.client, source: 'auto', autoKey: input.key, startAt: now, order: -1 },
    },
    { upsert: true, returnDocument: 'after' },
  )
}

export const endAutoBanner = (key: string) => BannerModel.updateOne({ autoKey: key, endedAt: null }, { $set: { endedAt: new Date() } })
