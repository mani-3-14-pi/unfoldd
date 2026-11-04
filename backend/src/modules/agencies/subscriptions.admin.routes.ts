import { Router } from 'express'
import { z } from 'zod'
import { csvEnum, dateParam, dateRange, escapeRegex, pageQuery, paginate } from '../../lib/pagination.ts'
import { AGENCY_STATUSES, PLANS, SUBSCRIPTION_STATUSES } from './agency.constants.ts'
import { AgencyModel } from './agency.model.ts'

/** Placeholder: lists each agency's subscription record. No billing provider behind it yet. */
export const subscriptionsAdminRouter = Router()

const SORTS = {
  renews_soon: { 'subscription.renewsAt': 1 },
  renews_late: { 'subscription.renewsAt': -1 },
  newest: { 'subscription.startedAt': -1 },
  name: { name: 1 },
  seats: { 'subscription.seats': -1 },
} as const

const listSchema = z.object({
  ...pageQuery,
  plan: csvEnum(PLANS),
  status: csvEnum(SUBSCRIPTION_STATUSES),
  agencyStatus: csvEnum(AGENCY_STATUSES),
  renewsFrom: dateParam,
  renewsTo: dateParam,
  sort: z.enum(Object.keys(SORTS) as [keyof typeof SORTS]).default('renews_soon'),
})

subscriptionsAdminRouter.get('/', async (req, res) => {
  const f = listSchema.parse(req.query)
  const filter: Record<string, unknown> = {}
  if (f.plan.length) filter['subscription.plan'] = { $in: f.plan }
  if (f.status.length) filter['subscription.status'] = { $in: f.status }
  // Pending and rejected agencies never started a subscription, so they're hidden unless asked for.
  filter.status = { $in: f.agencyStatus.length ? f.agencyStatus : ['active', 'suspended'] }
  const renews = dateRange(f.renewsFrom, f.renewsTo)
  if (renews) filter['subscription.renewsAt'] = renews
  if (f.q) {
    const rx = new RegExp(escapeRegex(f.q), 'i')
    filter.$or = [{ name: rx }, { email: rx }, { slug: rx }]
  }

  // Each summary ignores its own facet, so tab and filter counts don't collapse once one is selected.
  const { 'subscription.plan': _plan, ...withoutPlan } = filter
  const { 'subscription.status': _status, ...withoutStatus } = filter
  const [page, byPlan, byStatus] = await Promise.all([
    paginate(AgencyModel, filter, { page: f.page, pageSize: f.pageSize, sort: SORTS[f.sort] }),
    AgencyModel.aggregate<{ _id: string; n: number }>([{ $match: withoutPlan }, { $group: { _id: '$subscription.plan', n: { $sum: 1 } } }]),
    AgencyModel.aggregate<{ _id: string; n: number }>([{ $match: withoutStatus }, { $group: { _id: '$subscription.status', n: { $sum: 1 } } }]),
  ])
  const tally = (rows: { _id: string; n: number }[], keys: readonly string[]) =>
    Object.fromEntries(keys.map((k) => [k, rows.find((r) => r._id === k)?.n ?? 0]))

  res.json({
    ...page,
    items: page.items.map(({ _id, name, slug, email, status, subscription }) => ({ _id, name, slug, email, status, subscription })),
    summary: { byPlan: tally(byPlan, PLANS), byStatus: tally(byStatus, SUBSCRIPTION_STATUSES) },
  })
})
