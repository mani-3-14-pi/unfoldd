import { Router } from 'express'
import type { Types } from 'mongoose'
import { z } from 'zod'
import { objectId } from '../../lib/ids.ts'
import { accessibleClientIds, clientCan, scopeFilter } from '../../lib/scope.ts'
import { dateIn, todayIn } from '../../lib/time.ts'
import { AppError } from '../../utils/AppError.ts'
import { ActivityModel } from '../activity/activity.model.ts'
import { BannerModel, liveFilter } from '../banners/banner.model.ts'
import { ClientModel } from '../clients/client.model.ts'
import { clientStatus, shiftedDays } from '../content/content.derive.ts'
import { ContentModel } from '../content/content.model.ts'
import { PublishJobModel } from '../content/publishJob.model.ts'
import { VersionModel } from '../content/version.model.ts'
import { MeetingModel } from '../meetings/meeting.model.ts'
import { ContentPlanModel } from '../plans/plan.model.ts'
import { monthLabel } from '../plans/plans.routes.ts'
import { RequestModel } from '../requests/request.model.ts'
import { TaskModel } from '../tasks/task.model.ts'
import { agencyAttention, clientHealth, overviewMetrics, teamWorkload } from './insights.ts'

/** Phase 3 command centres and the calendar (D31, D32, D50, D51). */
export const dashboardRouter = Router()
export const calendarRouter = Router()
export const clientHomeRouter = Router()
export const clientCalendarRouter = Router()

// ── Agency dashboard (P05–P10) ───────────────────────────────────────────────

const dashSchema = z.object({ mine: z.stringbool().default(false) })

dashboardRouter.get('/', async (req, res) => {
  const { mine } = dashSchema.parse(req.query)
  const auth = req.agencyAuth!
  const clientIds = await accessibleClientIds(req)
  const attention = await agencyAttention(auth.agency._id, clientIds, { _id: auth.user._id, mine })
  const scope = { agency: auth.agency._id, deletedAt: null, ...(clientIds ? { client: { $in: clientIds } } : {}) }

  const [metrics, pending, workload, recent, health] = await Promise.all([
    overviewMetrics(auth.agency._id, clientIds, attention),
    // P08: pending client approvals, oldest first.
    ContentModel.find({ ...scope, state: 'client_review' }, { title: 1, client: 1, stateChangedAt: 1, publishDate: 1, currentVersion: 1 }).sort({ stateChangedAt: 1 }).limit(50).lean(),
    teamWorkload(auth.agency._id),
    ActivityModel.find({ ...(await scopeFilter(req)), visibility: { $in: ['internal', 'client'] } }, { ip: 0, userAgent: 0 }).sort({ createdAt: -1 }).limit(20).lean(),
    clientHealth(auth.agency._id, clientIds),
  ])
  const versions = await VersionModel.find({ _id: { $in: pending.map((p) => p.currentVersion) } }, { number: 1, firstViewedAt: 1, sentToClientAt: 1 }).lean()
  const clients = await ClientModel.find({ _id: { $in: [...health.keys()] } }, { brandName: 1, status: 1 }).lean()

  res.json({
    metrics,
    needsAttention: { total: attention.length, items: attention.slice(0, 50) },
    pendingApprovals: pending.map((p) => {
      const v = versions.find((x) => String(x._id) === String(p.currentVersion))
      return { ...p, versionNumber: v?.number, viewed: !!v?.firstViewedAt, sentAt: v?.sentToClientAt ?? p.stateChangedAt }
    }),
    workload,
    recentActivity: recent,
    clients: clients.map((c) => ({ id: c._id, brandName: c.brandName, status: c.status, ...health.get(String(c._id)) })),
  })
})

dashboardRouter.get('/needs-attention', async (req, res) => {
  const { mine } = dashSchema.parse(req.query)
  const auth = req.agencyAuth!
  const items = await agencyAttention(auth.agency._id, await accessibleClientIds(req), { _id: auth.user._id, mine })
  res.json({ total: items.length, items })
})

