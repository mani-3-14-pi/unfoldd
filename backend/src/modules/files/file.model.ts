import { Schema, model, type InferSchemaType } from 'mongoose'
import { softDeleteFields } from '../../lib/concurrency.ts'
import { VISIBILITIES } from '../activity/activity.model.ts'

/** F87/P167: uploading → processing → ready | failed. */
export const FILE_STATUSES = ['uploading', 'processing', 'ready', 'failed'] as const

/** The resource-library categories (D39). */
export const FILE_CATEGORIES = ['brand', 'photography', 'video', 'documents', 'fonts', 'product', 'existing_creatives', 'other'] as const

/**
 * What a file is for. `library` files are the client's resource library. `version` files belong to a content
 * version: never in the library or client search, and visible to the client only through a sent version.
 * `logo` is an agency or client logo. `request` is an upload to a request (it also lands in the library, D36).
 * `attachment` is a voice note, attachment or annotation snapshot on a message.
 */
export const FILE_PURPOSES = ['library', 'version', 'logo', 'request', 'attachment'] as const

/** One stored object in R2 (D39). Never hard-deleted while something uses it (rule §12.6). */
const fileSchema = new Schema(
  {
    agency: { type: Schema.Types.ObjectId, ref: 'Agency', required: true },
    client: { type: Schema.Types.ObjectId, ref: 'Client', default: null },
    purpose: { type: String, enum: FILE_PURPOSES, default: 'library' },
    name: { type: String, required: true, trim: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true, min: 0 },
    /** Object key in the bucket. Never sent to clients. */
    key: { type: String, required: true, unique: true },
    status: { type: String, enum: FILE_STATUSES, default: 'uploading' },
    error: { type: String, default: '' },
    category: { type: String, enum: FILE_CATEGORIES, default: 'other' },
    collectionId: { type: Schema.Types.ObjectId, default: null },
    visibility: { type: String, enum: VISIBILITIES.filter((v) => v !== 'platform'), default: 'internal' },
    uploadedBy: { id: { type: Schema.Types.ObjectId, ref: 'User' }, name: String, side: { type: String, enum: ['agency', 'client'] } },
    /** "Used in" links. A file with any `version` link can't be hard-deleted. */
    usedIn: { type: [new Schema({ type: String, id: Schema.Types.ObjectId }, { _id: false })], default: [] },
    ...softDeleteFields,
  },
  { timestamps: true },
)

fileSchema.index({ agency: 1, client: 1, purpose: 1, deletedAt: 1, createdAt: -1 })
fileSchema.index({ status: 1, createdAt: 1 })

export type StoredFile = InferSchemaType<typeof fileSchema>
export const FileModel = model('File', fileSchema)
