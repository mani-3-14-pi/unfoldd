import { Schema, model, type InferSchemaType } from 'mongoose'

/**
 * A support ticket to the Unfoldd team (P161–P163, F74, D67 "Report issue"). Raised by agency or client people,
 * answered by platform admins. Agencies never see client people's tickets and vice versa.
 */
export const TICKET_STATUSES = ['open', 'in_progress', 'waiting_on_user', 'resolved'] as const
export const TICKET_CATEGORIES = ['bug', 'question', 'account', 'billing', 'feature_request', 'other'] as const

const ticketSchema = new Schema(
  {
    agency: { type: Schema.Types.ObjectId, ref: 'Agency', default: null },
    client: { type: Schema.Types.ObjectId, ref: 'Client', default: null },
    user: { id: { type: Schema.Types.ObjectId, ref: 'User', required: true }, name: String, email: String, side: { type: String, enum: ['agency', 'client'] } },
    category: { type: String, enum: TICKET_CATEGORIES, default: 'question' },
    subject: { type: String, required: true, trim: true },
    /** Where it happened: the page and entity, filled by the app. */
    context: { url: { type: String, default: '' }, entityType: { type: String, default: '' }, entityId: { type: String, default: '' }, userAgent: { type: String, default: '' } },
    status: { type: String, enum: TICKET_STATUSES, default: 'open' },
    messages: {
      type: [
        new Schema(
          {
            from: { type: String, enum: ['user', 'support'], required: true },
            author: { id: Schema.Types.ObjectId, name: String },
            body: { type: String, required: true },
            at: { type: Date, default: Date.now },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    lastMessageAt: { type: Date, default: Date.now },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true },
)

ticketSchema.index({ status: 1, lastMessageAt: -1 })
ticketSchema.index({ 'user.id': 1, createdAt: -1 })

export type SupportTicket = InferSchemaType<typeof ticketSchema>
export const SupportTicketModel = model('SupportTicket', ticketSchema)