/** P136–P139 / D56: each person's load, and per department. */
dashboardRouter.get('/workload', async (req, res) => {
  const items = await teamWorkload(req.agencyAuth!.agency._id)
  const departments = [...new Set(items.flatMap((i) => i.departments))].sort()
  const byDepartment = departments.map((d) => {
    const people = items.filter((i) => i.departments.includes(d))
    const active = people.reduce((n, p) => n + p.activeTasks, 0)
    const capacity = people.reduce((n, p) => n + p.capacity, 0)
    return { department: d, people: people.length, activeTasks: active, capacity, load: capacity ? Math.round((active / capacity) * 100) : 0 }
  })
  res.json({ items, byDepartment })
})

// ── Calendar (D31, D32) ──────────────────────────────────────────────────────

const LAYERS = ['content', 'tasks', 'requests', 'plans', 'meetings'] as const
const MAX_RANGE_DAYS = 62

const rangeSchema = z.object({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  client: z.string().optional(),
  layers: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',').filter(Boolean) : [...LAYERS]))
    .pipe(z.array(z.enum(LAYERS))),
})

function parseRange(input: { from: string; to: string }) {
  const from = new Date(input.from)
  const to = new Date(input.to)
  if (to <= from || to.getTime() - from.getTime() > MAX_RANGE_DAYS * 86_400_000) {
    throw new AppError(400, 'invalid_input', `Pick a range of up to ${MAX_RANGE_DAYS} days.`)
  }
  return { from, to }
}

/** Date-only fields (task and request due dates) that fall in the range, as `YYYY-MM-DD` bounds. */
const dayBounds = (from: Date, to: Date) => ({ $gte: from.toISOString().slice(0, 10), $lte: to.toISOString().slice(0, 10) })

/** The agency's operational calendar: content publish dates, task and request due dates, plan months, with filters. */
calendarRouter.get('/', async (req, res) => {
  const f = rangeSchema.parse(req.query)
  const { from, to } = parseRange(f)
  const base: Record<string, unknown> = await scopeFilter(req, { softDelete: true, agencyLevel: false })
  if (f.client) base.$and = [{ client: objectId(f.client) }]
  const clientIds = await accessibleClientIds(req)
  const clients = await ClientModel.find({ agency: req.agencyAuth!.agency._id, deletedAt: null, ...(clientIds ? { _id: { $in: clientIds } } : {}) }, { brandName: 1, timezone: 1, contract: 1 }).lean()
  const brand = (id: Types.ObjectId) => clients.find((c) => String(c._id) === String(id))
  const events: Record<string, unknown>[] = []

  if (f.layers.includes('content')) {
    const rows = await ContentModel.find({ ...base, state: { $ne: 'cancelled' }, publishDate: { $gte: from, $lt: to } }, { title: 1, client: 1, state: 1, platform: 1, format: 1, publishDate: 1, sharedPublishDate: 1 }).lean()
    const failed = await PublishJobModel.find({ content: { $in: rows.map((r) => r._id) }, status: { $in: ['failed', 'unknown'] } }, { content: 1 }).lean()
    const now = Date.now()
    for (const c of rows) {
      const info = brand(c.client)
      const neededBy = c.publishDate!.getTime() - (info?.contract?.approvalLeadHours ?? 24) * 3_600_000
      const decided = ['approved', 'scheduled', 'publishing', 'published'].includes(c.state)
      events.push({
        layer: 'content',
        id: c._id,
        title: c.title,
        client: { id: c.client, brandName: info?.brandName },
        at: c.publishDate,
        allDay: false,
        state: c.state,
        platform: c.platform,
        format: c.format,
        // D29: agency-only risk indicators.
        risk: {
          atRisk: !decided && neededBy > now && neededBy - now < 3 * 86_400_000,
          overdueForApproval: !decided && neededBy <= now,
          slotMissed: c.publishDate!.getTime() <= now && !['scheduled', 'publishing', 'published'].includes(c.state),
          publishFailed: failed.some((j) => String(j.content) === String(c._id)),
        },
        link: `/app/content/${c._id}`,
      })
    }
  }
  if (f.layers.includes('tasks')) {
    const rows = await TaskModel.find({ ...base, status: { $ne: 'cancelled' }, due: dayBounds(from, to) }, { title: 1, client: 1, status: 1, due: 1, owner: 1, blocked: 1 }).lean()
    for (const t of rows) {
      events.push({ layer: 'tasks', id: t._id, title: t.title, client: { id: t.client, brandName: brand(t.client)?.brandName }, date: t.due, allDay: true, status: t.status, owner: t.owner, blocked: !!(t.blocked?.manual || t.blocked?.byDependency), link: `/app/tasks/${t._id}` })
    }
  }
  if (f.layers.includes('requests')) {
    const rows = await RequestModel.find({ ...base, status: { $in: ['open', 'submitted'] }, due: dayBounds(from, to) }, { title: 1, client: 1, status: 1, due: 1 }).lean()
    for (const r of rows) {
      events.push({ layer: 'requests', id: r._id, title: r.title, client: { id: r.client, brandName: brand(r.client)?.brandName }, date: r.due, allDay: true, status: r.status, link: `/app/requests/${r._id}` })
    }
  }
  if (f.layers.includes('meetings')) {
    const rows = await MeetingModel.find({ ...base, status: { $ne: 'cancelled' }, startAt: { $lt: to }, endAt: { $gt: from } }, { title: 1, client: 1, startAt: 1, endAt: 1, status: 1, platform: 1 }).lean()
    for (const m of rows) {
      events.push({ layer: 'meetings', id: m._id, title: m.title, client: { id: m.client, brandName: brand(m.client)?.brandName }, at: m.startAt, endAt: m.endAt, allDay: false, status: m.status, link: `/app/meetings/${m._id}` })
    }
  }
  if (f.layers.includes('plans')) {
    const months = [...new Set([from.toISOString().slice(0, 7), to.toISOString().slice(0, 7)])]
    const rows = await ContentPlanModel.find({ ...(await scopeFilter(req, { agencyLevel: false })), month: { $in: months }, ...(f.client ? { client: objectId(f.client) } : {}) }, { client: 1, month: 1, status: 1 }).lean()
    for (const p of rows) {
      events.push({ layer: 'plans', id: p._id, title: `${monthLabel(p.month)} plan`, client: { id: p.client, brandName: brand(p.client)?.brandName }, date: `${p.month}-01`, allDay: true, status: p.status, link: `/app/plans/${p._id}` })
    }
  }
  res.json({ from, to, events })
})

