import { Schema, model, type InferSchemaType } from 'mongoose'

/** Preference categories (D68). Invites and security alerts can't be switched off. */
export const NOTIFICATION_CATEGORIES = ['invites', 'security', 'team', 'clients', 'reviews', 'feedback', 'requests', 'meetings', 'publishing'] as const
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number]
export const MANDATORY_CATEGORIES: readonly NotificationCategory[] = ['invites', 'security']
export const CHANNELS = ['email', 'push'] as const

/** One item in a person's notification centre. In-app is always on; email and push depend on preferences. */
const notificationSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  agency: { type: Schema.Types.ObjectId, ref: 'Agency' },
  client: { type: Schema.Types.ObjectId, ref: 'Client' },
  /** Which app the deep link opens in. */
  audience: { type: String, enum: ['agency', 'client'], required: true },
  category: { type: String, enum: NOTIFICATION_CATEGORIES, required: true },
  /** The event action, e.g. `invitation.reinvite_requested`. */
  event: { type: String, required: true },
  title: { type: String, required: true },
  body: { type: String, default: '' },
  /** D51: the deep link opens the entity's current state, never a stale copy. */
  entity: { type: { type: String }, id: Schema.Types.ObjectId },
  link: { type: String, default: '' },
  urgent: { type: Boolean, default: false },
  /** The event-log entry this came from. */
  activity: { type: Schema.Types.ObjectId, ref: 'Activity' },
  readAt: { type: Date, default: null },
  /** Email delivery: sent now (urgent), or waiting for the digest. */
  email: { type: String, enum: ['none', 'sent', 'digest_pending', 'digest_sent'], default: 'none' },
  push: { type: String, enum: ['none', 'pending', 'sent'], default: 'none' },
  createdAt: { type: Date, default: Date.now },
})

notificationSchema.index({ user: 1, audience: 1, readAt: 1, createdAt: -1 })
notificationSchema.index({ email: 1, createdAt: 1 })

export type Notification = InferSchemaType<typeof notificationSchema>
export const NotificationModel = model('Notification', notificationSchema)
