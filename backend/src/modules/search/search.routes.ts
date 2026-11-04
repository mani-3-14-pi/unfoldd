import { Router, type Request } from 'express'
import type { Types } from 'mongoose'
import { z } from 'zod'
import { escapeRegex } from '../../lib/pagination.ts'
import { scopeFilter } from '../../lib/scope.ts'
import { CampaignModel } from '../campaigns/campaign.model.ts'
import { ClientModel } from '../clients/client.model.ts'
import { ContentModel } from '../content/content.model.ts'
import { FileModel } from '../files/file.model.ts'
import { MeetingModel } from '../meetings/meeting.model.ts'
import { ContentPlanModel } from '../plans/plan.model.ts'
import { monthLabel } from '../plans/plans.routes.ts'
import { RequestModel } from '../requests/request.model.ts'
import { TaskModel } from '../tasks/task.model.ts'
import { MembershipModel } from '../users/membership.model.ts'
import { UserModel } from '../users/user.model.ts'

/**
 * Search (P148–P150, F82). Every type is queried with the same scope its own list endpoint uses (rule §12.1),
 * so a result is always something the person can open: Managers and Members only find their clients' work,
 * and client people only what has been shared with them (D20, D64).
 */
export const searchRouter = Router()

export const SEARCH_TYPES = ['clients', 'content', 'campaigns', 'plans', 'tasks', 'requests', 'meetings', 'files', 'people'] as const
type SearchType = (typeof SEARCH_TYPES)[number]
/** What client people can search. Clients, tasks and the team are agency-only. */
const CLIENT_TYPES: readonly SearchType[] = ['content', 'campaigns', 'plans', 'requests', 'meetings', 'files']

export interface SearchItem {
  id: Types.ObjectId | string
  title: string
  subtitle: string
  link: string
}

const querySchema = z.object({
  q: z.string().trim().min(2, 'Type at least 2 characters').max(100),
  types: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',').filter(Boolean) : [...SEARCH_TYPES]))
    .pipe(z.array(z.enum(SEARCH_TYPES))),
  limit: z.coerce.number().int().min(1).max(20).default(5),
})

const human = (s: string) => s.replace(/_/g, ' ')

/** Library and request uploads only: version files are reached through their content, never directly (D39). */
const LIBRARY_PURPOSES = ['library', 'request']

async function agencySearch(req: Request, type: SearchType, rx: RegExp, limit: number, brand: (id: unknown) => string): Promise<SearchItem[]> {
  // The same scope as the list endpoints: soft-deleted rows hidden, Managers/Members limited to their clients.
  const scoped = () => scopeFilter(req, { softDelete: true, agencyLevel: false })
  switch (type) {
    case 'clients': {
      const rows = await ClientModel.find(
        { ...(await scopeFilter(req, { clientField: '_id', softDelete: true, agencyLevel: false })), $or: [{ brandName: rx }, { name: rx }, { 'contact.name': rx }, { 'contact.email': rx }] },
        { brandName: 1, name: 1, status: 1 },
      )
        .limit(limit)
        .lean()
      return rows.map((c) => ({ id: c._id, title: c.brandName, subtitle: [c.name !== c.brandName ? c.name : '', human(c.status)].filter(Boolean).join(' · '), link: `/app/clients/${c._id}` }))
    }
    case 'content': {
      const rows = await ContentModel.find({ ...(await scoped()), title: rx }, { title: 1, client: 1, state: 1 }).sort({ updatedAt: -1 }).limit(limit).lean()
      return rows.map((c) => ({ id: c._id, title: c.title, subtitle: `${brand(c.client)} · ${human(c.state)}`, link: `/app/content/${c._id}` }))
    }
    case 'campaigns': {
      const rows = await CampaignModel.find({ ...(await scoped()), name: rx }, { name: 1, client: 1, status: 1 }).sort({ updatedAt: -1 }).limit(limit).lean()
      return rows.map((c) => ({ id: c._id, title: c.name, subtitle: `${brand(c.client)} · ${human(c.status)}`, link: `/app/campaigns/${c._id}` }))
    }
    case 'plans': {
      // Plans are found by their month's name ("December 2026"), so match the label, not a stored field.
      const rows = await ContentPlanModel.find(await scopeFilter(req, { agencyLevel: false }), { month: 1, client: 1, status: 1 }).sort({ month: -1 }).limit(200).lean()
      return rows
        .filter((p) => rx.test(`${monthLabel(p.month)} plan`) || rx.test(brand(p.client)))
        .slice(0, limit)
        .map((p) => ({ id: p._id, title: `${monthLabel(p.month)} plan`, subtitle: `${brand(p.client)} · ${human(p.status)}`, link: `/app/plans/${p._id}` }))
    }
    case 'tasks': {
      const rows = await TaskModel.find({ ...(await scoped()), title: rx }, { title: 1, client: 1, status: 1 }).sort({ updatedAt: -1 }).limit(limit).lean()
      return rows.map((t) => ({ id: t._id, title: t.title, subtitle: `${brand(t.client)} · ${human(t.status)}`, link: `/app/tasks/${t._id}` }))
    }
    case 'requests': {
      const rows = await RequestModel.find({ ...(await scoped()), title: rx }, { title: 1, client: 1, status: 1 }).sort({ updatedAt: -1 }).limit(limit).lean()
      return rows.map((r) => ({ id: r._id, title: r.title, subtitle: `${brand(r.client)} · ${human(r.status)}`, link: `/app/requests/${r._id}` }))
    }
    case 'meetings': {
      const rows = await MeetingModel.find({ ...(await scoped()), title: rx }, { title: 1, client: 1, startAt: 1 }).sort({ startAt: -1 }).limit(limit).lean()
      return rows.map((m) => ({ id: m._id, title: m.title, subtitle: `${brand(m.client)} · ${m.startAt.toISOString().slice(0, 10)}`, link: `/app/meetings/${m._id}` }))
    }
    case 'files': {
      // The resource library's own scope: ready, not deleted, library or request uploads.
      const filter: Record<string, unknown> = { ...(await scopeFilter(req, { visibility: true, softDelete: true, agencyLevel: false })), purpose: { $in: LIBRARY_PURPOSES }, status: 'ready', name: rx }
      const rows = await FileModel.find(filter, { name: 1, client: 1, category: 1 })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean()
      return rows.map((f) => ({ id: f._id, title: f.name, subtitle: `${brand(f.client)} · ${human(f.category)}`, link: `/app/clients/${f.client}/library` }))
    }
    case 'people': {
      // Everyone can see the team list, so everyone can find people on it.
      const users = await UserModel.find({ $or: [{ name: rx }, { email: rx }] }, { name: 1, email: 1 }).limit(200).lean()
      const members = await MembershipModel.find({ agency: req.agencyAuth!.agency._id, user: { $in: users.map((u) => u._id) } }, { user: 1, role: 1, titles: 1 })
        .limit(limit)
        .lean()
      return members.map((m) => {
        const u = users.find((x) => String(x._id) === String(m.user))!
        return { id: u._id, title: u.name, subtitle: [m.titles[0] ?? m.role, u.email].join(' · '), link: '/app/team' }
      })
    }
  }
}

