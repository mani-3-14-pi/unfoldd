import { Router, type Request } from 'express'
import type { Types } from 'mongoose'
import { z } from 'zod'
import { logActivity } from '../../lib/activity.ts'
import { updateWithRev } from '../../lib/concurrency.ts'
import { objectId } from '../../lib/ids.ts'
import { notify } from '../../lib/notify.ts'
import { pageQuery, paginate } from '../../lib/pagination.ts'
import { clientCan, currentUser, loadClient } from '../../lib/scope.ts'
import { presignDownload, storageConfigured } from '../../lib/storage.ts'
import { dateOnlySchema } from '../../lib/time.ts'
import { forbidden, invalid, notFound } from '../../utils/AppError.ts'
import { ActivityModel } from '../activity/activity.model.ts'
import { ClientModel } from '../clients/client.model.ts'
import { clientPeople } from '../content/content.recipients.ts'
import { FileModel } from '../files/file.model.ts'
import { RequestModel } from '../requests/request.model.ts'
import {
  AGENCY_SECTIONS,
  BRAND_SECTIONS,
  BrandReferenceModel,
  CLIENT_SECTIONS,
  CreativeGuidelinesModel,
  ONBOARDING_STEPS,
  PERSONALITY_AXES,
  STYLE_TAGS,
  type BrandSection,
} from './brand.model.ts'
import { brandFor, completeStep, onboardingProgress, saveSection } from './brand.service.ts'

/** Brand DNA, references and guidelines (Flow 3, P21–P26, F03–F10). Agency side mounts under /clients. */
export const brandRouter = Router()
export const clientBrandRouter = Router()

async function imageUrl(id: unknown) {
  if (!id || !storageConfigured()) return null
  const file = await FileModel.findOne({ _id: id, status: 'ready', deletedAt: null }).lean()
  return file ? (await presignDownload(file.key, file, { inline: true })).url : null
}

/**
 * The Brand DNA as one side sees it. Until the agency fills a professional section, the client sees their own
 * raw answers there (D82).
 */
async function presentBrand(client: { _id: Types.ObjectId; agency: Types.ObjectId }) {
  const brand = await brandFor(client)
  return {
    sections: brand.sections,
    onboarding: await onboardingProgress(brand),
    meta: { personalityAxes: PERSONALITY_AXES, styleTags: STYLE_TAGS, clientSections: CLIENT_SECTIONS, agencySections: AGENCY_SECTIONS },
  }
}

const sectionParam = (s: unknown) => {
  if (!(BRAND_SECTIONS as readonly unknown[]).includes(s)) throw notFound('Section not found.')
  return s as BrandSection
}

const saveSchema = z.object({ rev: z.number().int().min(1), data: z.unknown() })

// ── Agency ──────────────────────────────────────────────────────────────────

brandRouter.get('/:id/brand', async (req, res) => {
  const client = await loadClient(req, objectId(req.params.id, 'Client not found.'))
  res.json({ brand: await presentBrand(client) })
})

/** Manager+ edit any section, including the professional layer (D41, D82). */
brandRouter.put('/:id/brand/sections/:section', async (req, res) => {
  const { rev, data } = saveSchema.parse(req.body)
  const client = await loadClient(req, objectId(req.params.id, 'Client not found.'), 'manage')
  const brand = await saveSection(req, client, sectionParam(req.params.section), rev, data)
  res.json({ section: (brand.sections as any)[req.params.section] })
})

/** P24: change history, from the event log. */
brandRouter.get('/:id/brand/history', async (req, res) => {
  const client = await loadClient(req, objectId(req.params.id, 'Client not found.'))
  const f = z.object({ ...pageQuery, section: z.string().optional() }).parse(req.query)
  const filter: Record<string, unknown> = { client: client._id, action: 'brand.section_updated' }
  if (f.section) filter['meta.section'] = sectionParam(f.section)
  const page = await paginate(ActivityModel, filter, { page: f.page, pageSize: f.pageSize, sort: { createdAt: -1 } })
  res.json({ ...page, items: page.items.map(({ ip: _i, userAgent: _u, ...e }) => e) })
})

const updateRequestSchema = z.object({ section: z.enum(BRAND_SECTIONS), note: z.string().trim().min(1).max(2000), due: dateOnlySchema.optional() })

