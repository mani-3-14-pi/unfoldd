import { Schema, model, type InferSchemaType } from 'mongoose'
import { revFields, softDeleteFields } from '../../lib/concurrency.ts'

/**
 * D42: personality axes are data, not fixed fields. Each is a continuous 0–100 slider between two poles;
 * the preview labels it by the pole it leans toward. Changing this list is a content decision (§14.4).
 */
export const PERSONALITY_AXES = [
  { key: 'playful_serious', left: 'Playful', right: 'Serious' },
  { key: 'modern_classic', left: 'Modern', right: 'Classic' },
  { key: 'bold_subtle', left: 'Bold', right: 'Subtle' },
  { key: 'luxury_accessible', left: 'Luxury', right: 'Accessible' },
] as const

/** F05/F06 style tags for likes and dislikes. */
export const STYLE_TAGS = ['minimal', 'luxury', 'modern', 'editorial', 'playful', 'bold', 'natural', 'warm', 'vintage', 'clean', 'artistic', 'other'] as const

/**
 * Brand DNA sections. The first five are the client's own answers (onboarding and later edits); the last four
 * are the agency's professional layer, built from those answers (D82). Each section has its own `rev`, so two
 * people editing different sections never conflict, and the same section gives "updated by X — reload" (D41).
 */
export const CLIENT_SECTIONS = ['intro', 'personality', 'likes', 'dislikes'] as const
export const AGENCY_SECTIONS = ['audience', 'positioning', 'tone', 'visualIdentity'] as const
export const BRAND_SECTIONS = [...CLIENT_SECTIONS, ...AGENCY_SECTIONS] as const
export type BrandSection = (typeof BRAND_SECTIONS)[number]

/** D72: six equal-weight onboarding sections, always in this order. Each completes when the client taps Done. */
export const ONBOARDING_STEPS = ['intro', 'personality', 'likes', 'dislikes', 'references', 'assets'] as const
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]

const sectionSchema = new Schema(
  {
    data: { type: Schema.Types.Mixed, default: {} },
    rev: { type: Number, default: 1 },
    updatedBy: { id: Schema.Types.ObjectId, name: String, side: String },
    updatedAt: Date,
  },
  { _id: false },
)

const sections = Object.fromEntries(BRAND_SECTIONS.map((s) => [s, { type: sectionSchema, default: () => ({}) }]))
const onboarding = Object.fromEntries(ONBOARDING_STEPS.map((s) => [s, { type: Date, default: null }]))

/** One Brand DNA per client (F09, P21). */
const brandDnaSchema = new Schema(
  {
    agency: { type: Schema.Types.ObjectId, ref: 'Agency', required: true },
    client: { type: Schema.Types.ObjectId, ref: 'Client', required: true, unique: true },
    sections,
    /** When each onboarding step was marked done. Onboarding % = done ÷ 6 (derived). */
    onboarding,
    onboardingCompletedAt: { type: Date, default: null },
  },
  { timestamps: true },
)

export type BrandDna = InferSchemaType<typeof brandDnaSchema>
export const BrandDnaModel = model('BrandDna', brandDnaSchema)

/** D40: likes, dislikes and references are one object with a `sentiment`. An image (≤10 MB) or a link. */
const brandReferenceSchema = new Schema(
  {
    agency: { type: Schema.Types.ObjectId, ref: 'Agency', required: true },
    client: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    sentiment: { type: String, enum: ['like', 'dislike', 'neutral'], required: true },
    image: { type: Schema.Types.ObjectId, ref: 'File', default: null },
    link: { type: String, default: '' },
    note: { type: String, default: '', maxlength: 200 },
    category: { type: String, default: '' },
    addedBy: { id: Schema.Types.ObjectId, name: String, side: { type: String, enum: ['agency', 'client'] } },
    ...softDeleteFields,
  },
  { timestamps: true },
)

brandReferenceSchema.index({ client: 1, sentiment: 1, deletedAt: 1, createdAt: -1 })

export type BrandReference = InferSchemaType<typeof brandReferenceSchema>
export const BrandReferenceModel = model('BrandReference', brandReferenceSchema)

/** P25: the agency's internal creative rules for a client. Never visible to the client. */
const creativeGuidelinesSchema = new Schema(
  {
    agency: { type: Schema.Types.ObjectId, ref: 'Agency', required: true },
    client: { type: Schema.Types.ObjectId, ref: 'Client', required: true, unique: true },
    dos: { type: [String], default: [] },
    donts: { type: [String], default: [] },
    tone: { type: String, default: '' },
    visualDirection: { type: String, default: '' },
    contentRules: { type: String, default: '' },
    /** Per platform, e.g. { instagram: "Max 3 hashtags" }. */
    platformRules: { type: Map, of: String, default: {} },
    ...revFields,
  },
  { timestamps: true },
)

export type CreativeGuidelines = InferSchemaType<typeof creativeGuidelinesSchema>
export const CreativeGuidelinesModel = model('CreativeGuidelines', creativeGuidelinesSchema)
