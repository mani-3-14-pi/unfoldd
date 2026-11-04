import type { Types } from 'mongoose'
import {
  MANDATORY_CATEGORIES,
  NotificationModel,
  type NotificationCategory,
} from '../modules/notifications/notification.model.ts'
import { UserModel } from '../modules/users/user.model.ts'
import { appLink, sendEmail } from './mailer.ts'

export interface NotifyInput {
  recipients: Types.ObjectId[]
  /** Which app the link opens in. */
  audience: 'agency' | 'client'
  agency?: Types.ObjectId
  client?: Types.ObjectId
  category: NotificationCategory
  event: string
  title: string
  body?: string
  entity?: { type: string; id: Types.ObjectId }
  /** App path, e.g. `/app/team`. */
  link?: string
  /** D68: urgent notifications email at once; the rest wait for the digest. */
  urgent?: boolean
  activity?: Types.ObjectId
  /** Never notify the person who did it. */
  except?: Types.ObjectId
}

/**
 * Flow 12: event → recipients → channels. In-app always; email per preference (immediately if urgent,
 * else in the digest); push is queued for the Client App and sent once a push provider exists.
 * Never throws: a failed notification must not fail the action that caused it.
 */
export async function notify(input: NotifyInput) {
  try {
    const ids = [...new Map(input.recipients.map((id) => [String(id), id])).values()].filter(
      (id) => !input.except || String(id) !== String(input.except),
    )
    if (!ids.length) return
    const users = await UserModel.find({ _id: { $in: ids } }, { email: 1, name: 1, notificationPrefs: 1 }).lean()
    const mandatory = MANDATORY_CATEGORIES.includes(input.category)

    const rows = users.map((u) => {
      const prefs = (u.notificationPrefs as Record<string, { email?: boolean; push?: boolean }> | undefined)?.[input.category]
      const wantsEmail = mandatory || prefs?.email !== false
      const wantsPush = input.audience === 'client' && (mandatory || prefs?.push !== false)
      return {
        user: u._id,
        agency: input.agency,
        client: input.client,
        audience: input.audience,
        category: input.category,
        event: input.event,
        title: input.title,
        body: input.body ?? '',
        entity: input.entity,
        link: input.link ?? '',
        urgent: !!input.urgent,
        activity: input.activity,
        email: !wantsEmail ? 'none' : input.urgent ? 'sent' : 'digest_pending',
        push: wantsPush ? 'pending' : 'none',
      }
    })
    await NotificationModel.insertMany(rows)

    await Promise.all(
      users
        .filter((_, i) => rows[i].email === 'sent')
        .map((u) =>
          sendEmail({
            to: u.email,
            subject: input.title,
            text: [input.body, input.link ? `Open: ${appLink(input.link)}` : ''].filter(Boolean).join('\n\n'),
            kind: 'notification',
          }),
        ),
    )
  } catch (err) {
    console.error('Failed to send notification', err)
  }
}

/**
 * Emails each person one summary of their non-urgent notifications. Every notification is claimed atomically,
 * so two servers running this at once never send the same item twice.
 */
export async function sendDigests(olderThanMs = 60 * 60 * 1000) {
  const cutoff = new Date(Date.now() - olderThanMs)
  const users: Types.ObjectId[] = await NotificationModel.distinct('user', { email: 'digest_pending', createdAt: { $lte: cutoff } })
  for (const userId of users) {
    const items = []
    for (;;) {
      const n = await NotificationModel.findOneAndUpdate(
        { user: userId, email: 'digest_pending', createdAt: { $lte: cutoff } },
        { $set: { email: 'digest_sent' } },
        { returnDocument: 'after' },
      ).lean()
      if (!n) break
      // Already read in the app: nothing to remind them of.
      if (!n.readAt) items.push(n)
    }
    const user = items.length ? await UserModel.findById(userId, { email: 1 }).lean() : null
    if (!user) continue
    await sendEmail({
      to: user.email,
      subject: `You have ${items.length} update${items.length === 1 ? '' : 's'} on Unfoldd`,
      text: items.map((n) => `• ${n.title}${n.link ? `\n  ${appLink(n.link)}` : ''}`).join('\n'),
      kind: 'digest',
    })
  }
}
