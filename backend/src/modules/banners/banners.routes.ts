import { Router, type Request } from 'express'
import type { Types } from 'mongoose'
import { z } from 'zod'
import { logActivity } from '../../lib/activity.ts'
import { updateWithRev } from '../../lib/concurrency.ts'
import { objectId } from '../../lib/ids.ts'
import { loadClient, scopeFilter } from '../../lib/scope.ts'
import { presignDownload, storageConfigured } from '../../lib/storage.ts'
import { AppError, forbidden, invalid, notFound } from '../../utils/AppError.ts'
import { FileModel } from '../files/file.model.ts'
import { BannerModel, bannerState, liveFilter } from './banner.model.ts'

/** The banner manager (D52) and the client's banner detail (F13). */
export const bannersRouter = Router()
export const clientBannersRouter = Router()

async function imageUrl(id: unknown) {
  if (!id || !storageConfigured()) return null
  const file = await FileModel.findOne({ _id: id, status: 'ready', deletedAt: null }).lean()
  return file ? (await presignDownload(file.key, file, { inline: true })).url : null
}

const present = async (b: Record<string, any>) => ({ ...b, state: bannerState(b), imageUrl: await imageUrl(b.image) })

async function load(req: Request, id: unknown, write = false) {
  const banner = await BannerModel.findOne({ ...(await scopeFilter(req, { softDelete: true, agencyLevel: false })), _id: objectId(id, 'Banner not found.') }).lean()
  if (!banner) throw notFound('Banner not found.')
  if (write) {
    await loadClient(req, banner.client, 'manage')
    if (banner.source === 'auto') throw forbidden('Automatic banners are managed by the app. End it instead.')
  }
  return banner
}