async function clientSearch(req: Request, type: SearchType, rx: RegExp, limit: number): Promise<SearchItem[]> {
  switch (type) {
    case 'content': {
      // D64: only content whose plan was sent or that was sent for review at least once.
      const rows = await ContentModel.find({ ...(await scopeFilter(req, { softDelete: true })), clientVisibleAt: { $ne: null }, title: rx }, { title: 1, state: 1 })
        .sort({ updatedAt: -1 })
        .limit(limit)
        .lean()
      return rows.map((c) => ({ id: c._id, title: c.title, subtitle: 'Content', link: `/c/content/${c._id}` }))
    }
    case 'campaigns': {
      const rows = await CampaignModel.find({ ...(await scopeFilter(req, { softDelete: true })), status: { $ne: 'archived' }, name: rx }, { name: 1 }).limit(limit).lean()
      return rows.map((c) => ({ id: c._id, title: c.name, subtitle: 'Campaign', link: `/c/campaigns/${c._id}` }))
    }
    case 'plans': {
      const rows = await ContentPlanModel.find({ ...(await scopeFilter(req)), status: { $ne: 'draft' } }, { month: 1 }).sort({ month: -1 }).limit(36).lean()
      return rows
        .filter((p) => rx.test(`${monthLabel(p.month)} content plan`))
        .slice(0, limit)
        .map((p) => ({ id: p._id, title: `${monthLabel(p.month)} content plan`, subtitle: 'Content plan', link: `/c/plans/${p._id}` }))
    }
    case 'requests': {
      // Drafts and cancelled requests are never shown to the client.
      const rows = await RequestModel.find({ ...(await scopeFilter(req, { softDelete: true })), status: { $in: ['open', 'submitted', 'completed'] }, title: rx }, { title: 1 })
        .sort({ updatedAt: -1 })
        .limit(limit)
        .lean()
      return rows.map((r) => ({ id: r._id, title: r.title, subtitle: 'Needed from you', link: `/c/requests/${r._id}` }))
    }
    case 'meetings': {
      const rows = await MeetingModel.find({ ...(await scopeFilter(req, { softDelete: true })), title: rx }, { title: 1, startAt: 1 }).sort({ startAt: -1 }).limit(limit).lean()
      return rows.map((m) => ({ id: m._id, title: m.title, subtitle: `Meeting · ${m.startAt.toISOString().slice(0, 10)}`, link: `/c/meetings/${m._id}` }))
    }
    case 'files': {
      // `visibility: true` keeps client people to files shared with them.
      const filter: Record<string, unknown> = { ...(await scopeFilter(req, { visibility: true, softDelete: true })), purpose: { $in: LIBRARY_PURPOSES }, status: 'ready', name: rx }
      const rows = await FileModel.find(filter, { name: 1, category: 1 })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean()
      return rows.map((f) => ({ id: f._id, title: f.name, subtitle: `File · ${human(f.category)}`, link: '/c/library' }))
    }
    default:
      return []
  }
}

searchRouter.get('/', async (req, res) => {
  const { q, types, limit } = querySchema.parse(req.query)
  const rx = new RegExp(escapeRegex(q), 'i')

  if (req.clientAuth) {
    const wanted = types.filter((t) => CLIENT_TYPES.includes(t))
    const groups = await Promise.all(wanted.map(async (type) => ({ type, items: await clientSearch(req, type, rx, limit) })))
    res.json({ groups: groups.filter((g) => g.items.length) })
    return
  }

  // Brand names for subtitles, limited to the clients this person can see.
  const clients = await ClientModel.find(await scopeFilter(req, { clientField: '_id', agencyLevel: false }), { brandName: 1 }).lean()
  const names = new Map(clients.map((c) => [String(c._id), c.brandName]))
  const brand = (id: unknown) => names.get(String(id)) ?? ''
  const groups = await Promise.all(types.map(async (type) => ({ type, items: await agencySearch(req, type, rx, limit, brand) })))
  res.json({ groups: groups.filter((g) => g.items.length) })
})