/** P23 "Request client update" = a Request linked to that section (Flow 3, step 7). */
brandRouter.post('/:id/brand/request-update', async (req, res) => {
  const input = updateRequestSchema.parse(req.body)
  const client = await loadClient(req, objectId(req.params.id, 'Client not found.'), 'manage')
  const me = req.agencyAuth!.user
  const r = await RequestModel.create({
    agency: client.agency,
    client: client._id,
    source: 'brand_dna',
    title: `Update your Brand DNA: ${input.section}`,
    description: input.note,
    due: input.due ?? '',
    status: 'open',
    createdBy: me._id,
    updatedBy: { id: me._id, name: me.name },
  })
  await notify({
    recipients: await clientPeople(client._id, ['admin', 'approver', 'contributor']),
    audience: 'client',
    agency: client.agency,
    client: client._id,
    category: 'requests',
    event: 'request.opened',
    title: `Needed from you: ${r.title}`,
    body: input.note,
    entity: { type: 'request', id: r._id },
    link: `/c/requests/${r._id}`,
    urgent: true,
  })
  res.status(201).json({ request: r })
})

const assetRequestSchema = z.object({ title: z.string().trim().min(1).max(200), description: z.string().max(2000).default(''), uploadCategory: z.enum(['brand', 'photography', 'video', 'documents', 'fonts', 'product', 'existing_creatives', 'other']).default('brand') })

/** Flow 3: specific asset asks for onboarding ("logo in SVG"). P16's "Assets — 2 remaining" counts these. */
brandRouter.post('/:id/brand/asset-requests', async (req, res) => {
  const input = assetRequestSchema.parse(req.body)
  const client = await loadClient(req, objectId(req.params.id, 'Client not found.'), 'manage')
  const me = req.agencyAuth!.user
  const r = await RequestModel.create({ ...input, agency: client.agency, client: client._id, source: 'asset', status: 'open', createdBy: me._id, updatedBy: { id: me._id, name: me.name } })
  res.status(201).json({ request: r })
})

// Guidelines (P25): agency-only.

brandRouter.get('/:id/guidelines', async (req, res) => {
  const client = await loadClient(req, objectId(req.params.id, 'Client not found.'))
  const g = await CreativeGuidelinesModel.findOneAndUpdate({ client: client._id }, { $setOnInsert: { agency: client.agency, client: client._id } }, { upsert: true, returnDocument: 'after' }).lean()
  res.json({ guidelines: g })
})

const guidelinesSchema = z.object({
  rev: z.number().int().min(1),
  dos: z.array(z.string().trim().min(1).max(300)).max(50).optional(),
  donts: z.array(z.string().trim().min(1).max(300)).max(50).optional(),
  tone: z.string().max(5000).optional(),
  visualDirection: z.string().max(5000).optional(),
  contentRules: z.string().max(5000).optional(),
  platformRules: z.record(z.string(), z.string().max(2000)).optional(),
})

brandRouter.put('/:id/guidelines', async (req, res) => {
  const { rev, ...rest } = guidelinesSchema.parse(req.body)
  const client = await loadClient(req, objectId(req.params.id, 'Client not found.'), 'manage')
  await CreativeGuidelinesModel.updateOne({ client: client._id }, { $setOnInsert: { agency: client.agency, client: client._id } }, { upsert: true })
  const set = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined))
  const g = await updateWithRev(CreativeGuidelinesModel, { client: client._id }, rev, set, req.agencyAuth!.user)
  await logActivity(req, {
    action: 'brand.guidelines_updated',
    message: `${req.agencyAuth!.user.name} updated ${client.brandName}’s creative guidelines`,
    agency: client.agency,
    client: client._id,
    target: { type: 'client', id: client._id, label: client.brandName },
  })
  res.json({ guidelines: g })
})

// ── References (both sides, D40) ─────────────────────────────────────────────

const refListSchema = z.object({ sentiment: z.enum(['like', 'dislike', 'neutral']).optional() })
const refCreateSchema = z
  .object({
    sentiment: z.enum(['like', 'dislike', 'neutral']),
    image: z.string().optional(),
    link: z.union([z.url().max(1000), z.literal('')]).default(''),
    note: z.string().trim().max(200).default(''),
    category: z.string().trim().max(60).default(''),
  })
  .refine((r) => r.image || r.link, { message: 'Add an image or a link', path: ['link'] })

async function listRefs(client: Types.ObjectId, sentiment?: string) {
  const filter: Record<string, unknown> = { client, deletedAt: null, ...(sentiment ? { sentiment } : {}) }
  const items = await BrandReferenceModel.find(filter).sort({ createdAt: -1 }).limit(500).lean()
  return Promise.all(items.map(async (r) => ({ ...r, imageUrl: await imageUrl(r.image) })))
}

