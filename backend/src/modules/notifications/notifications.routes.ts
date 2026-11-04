import { Router, type Request } from 'express'
import { z } from 'zod'
import { objectId } from '../../lib/ids.ts'
import { pageQuery, paginate } from '../../lib/pagination.ts'
import { currentUser } from '../../lib/scope.ts'
import { notFound } from '../../utils/AppError.ts'
import { UserModel } from '../users/user.model.ts'
import { CHANNELS, MANDATORY_CATEGORIES, NOTIFICATION_CATEGORIES, NotificationModel } from './notification.model.ts'

/** The notification centre (F68–F69, P145–P147). Shows what belongs to the app and tenant you're in. */
export const notificationsRouter = Router()

function ownFilter(req: Request): Record<string, unknown> {
  const user = currentUser(req)._id
  if (req.clientAuth) return { user, audience: 'client', client: req.clientAuth.client._id }
  return { user, audience: 'agency', agency: req.agencyAuth!.agency._id }
}

const listSchema = z.object({ ...pageQuery, unread: z.stringbool().optional() })

notificationsRouter.get('/', async (req, res) => {
  const f = listSchema.parse(req.query)
  const filter = { ...ownFilter(req), ...(f.unread ? { readAt: null } : {}) }
  const page = await paginate(NotificationModel, filter, { page: f.page, pageSize: f.pageSize, sort: { createdAt: -1 } })
  res.json({
    ...page,
    items: page.items.map((n) => ({
      id: n._id,
      category: n.category,
      event: n.event,
      title: n.title,
      body: n.body,
      entity: n.entity,
      link: n.link,
      urgent: n.urgent,
      readAt: n.readAt,
      createdAt: n.createdAt,
    })),
  })
})

notificationsRouter.get('/unread-count', async (req, res) => {
  res.json({ count: await NotificationModel.countDocuments({ ...ownFilter(req), readAt: null }) })
})

notificationsRouter.post('/read-all', async (req, res) => {
  const { modifiedCount } = await NotificationModel.updateMany({ ...ownFilter(req), readAt: null }, { $set: { readAt: new Date() } })
  res.json({ updated: modifiedCount })
})

notificationsRouter.post('/:id/read', async (req, res) => {
  const n = await NotificationModel.findOneAndUpdate(
    { ...ownFilter(req), _id: objectId(req.params.id, 'Notification not found.') },
    [{ $set: { readAt: { $ifNull: ['$readAt', '$$NOW'] } } }],
    { returnDocument: 'after', updatePipeline: true },
  ).lean()
  if (!n) throw notFound('Notification not found.')
  res.json({ readAt: n.readAt })
})

// ── Preferences: per category × channel (D68) ────────────────────────────────

function presentPrefs(stored: Record<string, { email?: boolean; push?: boolean }> = {}) {
  return NOTIFICATION_CATEGORIES.map((category) => {
    const mandatory = MANDATORY_CATEGORIES.includes(category)
    return {
      category,
      mandatory,
      email: mandatory || stored[category]?.email !== false,
      push: mandatory || stored[category]?.push !== false,
    }
  })
}

notificationsRouter.get('/preferences', async (req, res) => {
  const user = await UserModel.findById(currentUser(req)._id, { notificationPrefs: 1 }).lean()
  res.json({ channels: CHANNELS, items: presentPrefs(user?.notificationPrefs as any) })
})

const prefsSchema = z.object({
  items: z.array(z.object({ category: z.enum(NOTIFICATION_CATEGORIES), email: z.boolean().optional(), push: z.boolean().optional() })).max(50),
})

notificationsRouter.put('/preferences', async (req, res) => {
  const { items } = prefsSchema.parse(req.body)
  const set: Record<string, boolean> = {}
  for (const item of items) {
    // Invitations and security alerts can't be switched off.
    if (MANDATORY_CATEGORIES.includes(item.category)) continue
    for (const channel of CHANNELS) if (item[channel] !== undefined) set[`notificationPrefs.${item.category}.${channel}`] = item[channel]!
  }
  const user = await UserModel.findByIdAndUpdate(currentUser(req)._id, { $set: set }, { returnDocument: 'after', projection: { notificationPrefs: 1 } }).lean()
  res.json({ channels: CHANNELS, items: presentPrefs(user?.notificationPrefs as any) })
})
