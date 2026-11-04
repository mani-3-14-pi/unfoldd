import { Schema, model, type InferSchemaType } from 'mongoose'

/** Platform-wide settings: a single document with key "platform". */
const settingsSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: 'platform' },
    signups: {
      /** Whether the public agency signup form accepts new agencies at all. */
      enabled: { type: Boolean, default: true },
      /** Approve new agencies immediately instead of queueing them for a platform admin. */
      autoApprove: { type: Boolean, default: false },
    },
    /** How long a platform admin's support session in an agency portal lasts. */
    supportSessionMinutes: { type: Number, default: 60, min: 5, max: 480 },
  },
  { timestamps: true },
)

export type PlatformSettings = InferSchemaType<typeof settingsSchema>
export const SettingsModel = model('Settings', settingsSchema)

export async function getSettings() {
  const s = await SettingsModel.findOneAndUpdate(
    { key: 'platform' },
    { $setOnInsert: { key: 'platform' } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  ).lean()
  return {
    signups: { enabled: s?.signups?.enabled ?? true, autoApprove: s?.signups?.autoApprove ?? false },
    supportSessionMinutes: s?.supportSessionMinutes ?? 60,
    updatedAt: s?.updatedAt,
  }
}
