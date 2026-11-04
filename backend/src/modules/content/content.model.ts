import { Schema, model, type InferSchemaType } from 'mongoose'
import { revFields, softDeleteFields, type Transition } from '../../lib/concurrency.ts'

/** §6.1: the one canonical content state machine (D01). Every other status anywhere is derived from it. */
export const CONTENT_STATES = [
  'planned',
  'in_production',
  'internal_review',
  'ready_for_client',
  'client_review',
  'changes_requested',
  'approved',
  'scheduled',
  'publishing',
  'published',
  'cancelled',
] as const
export type ContentState = (typeof CONTENT_STATES)[number]

/** Every allowed move. A transition is one conditional update; anything else is a 409 with the current state. */
export const CONTENT_TRANSITIONS = {
  startProduction: { from: ['planned'], to: 'in_production' },
  submitToInternal: { from: ['in_production'], to: 'internal_review' },
  submitToReady: { from: ['in_production'], to: 'ready_for_client' },
  internalRequestChanges: { from: ['internal_review'], to: 'in_production' },
  internalApprove: { from: ['internal_review'], to: 'ready_for_client' },
  internalApproveAndSend: { from: ['internal_review'], to: 'client_review' },
  /** Send now / at send_at, or re-send the same version with a reply (Flow 7, step 6). */
  send: { from: ['ready_for_client', 'changes_requested'], to: 'client_review' },
  continueEditing: { from: ['ready_for_client'], to: 'in_production' },
  /** From changes_requested too: another approver may overrule (D07). */
  approve: { from: ['client_review', 'changes_requested'], to: 'approved' },
  requestChanges: { from: ['client_review'], to: 'changes_requested' },
  /** D08: until publishing starts. */
  pullApproval: { from: ['approved', 'scheduled'], to: 'changes_requested' },
  schedule: { from: ['approved'], to: 'scheduled' },
  unschedule: { from: ['scheduled'], to: 'approved' },
  /** D78: the publish job's lock, claimed before calling the platform. */
  claimPublishing: { from: ['scheduled'], to: 'publishing' },
  publishFailed: { from: ['publishing'], to: 'scheduled' },
  /** D26: manual accounts are marked by hand from approved or scheduled; a job confirms from publishing. */
  markPublished: { from: ['approved', 'scheduled', 'publishing'], to: 'published' },
  /** D76: one rule for every new version. */
  newVersion: {
    from: ['planned', 'in_production', 'internal_review', 'ready_for_client', 'client_review', 'changes_requested', 'approved', 'scheduled'],
    to: 'in_production',
  },
  /** D77 */
  cancel: {
    from: ['planned', 'in_production', 'internal_review', 'ready_for_client', 'client_review', 'changes_requested', 'approved', 'scheduled'],
    to: 'cancelled',
  },
} as const satisfies Record<string, Transition<ContentState>>

export const PLATFORMS = ['instagram', 'facebook', 'linkedin', 'youtube', 'tiktok', 'x', 'pinterest', 'website', 'other'] as const
export const FORMATS = ['feed_4x5', 'square_1x1', 'story_9x16', 'landscape_16x9', 'carousel', 'video', 'reel', 'linkedin', 'other'] as const
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const

/** One piece of content for one client: an Instagram carousel, a reel, a LinkedIn post … */
const contentSchema = new Schema(
  {
    agency: { type: Schema.Types.ObjectId, ref: 'Agency', required: true },
    client: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    campaign: { type: Schema.Types.ObjectId, ref: 'Campaign', default: null },
    plan: { type: Schema.Types.ObjectId, ref: 'ContentPlan', default: null },

    title: { type: String, required: true, trim: true },
    platform: { type: String, enum: PLATFORMS, required: true },
    format: { type: String, enum: FORMATS, required: true },
    idea: { type: String, default: '' },
    concept: { type: String, default: '' },
    objective: { type: String, default: '' },
    brief: { type: String, default: '' },
    owner: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    collaborators: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
    /** D46: besides Manager+, the one person who may do internal review. */
    reviewer: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    priority: { type: String, enum: PRIORITIES, default: 'normal' },
    /** Production deadline: a date-only string in the client's timezone. */
    due: { type: String, default: '' },
    /** D28: the target publish time (UTC) for the whole life of the item. Scheduling writes it; the job reads it. */
    publishDate: { type: Date, default: null },
    /** "Send later" (P52): the send job moves ready_for_client → client_review at this time. */
    sendAt: { type: Date, default: null },
    /** Per-content override of the client's `contract.revisionsIncluded`. */
    revisionLimit: { type: Number, default: null, min: 0 },

    state: { type: String, enum: CONTENT_STATES, default: 'in_production' },
    stateChangedAt: { type: Date, default: Date.now },
    currentVersion: { type: Schema.Types.ObjectId, ref: 'Version', default: null },
    /** D05: only this version can be published. Cleared by a new version or a pulled approval. */
    approvedVersion: { type: Schema.Types.ObjectId, ref: 'Version', default: null },
    approvedAt: { type: Date, default: null },
    approvedBy: { id: Schema.Types.ObjectId, name: String },
    /** D64: the client sees the content only once it has been sent at least once (or its plan was sent). */
    clientVisibleAt: { type: Date, default: null },

    externalPostId: { type: String, default: '' },
    externalUrl: { type: String, default: '' },
    publishedAt: { type: Date, default: null },
    publishedBy: { id: Schema.Types.ObjectId, name: String },

    /** The publish date as the client first saw it. "Schedule shifted · N days" is derived from it (D29). */
    sharedPublishDate: { type: Date, default: null },
    /** D34: last change to a plan item's plan fields. After the plan's approval it shows "updated since approval". */
    planEditedAt: { type: Date, default: null },
    template: { type: Schema.Types.ObjectId, ref: 'Template', default: null },

    /** D30: set once the missed-slot alert has gone out for the current publish date. */
    missedSlotAlertedFor: { type: Date, default: null },

    /** Counters the server increments: version numbers (D60) and pin numbers per visibility (D75). */
    counters: {
      version: { type: Number, default: 0 },
      clientPin: { type: Number, default: 0 },
      internalPin: { type: Number, default: 0 },
    },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    ...revFields,
    ...softDeleteFields,
  },
  { timestamps: true },
)

contentSchema.index({ agency: 1, client: 1, state: 1, deletedAt: 1 })
contentSchema.index({ agency: 1, state: 1, publishDate: 1 })
contentSchema.index({ state: 1, sendAt: 1 })
contentSchema.index({ client: 1, clientVisibleAt: 1, deletedAt: 1 })

export type Content = InferSchemaType<typeof contentSchema>
export const ContentModel = model('Content', contentSchema)
