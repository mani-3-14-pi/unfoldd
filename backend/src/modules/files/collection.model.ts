import { Schema, model, type InferSchemaType } from 'mongoose'
import { softDeleteFields } from '../../lib/concurrency.ts'

/** P30: a named group of library files for one client ("Diwali shoot", "Logos"). A file is in at most one. */
const collectionSchema = new Schema(
  {
    agency: { type: Schema.Types.ObjectId, ref: 'Agency', required: true },
    client: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    /** `internal` collections are agency-only; their files stay hidden from the client even if shared. */
    visibility: { type: String, enum: ['internal', 'client'], default: 'client' },
    createdBy: { id: Schema.Types.ObjectId, name: String },
    ...softDeleteFields,
  },
  { timestamps: true },
)

collectionSchema.index({ client: 1, deletedAt: 1, name: 1 })

export type FileCollection = InferSchemaType<typeof collectionSchema>
export const FileCollectionModel = model('FileCollection', collectionSchema)