/**
 * The client's calendar (D31, D32): publish dates of content they can see, and due dates of open requests.
 * Meetings join in Phase 5. Shown in the client's timezone.
 */
clientCalendarRouter.get('/', async (req, res) => {
  const f = rangeSchema.pick({ from: true, to: true }).parse(req.query)
  const { from, to } = parseRange(f)
  const scope = await scopeFilter(req, { softDelete: true })
  const tz = req.clientAuth!.client.timezone
  const [content, requests, meetings] = await Promise.all([
    ContentModel.find({ ...scope, clientVisibleAt: { $ne: null }, state: { $nin: ['cancelled'] }, publishDate: { $gte: from, $lt: to } }, { title: 1, state: 1, platform: 1, format: 1, publishDate: 1, sharedPublishDate: 1 }).lean(),
    RequestModel.find({ ...scope, status: { $in: ['open', 'submitted'] }, due: dayBounds(from, to) }, { title: 1, status: 1, due: 1 }).lean(),
    MeetingModel.find({ ...scope, status: { $ne: 'cancelled' }, startAt: { $lt: to }, endAt: { $gt: from } }, { title: 1, startAt: 1, endAt: 1, joinUrl: 1 }).lean(),
  ])
  res.json({
    timezone: tz,
    events: [
      ...content.map((c) => ({
        layer: 'content',
        id: c._id,
        title: c.title,
        at: c.publishDate,
        date: dateIn(c.publishDate!, tz),
        status: clientStatus(c.state),
        platform: c.platform,
        shiftedDays: shiftedDays(c, tz),
        link: `/c/content/${c._id}`,
      })),
      ...meetings.map((m) => ({ layer: 'meetings', id: m._id, title: m.title, at: m.startAt, endAt: m.endAt, date: dateIn(m.startAt, tz), joinUrl: m.joinUrl, link: `/c/meetings/${m._id}` })),
      ...requests.map((r) => ({ layer: 'requests', id: r._id, title: r.title, date: r.due, allDay: true, label: r.status === 'open' ? 'Needed' : 'Submitted', link: `/c/requests/${r._id}` })),
    ],
  })
})

