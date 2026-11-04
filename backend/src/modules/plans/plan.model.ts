import { Schema, model, type InferSchemaType } from 'mongoose'
import type { Transition } from '../../lib/concurrency.ts'

/** §6.4: draft → sent → approved | changes_requested → (edit) → sent … */
export const PLAN_STATUSES = ['draft', 'sent', 'approved', 'changes_requested'] as const
export type PlanStatus = (typeof PLAN_STATUSES)[number]

export const PLAN_TRANSITIONS = {
  send: { from: ['draft', 'changes_requested'], to: 'sent' },
  approve: { from: ['sent'], to: 'approved' },
  requestChanges: { from: ['sent'], to: 'changes_requested' },
} as const satisfies Record<string, Transition<PlanStatus>>

/**
 * One content plan per client per month (F46, P37). Its items ARE content rows in `planned` state that point
 * at the plan (D33): there's no copy to keep in sync. Approval is a checkpoint, not a gate (D34): items changed
 * after approval are flagged "updated since approval" and the client is told, but the approval stays.
 */
const planSchema = new Schema(
  {
    agency: { type: Schema.Types.ObjectId, ref: 'Agency', required: true },
    client: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    /** `YYYY-MM`, in the client's timezone. */
    month: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
    status: { type: String, enum: PLAN_STATUSES, default: 'draft' },
    statusChangedAt: { type: Date, default: Date.now },
    note: { type: String, default: '' },
    sentAt: { type: Date, default: null },
    sentBy: { id: Schema.Types.ObjectId, name: String },
    decidedAt: { type: Date, default: null },
    decidedBy: { id: Schema.Types.ObjectId, name: String },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
)

planSchema.index({ client: 1, month: 1 }, { unique: true })
planSchema.index({ agency: 1, status: 1 })

export type ContentPlan = InferSchemaType<typeof planSchema>
export const ContentPlanModel = model('ContentPlan', planSchema)
