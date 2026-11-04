import { Schema, model, type InferSchemaType } from 'mongoose'

/**
 * One message in a thread. The first message of a feedback item is its comment. Voice notes keep the audio as
 * the source of truth; the transcript is filled in later by a background job and labelled "Auto-transcript" (D22).
 * Visibility is copied from the thread, so a message can't be more visible than its thread.
 */
const messageSchema = new Schema(
  {
    agency: { type: Schema.Types.ObjectId, ref: 'Agency', required: true },
    client: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    thread: { type: Schema.Types.ObjectId, ref: 'Thread', required: true },
    visibility: { type: String, enum: ['internal', 'client'], required: true },
    author: { id: { type: Schema.Types.ObjectId, ref: 'User' }, name: String, side: { type: String, enum: ['agency', 'client'] } },
    body: { type: String, default: '' },
    voice: {
      file: { type: Schema.Types.ObjectId, ref: 'File', default: null },
      durationMs: Number,
      transcript: { type: String, default: '' },
      transcriptStatus: { type: String, enum: ['none', 'pending', 'done', 'failed'], default: 'none' },
    },
    attachments: { type: [{ type: Schema.Types.ObjectId, ref: 'File' }], default: [] },
    mentions: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
    /** Mirrors the thread's draft state: null while the thread is a pending draft. */
    submittedAt: { type: Date, default: null },
    editedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
)

messageSchema.index({ thread: 1, createdAt: 1 })
messageSchema.index({ 'voice.transcriptStatus': 1 })

export type Message = InferSchemaType<typeof messageSchema>
export const MessageModel = model('Message', messageSchema)