/** The image must be a client-visible image of this client: the client will see it. */
async function bannerImage(client: Types.ObjectId, id: string | null | undefined) {
  if (!id) return null
  const file = await FileModel.findOne({ _id: objectId(id, 'File not found.'), client, visibility: 'client', mimeType: /^image\//, status: 'ready', deletedAt: null }, { _id: 1 }).lean()
  if (!file) throw invalid('image', 'Upload an image shared with the client')
  return file._id
}

const listSchema = z.object({ client: z.string().optional(), state: z.enum(['draft', 'scheduled', 'live', 'ended']).optional() })

bannersRouter.get('/', async (req, res) => {
  const f = listSchema.parse(req.query)
  const filter: Record<string, unknown> = await scopeFilter(req, { softDelete: true, agencyLevel: false })
  if (f.client) filter.$and = [{ client: objectId(f.client) }]
  const rows = await BannerModel.find(filter).sort({ client: 1, order: 1, createdAt: -1 }).limit(500).lean()
  const items = await Promise.all(rows.map(present))
  res.json({ items: f.state ? items.filter((b) => b.state === f.state) : items })
})

const fieldsSchema = z.object({
  headline: z.string().trim().min(1, 'Add a headline').max(120),
  text: z.string().trim().max(500).optional(),
  image: z.string().nullable().optional(),
  cta: z
    .object({
      label: z.string().trim().max(40),
      // Deep links stay inside the Client App.
      link: z.string().trim().max(500).regex(/^\/c\//, 'Link to a page in the client app'),
    })
    // null removes the button.
    .nullable()
    .optional(),
  startAt: z.iso.datetime().nullable().optional(),
  endAt: z.iso.datetime().nullable().optional(),
  order: z.number().int().min(0).max(1000).optional(),
})

/** A banner without a button. */
const NO_CTA = { label: '', link: '' }

const dates = (input: { startAt?: string | null; endAt?: string | null }) => {
  const out: Record<string, Date | null> = {}
  if (input.startAt !== undefined) out.startAt = input.startAt ? new Date(input.startAt) : null
  if (input.endAt !== undefined) out.endAt = input.endAt ? new Date(input.endAt) : null
  if (out.startAt && out.endAt && out.endAt <= out.startAt) throw invalid('endAt', 'Ends before it starts')
  return out
}

bannersRouter.post('/', async (req, res) => {
  const input = fieldsSchema.extend({ client: z.string(), publish: z.boolean().default(false) }).parse(req.body)
  const auth = req.agencyAuth!
  const client = await loadClient(req, objectId(input.client, 'Client not found.'), 'manage')
  const banner = await BannerModel.create({
    agency: auth.agency._id,
    client: client._id,
    headline: input.headline,
    text: input.text ?? '',
    cta: input.cta ?? NO_CTA,
    image: await bannerImage(client._id, input.image),
    order: input.order ?? 0,
    ...dates(input),
    publishedAt: input.publish ? new Date() : null,
    createdBy: { id: auth.user._id, name: auth.user.name },
    updatedBy: { id: auth.user._id, name: auth.user.name },
  })
  await logActivity(req, {
    action: input.publish ? 'banner.published' : 'banner.created',
    message: `${auth.user.name} ${input.publish ? 'published' : 'drafted'} the banner “${banner.headline}”`,
    agency: auth.agency._id,
    client: client._id,
    target: { type: 'banner', id: banner._id, label: banner.headline },
  })
  res.status(201).json({ banner: await present(banner.toObject()) })
})

bannersRouter.patch('/:id', async (req, res) => {
  const { image, startAt, endAt, ...rest } = fieldsSchema.partial().extend({ rev: z.number().int().min(1) }).parse(req.body)
  const banner = await load(req, req.params.id, true)
  const set: Record<string, unknown> = { ...Object.fromEntries(Object.entries(rest).filter(([k, v]) => v !== undefined && k !== 'rev')), ...dates({ startAt, endAt }) }
  if (image !== undefined) set.image = await bannerImage(banner.client, image)
  if (set.cta === null) set.cta = NO_CTA
  const updated = await updateWithRev(BannerModel, { _id: banner._id, agency: banner.agency }, rest.rev, set, req.agencyAuth!.user)
  res.json({ banner: await present(updated.toObject()) })
})

bannersRouter.post('/:id/publish', async (req, res) => {
  const banner = await load(req, req.params.id, true)
  const updated = await BannerModel.findOneAndUpdate({ _id: banner._id, publishedAt: null }, { $set: { publishedAt: new Date() } }, { returnDocument: 'after' }).lean()
  if (!updated) throw new AppError(409, 'invalid_state', 'This banner is already published.')
  await logActivity(req, {
    action: 'banner.published',
    message: `${req.agencyAuth!.user.name} published the banner “${banner.headline}”`,
    agency: banner.agency,
    client: banner.client,
    target: { type: 'banner', id: banner._id, label: banner.headline },
  })
  res.json({ banner: await present(updated) })
})

/** Ends a live or scheduled banner now. Works on automatic banners too. */
bannersRouter.post('/:id/end', async (req, res) => {
  const banner = await load(req, req.params.id)
  await loadClient(req, banner.client, 'manage')
  const updated = await BannerModel.findOneAndUpdate({ _id: banner._id, endedAt: null }, { $set: { endedAt: new Date() } }, { returnDocument: 'after' }).lean()
  if (!updated) throw new AppError(409, 'invalid_state', 'This banner has already ended.')
  res.json({ banner: await present(updated) })
})

bannersRouter.delete('/:id', async (req, res) => {
  const banner = await load(req, req.params.id, true)
  await BannerModel.updateOne({ _id: banner._id }, { $set: { deletedAt: new Date(), deletedBy: req.agencyAuth!.user._id } })
  res.status(204).end()
})

const orderSchema = z.object({ client: z.string(), ids: z.array(z.string()).min(1).max(100) })

/** Sets the order banners show in, top first. */
bannersRouter.put('/order', async (req, res) => {
  const { client: clientId, ids } = orderSchema.parse(req.body)
  const client = await loadClient(req, objectId(clientId, 'Client not found.'), 'manage')
  await BannerModel.bulkWrite(ids.map((id, i) => ({ updateOne: { filter: { _id: objectId(id, 'Banner not found.'), client: client._id }, update: { $set: { order: i } } } })))
  res.json({ ok: true })
})

/** F13 banner detail: only banners live right now. */
clientBannersRouter.get('/:id', async (req, res) => {
  const banner = await BannerModel.findOne(
    { ...liveFilter(), client: req.clientAuth!.client._id, _id: objectId(req.params.id, 'Banner not found.') },
    { headline: 1, text: 1, cta: 1, image: 1, startAt: 1, endAt: 1 },
  ).lean()
  if (!banner) throw notFound('Banner not found.')
  res.json({ banner: { ...banner, imageUrl: await imageUrl(banner.image) } })
})
