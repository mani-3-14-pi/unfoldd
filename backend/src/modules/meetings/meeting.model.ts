import { Schema, model, type InferSchemaType } from 'mongoose'
import { revFields, softDeleteFields, type Transition } from '../../lib/concurrency.ts'

/** §6.9: scheduled → completed | cancelled. The summary has its own draft → shared flag. */
export const MEETING_STATUSES = ['scheduled', 'completed', 'cancelled'] as const
export type MeetingStatus = (typeof MEETING_STATUSES)[number]

export const MEETING_TRANSITIONS = {
  complete: { from: ['scheduled'], to: 'completed' },
  cancel: { from: ['scheduled'], to: 'cancelled' },
} as const satisfies Record<string, Transition<MeetingStatus>>

export const MEETING_PLATFORMS = ['google_meet', 'zoom', 'teams', 'phone', 'in_person', 'other'] as const

/**
 * D24: on share, an agency action item becomes a Task, a client one becomes a Request. The created id is kept
 * on the item, so sharing twice never duplicates.
 */
const actionItemSchema = new Schema({
  text: { type: String, required: true },
  side: { type: String, enum: ['agency', 'client'], required: true },
  assignee: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  due: { type: String, default: '' },
  task: { type: Schema.Types.ObjectId, ref: 'Task', default: null },
  request: { type: Schema.Types.ObjectId, ref: 'Request', default: null },
})

/**
 * A meeting with a client (F57–F62, P103–P109). The transcript is agency-only (D23); the client sees the
 * summary, decisions and action items only after the agency shares them.
 */
const meetingSchema = new Schema(
  {
    agency: { type: Schema.Types.ObjectId, ref: 'Agency', required: true },
    client: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    title: { type: String, required: true, trim: true },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    platform: { type: String, enum: MEETING_PLATFORMS, default: 'google_meet' },
    /** Pasted by hand in v1 (D66). */
    joinUrl: { type: String, default: '' },
    location: { type: String, default: '' },
    agenda: { type: String, default: '' },
    participants: {
      agency: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
      client: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
    },
    campaign: { type: Schema.Types.ObjectId, ref: 'Campaign', default: null },
    content: { type: [{ type: Schema.Types.ObjectId, ref: 'Content' }], default: [] },
    status: { type: String, enum: MEETING_STATUSES, default: 'scheduled' },
    /** Internal only (D23). */
    transcript: { type: String, default: '' },
    summary: {
      text: { type: String, default: '' },
      decisions: { type: [String], default: [] },
      actionItems: { type: [actionItemSchema], default: [] },
      status: { type: String, enum: ['draft', 'shared'], default: 'draft' },
      sharedAt: { type: Date, default: null },
      sharedBy: { id: Schema.Types.ObjectId, name: String },
    },
    /** "Meeting in 15 min" was sent (D68). */
    reminderSentAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    ...revFields,
    ...softDeleteFields,
  },
  { timestamps: true },
)

meetingSchema.index({ agency: 1, client: 1, startAt: 1, deletedAt: 1 })
meetingSchema.index({ status: 1, startAt: 1, reminderSentAt: 1 })

export type Meeting = InferSchemaType<typeof meetingSchema>
export const MeetingModel = model('Meeting', meetingSchema)