async function createRef(req: Request, client: { _id: Types.ObjectId; agency: Types.ObjectId }, input: z.infer<typeof refCreateSchema>) {
  let image = null
  if (input.image) {
    // F05: JPG/PNG up to 10 MB, shared with both sides.
    const f = await FileModel.findOne({ _id: objectId(input.image, 'File not found.'), client: client._id, mimeType: /^image\/(jpeg|png)$/, size: { $lte: 10 * 1024 * 1024 }, deletedAt: null }, { _id: 1 }).lean()
    if (!f) throw invalid('image', 'Upload a JPG or PNG up to 10 MB')
    await FileModel.updateOne({ _id: f._id }, { $set: { visibility: 'client' }, $addToSet: { usedIn: { type: 'brand_reference', id: f._id } } })
    image = f._id
  }
  const me = currentUser(req)
  return BrandReferenceModel.create({ ...input, image, agency: client.agency, client: client._id, addedBy: { id: me._id, name: me.name, side: me.side } })
}

brandRouter.get('/:id/brand/references', async (req, res) => {
  const client = await loadClient(req, objectId(req.params.id, 'Client not found.'))
  res.json({ items: await listRefs(client._id, refListSchema.parse(req.query).sentiment) })
})

brandRouter.post('/:id/brand/references', async (req, res) => {
  const client = await loadClient(req, objectId(req.params.id, 'Client not found.'), 'write')
  res.status(201).json({ reference: await createRef(req, client, refCreateSchema.parse(req.body)) })
})

brandRouter.delete('/:id/brand/references/:refId', async (req, res) => {
  const client = await loadClient(req, objectId(req.params.id, 'Client not found.'), 'write')
  const done = await BrandReferenceModel.updateOne({ _id: objectId(req.params.refId, 'Reference not found.'), client: client._id, deletedAt: null }, { $set: { deletedAt: new Date() } })
  if (!done.matchedCount) throw notFound('Reference not found.')
  res.status(204).end()
})

// ── Client side ─────────────────────────────────────────────────────────────

async function myClient(req: Request) {
  const client = await ClientModel.findById(req.clientAuth!.client._id)
  if (!client) throw notFound()
  return client
}

function assertCanEditBrand(req: Request) {
  if (!clientCan(req.clientAuth!.role, 'editBrand')) throw forbidden('Your role can view the Brand DNA but not edit it.')
}

clientBrandRouter.get('/', async (req, res) => {
  res.json({ brand: await presentBrand(await myClient(req)) })
})

/** The client edits their own sections at any time (D41). The professional layer is the agency's. */
clientBrandRouter.put('/sections/:section', async (req, res) => {
  assertCanEditBrand(req)
  const section = sectionParam(req.params.section)
  if (!(CLIENT_SECTIONS as readonly string[]).includes(section)) throw forbidden('Your agency maintains this section.')
  const { rev, data } = saveSchema.parse(req.body)
  const brand = await saveSection(req, await myClient(req), section, rev, data)
  res.json({ section: (brand.sections as any)[section] })
})

clientBrandRouter.get('/onboarding', async (req, res) => {
  const client = await myClient(req)
  const brand = await brandFor(client)
  const assets = await RequestModel.find({ client: client._id, source: 'asset', status: { $in: ['open', 'submitted', 'completed'] }, deletedAt: null }, { title: 1, status: 1, uploadCategory: 1 }).lean()
  res.json({ onboarding: await onboardingProgress(brand), assetRequests: assets })
})

/** "Done" / "Nothing to add" on an onboarding section (D72). */
clientBrandRouter.post('/onboarding/:step/complete', async (req, res) => {
  assertCanEditBrand(req)
  const step = req.params.step
  if (!(ONBOARDING_STEPS as readonly string[]).includes(step)) throw notFound('Step not found.')
  const { progress } = await completeStep(req, await myClient(req), step as (typeof ONBOARDING_STEPS)[number])
  res.json({ onboarding: progress })
})

clientBrandRouter.get('/references', async (req, res) => {
  res.json({ items: await listRefs(req.clientAuth!.client._id, refListSchema.parse(req.query).sentiment) })
})

clientBrandRouter.post('/references', async (req, res) => {
  assertCanEditBrand(req)
  res.status(201).json({ reference: await createRef(req, await myClient(req), refCreateSchema.parse(req.body)) })
})

/** Clients remove their own references; the agency can remove any. */
clientBrandRouter.delete('/references/:refId', async (req, res) => {
  assertCanEditBrand(req)
  const done = await BrandReferenceModel.updateOne(
    { _id: objectId(req.params.refId, 'Reference not found.'), client: req.clientAuth!.client._id, 'addedBy.id': req.clientAuth!.user._id, deletedAt: null },
    { $set: { deletedAt: new Date() } },
  )
  if (!done.matchedCount) throw notFound('Reference not found.')
  res.status(204).end()
})

