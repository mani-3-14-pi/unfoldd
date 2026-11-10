import { Router } from 'express'
import { ActivityModel } from '../activity/activity.model.ts'
import { AGENCY_STATUSES, PLANS } from '../agencies/agency.constants.ts'
import { AgencyModel } from '../agencies/agency.model.ts'
import { getSettings } from '../settings/settings.model.ts'
import { SupportTicketModel } from '../support/support.model.ts'

export const overviewRouter = Router()

const DAY = 86_400_000

overviewRouter.get('/', async (_req, res) => {
  const now = Date.now()
  const [byStatus, byPlan, last7, prev7, last30, pending, recent, settings, openTickets] = await Promise.all([
    AgencyModel.aggregate<{ _id: string; n: number }>([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    AgencyModel.aggregate<{ _id: string; n: number }>([
      { $match: { status: 'active' } },
      { $group: { _id: '$subscription.plan', n: { $sum: 1 } } },
    ]),
    AgencyModel.countDocuments({ createdAt: { $gte: new Date(now - 7 * DAY) } }),
    AgencyModel.countDocuments({ createdAt: { $gte: new Date(now - 14 * DAY), $lt: new Date(now - 7 * DAY) } }),
    AgencyModel.countDocuments({ createdAt: { $gte: new Date(now - 30 * DAY) } }),
    AgencyModel.find({ status: 'pending' }, { name: 1, email: 1, country: 1, teamSize: 1, createdAt: 1 }).sort({ createdAt: 1 }).limit(5).lean(),
    ActivityModel.find({}, { action: 1, message: 1, actor: 1, createdAt: 1, agency: 1 }).sort({ createdAt: -1 }).limit(8).lean(),
    getSettings(),
    SupportTicketModel.countDocuments({ status: 'open' }),
  ])
  const tally = (rows: { _id: string; n: number }[], keys: readonly string[]) =>
    Object.fromEntries(keys.map((k) => [k, rows.find((r) => r._id === k)?.n ?? 0]))
  const statuses = tally(byStatus, AGENCY_STATUSES)

  res.json({
    agencies: { total: Object.values(statuses).reduce((a, b) => a + b, 0), byStatus: statuses },
    signups: { last7, prev7, last30 },
    activePlans: tally(byPlan, PLANS),
    pending,
    recentActivity: recent,
    autoApprove: settings.signups.autoApprove,
    support: { open: openTickets },
  })
})
