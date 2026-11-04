import { Schema, model, type InferSchemaType } from 'mongoose'
import { revFields, softDeleteFields, type Transition } from '../../lib/concurrency.ts'
import { PRIORITIES } from '../content/content.model.ts'
import { FILE_CATEGORIES } from '../files/file.model.ts'

/** §6.6 / D35: draft → open → submitted → completed, with submitted → open ("need something else") and → cancelled. */
export const REQUEST_STATUSES = ['draft', 'open', 'submitted', 'completed', 'cancelled'] as const
export type RequestStatus = (typeof REQUEST_STATUSES)[number]
/** A task waiting on a request is released by any end state (D38). */
export const REQUEST_END_STATES: readonly RequestStatus[] = ['completed', 'cancelled']

export const REQUEST_TRANSITIONS = {
  publish: { from: ['draft'], to: 'open' },
  submit: { from: ['open'], to: 'submitted' },
  complete: { from: ['submitted'], to: 'completed' },
  reopen: { from: ['submitted'], to: 'open' },
  cancel: { from: ['draft', 'open', 'submitted'], to: 'cancelled' },
} as const satisfies Record<string, Transition<RequestStatus>>

/** Where a request came from: by hand, a Brand DNA "request update", an onboarding asset ask, or a meeting. */
export const REQUEST_SOURCES = ['manual', 'brand_dna', 'asset', 'meeting', 'template'] as const

/**
 * Needed From You (F53–F56, P90–P93): something the agency needs from the client. Uploads land in the client's
 * resource library under `uploadCategory`, linked back here (D36). Once submitted, files are read-only for the
 * client; a reopened request only takes more files (§6.6).
 */
const requestSchema = new Schema(
  {
    agency: { type: Schema.Types.ObjectId, ref: 'Agency', required: true },
    client: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    campaign: { type: Schema.Types.ObjectId, ref: 'Campaign', default: null },
    content: { type: Schema.Types.ObjectId, ref: 'Content', default: null },
    source: { type: String, enum: REQUEST_SOURCES, default: 'manual' },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    /** Why the agency needs it, shown to the client. */
    why: { type: String, default: '' },
    /** Date-only, in the client's timezone. Overdue = due < today and still open (derived). */
    due: { type: String, default: '' },
    priority: { type: String, enum: PRIORITIES, default: 'normal' },
    uploadCategory: { type: String, enum: FILE_CATEGORIES, default: 'other' },
    status: { type: String, enum: REQUEST_STATUSES, default: 'draft' },
    statusChangedAt: { type: Date, default: Date.now },
    files: {
      type: [
        new Schema(
          {
            file: { type: Schema.Types.ObjectId, ref: 'File', required: true },
            addedBy: { id: Schema.Types.ObjectId, name: String },
            addedAt: { type: Date, default: Date.now },
            /** Set on submit; from then on the client can't remove it. */
            submittedAt: { type: Date, default: null },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    /** The client's answer when they submit. */
    response: { type: String, default: '' },
    /** The agency's note when it asks for something else. */
    returnNote: { type: String, default: '' },
    viewedAt: { type: Date, default: null },
    submittedAt: { type: Date, default: null },
    submittedBy: { id: Schema.Types.ObjectId, name: String },
    completedAt: { type: Date, default: null },
    template: { type: Schema.Types.ObjectId, ref: 'Template', default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    ...revFields,
    ...softDeleteFields,
  },
  { timestamps: true },
)

requestSchema.index({ agency: 1, client: 1, status: 1, deletedAt: 1 })
requestSchema.index({ client: 1, status: 1, due: 1 })

export type ClientRequest = InferSchemaType<typeof requestSchema>
export const RequestModel = model('Request', requestSchema)
