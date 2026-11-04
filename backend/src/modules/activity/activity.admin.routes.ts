import { Router } from 'express'
import { isValidObjectId, Types } from 'mongoose'
import { z } from 'zod'
import { csvEnum, dateParam, dateRange, escapeRegex, pageQuery, paginate } from '../../lib/pagination.ts'
import { AgencyModel } from '../agencies/agency.model.ts'
import { ACTOR_TYPES, ActivityModel } from './activity.model.ts'

export const activityAdminRouter = Router()

const listSchema = z.object({
  ...pageQuery,
  action: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',').filter((a) => /^[a-z_.]+$/.test(a)) : [])),
  actorType: csvEnum(ACTOR_TYPES),
  agency: z.string().optional().refine((id) => !id || isValidObjectId(id), 'Invalid agency'),
  supportOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  from: dateParam,
  to: dateParam,
  sort: z.enum(['newest', 'oldest']).default('newest'),
})

activityAdminRouter.get('/', async (req, res) => {
  const f = listSchema.parse(req.query)
  const filter: Record<string, unknown> = {}
  if (f.action.length) filter.action = { $in: f.action }
  if (f.actorType.length) filter['actor.type'] = { $in: f.actorType }
  if (f.agency) filter.agency = new Types.ObjectId(f.agency)
  if (f.supportOnly) filter.$or = [{ 'impersonator.id': { $exists: true } }, { action: /^agency\.impersonation_/ }]
  const at = dateRange(f.from, f.to)
  if (at) filter.createdAt = at
  if (f.q) {
    const rx = new RegExp(escapeRegex(f.q), 'i')
    const or = [{ message: rx }, { 'actor.name': rx }, { 'target.label': rx }, { ip: rx }]
    filter.$and = [...(filter.$or ? [{ $or: filter.$or }] : []), { $or: or }]
    delete filter.$or
  }

  const [page, actions] = await Promise.all([
    paginate(ActivityModel, filter, { page: f.page, pageSize: f.pageSize, sort: { createdAt: f.sort === 'newest' ? -1 : 1 } }),
    ActivityModel.distinct('action'),
  ])
  // Agency names for the rows, and for the selected agency filter chip.
  const ids = [...new Set([...page.items.map((a) => a.agency?.toString()), f.agency].filter(Boolean))] as string[]
  const agencies = await AgencyModel.find({ _id: { $in: ids } }, { name: 1, slug: 1 }).lean()
  const byId = new Map(agencies.map((a) => [a._id.toString(), { _id: a._id, name: a.name }]))

  res.json({
    ...page,
    items: page.items.map((a) => ({ ...a, agency: a.agency ? (byId.get(a.agency.toString()) ?? null) : null })),
    facets: { actions: actions.sort(), agency: f.agency ? (byId.get(f.agency) ?? null) : null },
  })
})
