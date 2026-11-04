import { Router } from 'express'
import type { Types } from 'mongoose'
import { z } from 'zod'
import { logActivity } from '../../lib/activity.ts'
import { objectId } from '../../lib/ids.ts'
import { clientCan, loadClient } from '../../lib/scope.ts'
import { forbidden, notFound } from '../../utils/AppError.ts'
import { FileCollectionModel } from './collection.model.ts'
import { FILE_CATEGORIES, FileModel } from './file.model.ts'

/**
 * The resource library's organisation (P27–P31, F64–F65): categories (on each file) and collections.
 * Agency side mounts under /clients/:id; the client side under /client/library.
 */
export const libraryRouter = Router()
export const clientLibraryRouter = Router()

async function withCounts(client: Types.ObjectId, clientOnly: boolean) {
  const collections = await FileCollectionModel.find({ client, deletedAt: null, ...(clientOnly ? { visibility: 'client' } : {}) }).sort({ name: 1 }).lean()
  const counts = await FileModel.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { client, collectionId: { $in: collections.map((c) => c._id) }, deletedAt: null, status: 'ready', ...(clientOnly ? { visibility: 'client' } : {}) } },
    { $group: { _id: '$collectionId', n: { $sum: 1 } } },
  ])
  return collections.map((c) => ({ ...c, fileCount: counts.find((x) => String(x._id) === String(c._id))?.n ?? 0 }))
}

/** Library counts per category, for the category tabs. */
async function categoryCounts(client: Types.ObjectId, clientOnly: boolean) {
  const rows = await FileModel.aggregate<{ _id: string; n: number }>([
    { $match: { client, purpose: { $in: ['library', 'request'] }, deletedAt: null, status: 'ready', ...(clientOnly ? { visibility: 'client' } : {}) } },
    { $group: { _id: '$category', n: { $sum: 1 } } },
  ])
  return Object.fromEntries(FILE_CATEGORIES.map((c) => [c, rows.find((r) => r._id === c)?.n ?? 0]))
}

libraryRouter.get('/:id/library', async (req, res) => {
  const client = await loadClient(req, objectId(req.params.id, 'Client not found.'))
  res.json({ categories: await categoryCounts(client._id, false), collections: await withCounts(client._id, false) })
})

const collectionSchema = z.object({ name: z.string().trim().min(1).max(120), description: z.string().max(1000).default(''), visibility: z.enum(['internal', 'client']).default('client') })

libraryRouter.post('/:id/collections', async (req, res) => {
  const input = collectionSchema.parse(req.body)
  const client = await loadClient(req, objectId(req.params.id, 'Client not found.'), 'write')
  const me = req.agencyAuth!.user
  const c = await FileCollectionModel.create({ ...input, agency: client.agency, client: client._id, createdBy: { id: me._id, name: me.name } })
  await logActivity(req, {
    action: 'library.collection_created',
    message: `${me.name} created the collection ${c.name}`,
    agency: client.agency,
    client: client._id,
    visibility: c.visibility as 'internal' | 'client',
    target: { type: 'collection', id: c._id, label: c.name },
  })
  res.status(201).json({ collection: c })
})

libraryRouter.patch('/:id/collections/:collectionId', async (req, res) => {
  const input = collectionSchema.partial().parse(req.body)
  const client = await loadClient(req, objectId(req.params.id, 'Client not found.'), 'write')
  const c = await FileCollectionModel.findOneAndUpdate({ _id: objectId(req.params.collectionId, 'Collection not found.'), client: client._id, deletedAt: null }, { $set: input }, { returnDocument: 'after' }).lean()
  if (!c) throw notFound('Collection not found.')
  res.json({ collection: c })
})

/** Deleting a collection keeps its files; they just leave the collection. */
libraryRouter.delete('/:id/collections/:collectionId', async (req, res) => {
  const client = await loadClient(req, objectId(req.params.id, 'Client not found.'), 'write')
  const id = objectId(req.params.collectionId, 'Collection not found.')
  const done = await FileCollectionModel.updateOne({ _id: id, client: client._id, deletedAt: null }, { $set: { deletedAt: new Date() } })
  if (!done.matchedCount) throw notFound('Collection not found.')
  await FileModel.updateMany({ client: client._id, collectionId: id }, { $set: { collectionId: null } })
  res.status(204).end()
})

const fileUpdateSchema = z.object({ collection: z.string().nullable().optional(), category: z.enum(FILE_CATEGORIES).optional(), visibility: z.enum(['internal', 'client']).optional() })

async function organise(client: Types.ObjectId, fileId: unknown, input: z.infer<typeof fileUpdateSchema>, clientSide: boolean) {
  const set: Record<string, unknown> = {}
  if (input.collection !== undefined) {
    if (input.collection) {
      const c = await FileCollectionModel.findOne({ _id: objectId(input.collection, 'Collection not found.'), client, deletedAt: null, ...(clientSide ? { visibility: 'client' } : {}) }, { _id: 1 }).lean()
      if (!c) throw notFound('Collection not found.')
      set.collectionId = c._id
    } else set.collectionId = null
  }
  if (input.category) set.category = input.category
  // Only the agency decides what the client can see.
  if (input.visibility && !clientSide) set.visibility = input.visibility
  const file = await FileModel.findOneAndUpdate(
    { _id: objectId(fileId, 'File not found.'), client, purpose: { $in: ['library', 'request'] }, deletedAt: null, ...(clientSide ? { visibility: 'client' } : {}) },
    { $set: set },
    { returnDocument: 'after' },
  ).lean()
  if (!file) throw notFound('File not found.')
  return file
}

libraryRouter.patch('/:id/library/files/:fileId', async (req, res) => {
  const client = await loadClient(req, objectId(req.params.id, 'Client not found.'), 'write')
  res.json({ file: await organise(client._id, req.params.fileId, fileUpdateSchema.parse(req.body), false) })
})

clientLibraryRouter.get('/', async (req, res) => {
  const client = req.clientAuth!.client._id
  res.json({ categories: await categoryCounts(client, true), collections: await withCounts(client, true) })
})

/** Clients file their own library uploads into categories and collections. */
clientLibraryRouter.patch('/files/:fileId', async (req, res) => {
  if (!clientCan(req.clientAuth!.role, 'upload')) throw forbidden()
  res.json({ file: await organise(req.clientAuth!.client._id, req.params.fileId, fileUpdateSchema.omit({ visibility: true }).parse(req.body), true) })
})
