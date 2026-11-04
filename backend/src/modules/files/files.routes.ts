import { Router, type Request } from 'express'
import { Types } from 'mongoose'
import { z } from 'zod'
import { env } from '../../config/env.ts'
import { logActivity } from '../../lib/activity.ts'
import { transition } from '../../lib/concurrency.ts'
import { objectId } from '../../lib/ids.ts'
import { escapeRegex, pageQuery, paginate } from '../../lib/pagination.ts'
import { clientCan, currentUser, isAgencyAdmin, loadClient, scopeFilter, tenantOf } from '../../lib/scope.ts'
import { headObject, presignDownload, presignUpload } from '../../lib/storage.ts'
import { idempotent } from '../../middleware/idempotency.ts'
import { AppError, forbidden, invalid, notFound } from '../../utils/AppError.ts'
import { FILE_CATEGORIES, FileModel } from './file.model.ts'

/**
 * Files (rule §12.6): the browser uploads straight to R2 with a presigned PUT, then calls `complete`.
 * Downloads are short-lived signed URLs, issued only after the scope check. Shared by both apps.
 */
export const filesRouter = Router()

const PURPOSES = ['library', 'logo', 'request', 'version', 'attachment'] as const
/** Listed in the resource library. Version files never are (D39). */
const LIBRARY = ['library', 'request'] as const

/** The scope filter for files, plus: client people never see version files directly (D39). */
async function fileScope(req: Request) {
  const filter = await scopeFilter(req, { visibility: true, softDelete: true })
  if (req.clientAuth) filter.purpose = { $ne: 'version' }
  return filter
}

async function scopedFile(req: Request, id: unknown) {
  const file = await FileModel.findOne({ ...(await fileScope(req)), _id: objectId(id, 'File not found.') })
  if (!file) throw notFound('File not found.')
  return file
}

const safeName = (name: string) => name.normalize('NFKD').replace(/[^\w.-]+/g, '_').slice(-120) || 'file'

const present = (f: Record<string, any>) => ({
  id: f._id,
  client: f.client,
  purpose: f.purpose,
  name: f.name,
  mimeType: f.mimeType,
  size: f.size,
  status: f.status,
  error: f.error || undefined,
  category: f.category,
  collection: f.collectionId ?? null,
  visibility: f.visibility,
  uploadedBy: f.uploadedBy,
  createdAt: f.createdAt,
})

const createSchema = z.object({
  name: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(3).max(150).regex(/^[\w.+-]+\/[\w.+-]+$/, 'Unknown file type'),
  size: z.number().int().min(1),
  purpose: z.enum(PURPOSES).default('library'),
  client: z.string().optional(),
  category: z.enum(FILE_CATEGORIES).default('other'),
  visibility: z.enum(['internal', 'client']).optional(),
})

filesRouter.post('/', idempotent(), async (req, res) => {
  const input = createSchema.parse(req.body)
  if (input.size > env.UPLOAD_MAX_MB * 1024 * 1024) throw invalid('size', `Files can be up to ${env.UPLOAD_MAX_MB} MB`)
  if (input.purpose === 'logo' && !input.mimeType.startsWith('image/')) throw invalid('mimeType', 'A logo must be an image')

  let { agency, client } = tenantOf(req)
  let visibility = input.visibility ?? 'internal'
  if (req.clientAuth) {
    if (!clientCan(req.clientAuth.role, 'upload')) throw forbidden()
    if (input.purpose === 'logo' || input.purpose === 'version') throw forbidden()
    // Anything a client uploads is shared with the agency by definition.
    visibility = 'client'
  } else if (input.client) {
    client = (await loadClient(req, objectId(input.client, 'Client not found.'), 'write'))._id
  } else if (input.purpose === 'logo') {
    // An agency logo, or a client logo picked before the client is created.
    if (!isAgencyAdmin(req.agencyAuth!.role) && req.agencyAuth!.role !== 'manager') throw forbidden()
  } else {
    throw invalid('client', 'Choose a client')
  }

  const by = currentUser(req)
  const _id = new Types.ObjectId()
  const key = `${agency}/${client ?? 'agency'}/${_id}/${safeName(input.name)}`
  const file = await FileModel.create({
    _id,
    agency,
    client,
    purpose: input.purpose,
    name: input.name,
    mimeType: input.mimeType,
    size: input.size,
    key,
    category: input.category,
    visibility,
    uploadedBy: { id: by._id, name: by.name, side: by.side },
  })
  const url = await presignUpload(key, input.mimeType, input.size)
  res.status(201).json({ file: present(file.toObject()), upload: { url, method: 'PUT', headers: { 'Content-Type': input.mimeType } } })
})