// ── Client Home (F11–F15, D50) ───────────────────────────────────────────────

/** Greeting → Banner → one merged Needs Attention list (sorted by due) → Next meeting → Upcoming content. */
clientHomeRouter.get('/', async (req, res) => {
  const auth = req.clientAuth!
  const scope = await scopeFilter(req, { softDelete: true })
  const tz = auth.client.timezone
  const now = new Date()
  const client = await ClientModel.findById(auth.client._id, { contract: 1 }).lean()
  const lead = (client?.contract?.approvalLeadHours ?? 24) * 3_600_000

  const [banners, reviews, plans, requests, upcoming, nextMeeting] = await Promise.all([
    BannerModel.find({ ...liveFilter(now), client: auth.client._id }, { headline: 1, text: 1, cta: 1, image: 1, endAt: 1 }).sort({ order: 1, startAt: -1 }).limit(5).lean(),
    ContentModel.find({ ...scope, state: 'client_review' }, { title: 1, platform: 1, stateChangedAt: 1, publishDate: 1 }).lean(),
    ContentPlanModel.find({ ...scope, status: 'sent' }, { month: 1, sentAt: 1 }).lean(),
    // Only people who can upload are asked for things; viewers just see them in Needed From You.
    clientCan(auth.role, 'upload') ? RequestModel.find({ ...scope, status: 'open' }, { title: 1, due: 1, priority: 1 }).lean() : [],
    ContentModel.find({ ...scope, clientVisibleAt: { $ne: null }, state: { $in: ['approved', 'scheduled', 'publishing'] }, publishDate: { $gte: now } }, { title: 1, platform: 1, format: 1, publishDate: 1, state: 1 })
      .sort({ publishDate: 1 })
      .limit(5)
      .lean(),
    MeetingModel.findOne({ ...scope, status: 'scheduled', endAt: { $gte: now } }, { title: 1, startAt: 1, endAt: 1, platform: 1, joinUrl: 1 }).sort({ startAt: 1 }).lean(),
  ])

  // Reviews and plan approvals only for people who can decide; contributors still see reviews (they can comment).
  const canComment = clientCan(auth.role, 'feedback')
  const today = todayIn(tz)
  const attention = [
    ...(canComment
      ? reviews.map((c) => ({
          kind: 'review',
          id: c._id,
          title: c.title,
          label: 'Review Required',
          detail: c.publishDate ? `Approval needed by ${new Date(c.publishDate.getTime() - lead).toISOString()}` : `Review pending since ${c.stateChangedAt.toISOString()}`,
          due: c.publishDate ? new Date(c.publishDate.getTime() - lead) : null,
          since: c.stateChangedAt,
          link: `/c/content/${c._id}`,
        }))
      : []),
    ...(canComment
      ? plans.map((p) => ({ kind: 'plan', id: p._id, title: `${monthLabel(p.month)} content plan`, label: 'Review Required', detail: '', due: null, since: p.sentAt, link: `/c/plans/${p._id}` }))
      : []),
    ...requests.map((r) => ({
      kind: 'request',
      id: r._id,
      title: r.title,
      label: 'Needed',
      detail: r.due ? (r.due < today ? `Overdue since ${r.due}` : `Due ${r.due}`) : '',
      due: r.due ? new Date(`${r.due}T23:59:59Z`) : null,
      since: null,
      link: `/c/requests/${r._id}`,
    })),
  ].sort((a, b) => (a.due?.getTime() ?? Infinity) - (b.due?.getTime() ?? Infinity) || (a.since?.getTime() ?? 0) - (b.since?.getTime() ?? 0))

  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(now))
  res.json({
    greeting: { name: auth.user.name.split(' ')[0], partOfDay: hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening' },
    banners,
    needsAttention: { total: attention.length, items: attention, allCaughtUp: attention.length === 0 },
    nextMeeting,
    upcomingContent: upcoming.map((c) => ({ ...c, status: clientStatus(c.state) })),
  })
})
