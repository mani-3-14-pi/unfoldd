import { Schema, model, type InferSchemaType } from 'mongoose'

/**
 * One file inside a version, in order (slides of a carousel, the video …). Feedback anchors point at this
 * subdocument's `_id`, never at a slide index, so reordering can't misplace them (D11, D75).
 */
const versionFileSchema = new Schema({
  file: { type: Schema.Types.ObjectId, ref: 'File', required: true },
  width: Number,
  height: Number,
  durationMs: Number,
})

/**
 * A version of a content item: V01, V02 … Numbers are assigned by the server, unique per content (D60).
 * Caption and hashtags are part of the version, so the client approves them with the creative (D06).
 * A version is editable only until it is first submitted; after that a change is a new version.
 */
const versionSchema = new Schema(
  {
    agency: { type: Schema.Types.ObjectId, ref: 'Agency', required: true },
    client: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    content: { type: Schema.Types.ObjectId, ref: 'Content', required: true },
    number: { type: Number, required: true, min: 1 },
    files: { type: [versionFileSchema], default: [] },
    caption: { type: String, default: '' },
    hashtags: { type: [String], default: [] },
    changeNote: { type: String, default: '' },
    createdBy: { id: { type: Schema.Types.ObjectId, ref: 'User' }, name: String },
    /** Set at the first submit; from then on the version is read-only. */
    lockedAt: { type: Date, default: null },
    sentToClientAt: { type: Date, default: null },
    /** D04: only an Admin or Approver opening it counts. */
    firstViewedAt: { type: Date, default: null },
    firstViewedBy: { id: Schema.Types.ObjectId, name: String },
    /** Set when a newer version replaced this one while the client was reviewing it. */
    withdrawnAt: { type: Date, default: null },
  },
  { timestamps: true },
)

versionSchema.index({ content: 1, number: 1 }, { unique: true })
versionSchema.index({ client: 1, sentToClientAt: 1 })

export type Version = InferSchemaType<typeof versionSchema>
export const VersionModel = model('Version', versionSchema)

/** "V03" */
export const versionLabel = (n: number) => `V${String(n).padStart(2, '0')}`