/**
 * The browser calls this after its PUT finished. The object is checked in R2 before the file counts as uploaded.
 * Processing (thumbnails, video frames) will run as a background job; for now it completes straight away.
 */
filesRouter.post('/:id/complete', async (req, res) => {
  const file = await scopedFile(req, req.params.id)
  if (String(file.uploadedBy?.id) !== String(currentUser(req)._id)) throw notFound('File not found.')
  if (file.status !== 'uploading') {
    res.json({ file: present(file.toObject()) })
    return
  }
  const head = await headObject(file.key)
  if (!head) throw new AppError(409, 'upload_missing', 'The upload hasn’t finished yet. Try again in a moment.')

  const processing = await transition(FileModel, { _id: file._id }, { from: ['uploading'], to: 'processing' }, { label: 'file' })
  const ok = head.size === file.size
  const done = await transition(FileModel, { _id: file._id }, { from: ['processing'], to: ok ? 'ready' : 'failed' }, {
    label: 'file',
    set: ok ? {} : { error: 'The uploaded file’s size doesn’t match. Upload it again.' },
  })
  if (ok && processing.purpose !== 'logo') {
    await logActivity(req, {
      action: 'file.uploaded',
      message: `${currentUser(req).name} uploaded ${done.name}`,
      agency: done.agency,
      client: done.client ?? undefined,
      visibility: done.visibility as 'internal' | 'client',
      target: { type: 'file', id: done._id, label: done.name },
    })
  }
  res.json({ file: present(done.toObject()) })
})

const listSchema = z.object({
  ...pageQuery,
  client: z.string().optional(),
  category: z.enum(FILE_CATEGORIES).optional(),
  purpose: z.enum(PURPOSES).optional(),
  collection: z.string().optional(),
})

/** The resource library: ready files only, newest first. */
filesRouter.get('/', async (req, res) => {
  const f = listSchema.parse(req.query)
  const filter: Record<string, unknown> = { ...(await fileScope(req)), status: 'ready' }
  filter.purpose = f.purpose && (LIBRARY as readonly string[]).includes(f.purpose) ? f.purpose : { $in: LIBRARY }
  if (f.client && req.agencyAuth) filter.$and = [{ client: filter.client ?? { $exists: true } }, { client: objectId(f.client) }]
  if (f.category) filter.category = f.category
  if (f.collection) filter.collectionId = objectId(f.collection)
  if (f.q) filter.name = new RegExp(escapeRegex(f.q), 'i')
  const page = await paginate(FileModel, filter, { page: f.page, pageSize: f.pageSize, sort: { createdAt: -1 } })
  res.json({ ...page, items: page.items.map(present) })
})

filesRouter.get('/:id', async (req, res) => {
  res.json({ file: present((await scopedFile(req, req.params.id)).toObject()) })
})

filesRouter.get('/:id/download', async (req, res) => {
  const file = await scopedFile(req, req.params.id)
  if (file.status !== 'ready') throw new AppError(409, 'file_not_ready', 'This file is still processing.', { status: file.status })
  const inline = z.stringbool().optional().parse(req.query.inline)
  res.json(await presignDownload(file.key, file, { inline }))
})

/** Soft delete (D61). The object stays in R2, and a file used by a version can't be deleted at all. */
filesRouter.delete('/:id', async (req, res) => {
  const file = await scopedFile(req, req.params.id)
  const by = currentUser(req)
  if (req.clientAuth && (String(file.uploadedBy?.id) !== String(by._id) || !clientCan(req.clientAuth.role, 'upload'))) throw forbidden()
  if (file.client) await loadClient(req, file.client, 'write')
  if (file.usedIn.some((u) => u.type === 'version')) {
    throw new AppError(409, 'file_in_use', 'This file is part of a content version, so it can’t be deleted.')
  }
  await FileModel.updateOne({ _id: file._id, deletedAt: null }, { $set: { deletedAt: new Date(), deletedBy: by._id } })
  await logActivity(req, {
    action: 'file.deleted',
    message: `${by.name} deleted ${file.name}`,
    agency: file.agency,
    client: file.client ?? undefined,
    visibility: file.visibility as 'internal' | 'client',
    target: { type: 'file', id: file._id, label: file.name },
  })
  res.status(204).end()
})
