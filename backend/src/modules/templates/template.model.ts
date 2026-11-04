import { Schema, model, type InferSchemaType } from 'mongoose'
import { revFields, softDeleteFields } from '../../lib/concurrency.ts'

/** P140–P144. Templates only prefill fields and generate production task lists (D55). */
export const TEMPLATE_TYPES = ['content', 'campaign', 'task_list', 'request'] as const
export type TemplateType = (typeof TEMPLATE_TYPES)[number]

/**
 * An agency's reusable starting point. The body is validated per type (template.schemas.ts). It can never hold
 * a status or a review/approve/schedule/publish step: the state machine is fixed (D55).
 */
const templateSchema = new Schema(
  {
    agency: { type: Schema.Types.ObjectId, ref: 'Agency', required: true },
    type: { type: String, enum: TEMPLATE_TYPES, required: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    body: { type: Schema.Types.Mixed, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    ...revFields,
    ...softDeleteFields,
  },
  { timestamps: true },
)

templateSchema.index({ agency: 1, type: 1, deletedAt: 1, name: 1 })

export type Template = InferSchemaType<typeof templateSchema>
export const TemplateModel = model('Template', templateSchema)
