import { Router, type Request } from 'express'
import type { Types } from 'mongoose'
import { z } from 'zod'
import { diff, logActivity } from '../../lib/activity.ts'
import { transition, updateWithRev } from '../../lib/concurrency.ts'
import { objectId } from '../../lib/ids.ts'
import { notify } from '../../lib/notify.ts'
import { csvEnum, pageQuery, paginate } from '../../lib/pagination.ts'
import { loadClient, scopeFilter } from '../../lib/scope.ts'
import { dateOnlySchema } from '../../lib/time.ts'
import { idempotent } from '../../middleware/idempotency.ts'
import { AppError, invalid, notFound } from '../../utils/AppError.ts'
import { CampaignModel } from '../campaigns/campaign.model.ts'
import { ClientMemberModel } from '../clients/clientMember.model.ts'
import { ContentModel } from '../content/content.model.ts'
import { RequestModel } from '../requests/request.model.ts'
import { TaskModel } from '../tasks/task.model.ts'
import { MembershipModel } from '../users/membership.model.ts'
import { MEETING_PLATFORMS, MEETING_STATUSES, MEETING_TRANSITIONS, MeetingModel, type Meeting } from './meeting.model.ts'

/** Meetings (Flow 10): agency side, and the client's view without the transcript (D23). */
export const meetingsRouter = Router()
export const clientMeetingsRouter = Router()

type MeetingDoc = Meeting & { _id: Types.ObjectId }

async function load(req: Request, id: unknown, need: 'read' | 'write' = 'read') {
  const m = await MeetingModel.findOne({ ...(await scopeFilter(req, { softDelete: true, agencyLevel: false })), _id: objectId(id, 'Meeting not found.') }).lean()
  if (!m) throw notFound('Meeting not found.')
  if (need === 'write') await loadClient(req, m.client, 'write')
  return m as MeetingDoc
}

async function participants(req: Request, client: Types.ObjectId, input: { agency?: string[]; client?: string[] }) {
  const agencyIds = (input.agency ?? []).map((id) => objectId(id))
  const clientIds = (input.client ?? []).map((id) => objectId(id))
  const [a, c] = await Promise.all([
    MembershipModel.countDocuments({ agency: req.agencyAuth!.agency._id, user: { $in: agencyIds }, status: 'active' }),
    ClientMemberModel.countDocuments({ client, user: { $in: clientIds }, status: 'active' }),
  ])
  if (a !== new Set(agencyIds.map(String)).size) throw invalid('participants', 'Pick people on your team')
  if (c !== new Set(clientIds.map(String)).size) throw invalid('participants', 'Pick people from this client')
  return { agency: agencyIds, client: clientIds }
}

async function related(client: Types.ObjectId, input: { campaign?: string | null; content?: string[] }) {
  const out: Record<string, unknown> = {}
  if (input.campaign !== undefined) {
    out.campaign = input.campaign ? (await CampaignModel.findOne({ _id: objectId(input.campaign), client }, { _id: 1 }).lean())?._id ?? null : null
    if (input.campaign && !out.campaign) throw invalid('campaign', 'Pick a campaign of this client')
  }
  if (input.content) {
    const ids = input.content.map((id) => objectId(id))
    if ((await ContentModel.countDocuments({ _id: { $in: ids }, client })) !== ids.length) throw invalid('content', 'Pick content of this client')
    out.content = ids
  }
  return out
}

const tellClient = (m: MeetingDoc, title: string, body = '', urgent = false) =>
  notify({
    recipients: m.participants!.client,
    audience: 'client',
    agency: m.agency,
    client: m.client,
    category: 'meetings',
    event: 'meeting.updated',
    title,
    body,
    entity: { type: 'meeting', id: m._id },
    link: `/c/meetings/${m._id}`,
    urgent,
  })

const listSchema = z.object({
  ...pageQuery,
  client: z.string().optional(),
  status: csvEnum(MEETING_STATUSES),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
})

meetingsRouter.get('/', async (req, res) => {
  const f = listSchema.parse(req.query)
  const filter: Record<string, unknown> = await scopeFilter(req, { softDelete: true, agencyLevel: false })
  if (f.client) filter.$and = [{ client: objectId(f.client) }]
  if (f.status.length) filter.status = { $in: f.status }
  if (f.from || f.to) filter.startAt = { ...(f.from ? { $gte: new Date(f.from) } : {}), ...(f.to ? { $lt: new Date(f.to) } : {}) }
  res.json(await paginate(MeetingModel, filter, { page: f.page, pageSize: f.pageSize, sort: { startAt: 1 } }))
})

const fieldsSchema = z.object({
  title: z.string().trim().min(1, 'Name the meeting').max(200),
  startAt: z.iso.datetime(),
  endAt: z.iso.datetime(),
  platform: z.enum(MEETING_PLATFORMS).optional(),
  joinUrl: z.union([z.url().max(1000), z.literal('')]).optional(),
  location: z.string().max(300).optional(),
  agenda: z.string().max(10_000).optional(),
  participants: z.object({ agency: z.array(z.string()).max(50).optional(), client: z.array(z.string()).max(50).optional() }).optional(),
  campaign: z.string().nullable().optional(),
  content: z.array(z.string()).max(50).optional(),
})

function times(startAt?: string, endAt?: string) {
  if (!startAt || !endAt) return {}
  const s = new Date(startAt)
  const e = new Date(endAt)
  if (e <= s) throw invalid('endAt', 'Ends before it starts')
  return { startAt: s, endAt: e }
}

meetingsRouter.post('/', idempotent(), async (req, res) => {
  const input = fieldsSchema.extend({ client: z.string() }).parse(req.body)
  const auth = req.agencyAuth!
  const client = await loadClient(req, objectId(input.client, 'Client not found.'), 'write')
  const people = await participants(req, client._id, { agency: input.participants?.agency ?? [String(auth.user._id)], client: input.participants?.client })
  const meeting = await MeetingModel.create({
    agency: auth.agency._id,
    client: client._id,
    title: input.title,
    ...times(input.startAt, input.endAt),
    platform: input.platform,
    joinUrl: input.joinUrl ?? '',
    location: input.location ?? '',
    agenda: input.agenda ?? '',
    participants: people,
    ...(await related(client._id, input)),
    createdBy: auth.user._id,
    updatedBy: { id: auth.user._id, name: auth.user.name },
  })
  await logActivity(req, {
    action: 'meeting.scheduled',
    message: `${auth.user.name} scheduled “${meeting.title}”`,
    agency: auth.agency._id,
    client: client._id,
    visibility: 'client',
    target: { type: 'meeting', id: meeting._id, label: meeting.title },
  })
  await tellClient(meeting.toObject() as MeetingDoc, `Meeting scheduled: ${meeting.title}`, meeting.startAt.toISOString())
  res.status(201).json({ meeting })
})

meetingsRouter.get('/:id', async (req, res) => {
  res.json({ meeting: await load(req, req.params.id) })
})

const EDITABLE = ['title', 'startAt', 'endAt', 'platform', 'joinUrl', 'location', 'agenda', 'participants', 'campaign', 'content'] as const

meetingsRouter.patch('/:id', async (req, res) => {
  const { rev, participants: people, campaign, content, startAt, endAt, ...rest } = fieldsSchema.partial().extend({ rev: z.number().int().min(1) }).parse(req.body)
  const m = await load(req, req.params.id, 'write')
  if (m.status !== 'scheduled') throw new AppError(409, 'invalid_state', `This meeting is ${m.status}, so it can’t be changed.`)
  const set: Record<string, unknown> = {
    ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)),
    ...times(startAt ?? m.startAt.toISOString(), endAt ?? m.endAt.toISOString()),
    ...(await related(m.client, { campaign, content })),
  }
  if (people) set.participants = await participants(req, m.client, { agency: people.agency ?? m.participants!.agency.map(String), client: people.client ?? m.participants!.client.map(String) })
  if (set.startAt && String(set.startAt) !== String(m.startAt)) set.reminderSentAt = null
  const updated = await updateWithRev(MeetingModel, { _id: m._id, agency: m.agency }, rev, set, req.agencyAuth!.user)
  const changes = diff(m, updated.toObject(), [...EDITABLE])
  if (changes?.after.startAt) await tellClient(updated.toObject() as MeetingDoc, `Meeting moved: ${updated.title}`, updated.startAt.toISOString())
  res.json({ meeting: updated })
})

meetingsRouter.post('/:id/:action', async (req, res, next) => {
  const action = req.params.action
  if (!['complete', 'cancel'].includes(action)) return next()
  const m = await load(req, req.params.id, 'write')
  const updated = await transition(MeetingModel, { _id: m._id, agency: m.agency }, MEETING_TRANSITIONS[action as 'complete' | 'cancel'], { label: 'meeting' })
  await logActivity(req, {
    action: `meeting.${action === 'complete' ? 'completed' : 'cancelled'}`,
    message: `${req.agencyAuth!.user.name} ${action === 'complete' ? 'marked' : 'cancelled'} “${m.title}”${action === 'complete' ? ' as done' : ''}`,
    agency: m.agency,
    client: m.client,
    visibility: 'client',
    target: { type: 'meeting', id: m._id, label: m.title },
  })
  if (action === 'cancel') await tellClient(m, `Meeting cancelled: ${m.title}`, '', true)
  res.json({ meeting: updated })
})

/** The transcript is pasted or uploaded by the agency and stays internal (D23). */
meetingsRouter.put('/:id/transcript', async (req, res) => {
  const { transcript } = z.object({ transcript: z.string().max(500_000) }).parse(req.body)
  const m = await load(req, req.params.id, 'write')
  const updated = await MeetingModel.findOneAndUpdate({ _id: m._id }, { $set: { transcript } }, { returnDocument: 'after' }).lean()
  res.json({ meeting: updated })
})

const summarySchema = z.object({
  text: z.string().max(20_000).default(''),
  decisions: z.array(z.string().trim().min(1).max(1000)).max(50).default([]),
  actionItems: z
    .array(z.object({ text: z.string().trim().min(1).max(500), side: z.enum(['agency', 'client']), assignee: z.string().nullable().optional(), due: z.union([dateOnlySchema, z.literal('')]).default('') }))
    .max(50)
    .default([]),
})

/** Drafts the summary. Once shared it's locked, so the client never sees it change underneath them. */
meetingsRouter.put('/:id/summary', async (req, res) => {
  const input = summarySchema.parse(req.body)
  const m = await load(req, req.params.id, 'write')
  if (m.summary?.status === 'shared') throw new AppError(409, 'already_shared', 'This summary was already shared.')
  const agencyAssignees = input.actionItems.filter((a) => a.side === 'agency' && a.assignee).map((a) => objectId(a.assignee))
  if ((await MembershipModel.countDocuments({ agency: m.agency, user: { $in: agencyAssignees }, status: 'active' })) !== new Set(agencyAssignees.map(String)).size) {
    throw invalid('actionItems', 'Assign agency items to people on your team')
  }
  const updated = await MeetingModel.findOneAndUpdate(
    { _id: m._id, 'summary.status': 'draft' },
    { $set: { 'summary.text': input.text, 'summary.decisions': input.decisions, 'summary.actionItems': input.actionItems.map((a) => ({ ...a, assignee: a.assignee ? objectId(a.assignee) : null })) } },
    { returnDocument: 'after' },
  ).lean()
  if (!updated) throw new AppError(409, 'already_shared', 'This summary was already shared.')
  res.json({ meeting: updated })
})

/**
 * Share the summary with the client (D23, D24): agency action items become tasks and client ones requests,
 * each exactly once. The client is notified.
 */
meetingsRouter.post('/:id/share', idempotent(), async (req, res) => {
  const m = await load(req, req.params.id, 'write')
  const me = req.agencyAuth!.user
  const shared = await MeetingModel.findOneAndUpdate(
    { _id: m._id, 'summary.status': 'draft' },
    { $set: { 'summary.status': 'shared', 'summary.sharedAt': new Date(), 'summary.sharedBy': { id: me._id, name: me.name } } },
    { returnDocument: 'after' },
  )
  if (!shared) throw new AppError(409, 'already_shared', 'This summary was already shared.')

  for (const item of shared.summary!.actionItems) {
    if (item.side === 'agency' && !item.task) {
      const task = await TaskModel.create({
        agency: m.agency,
        client: m.client,
        meeting: m._id,
        source: 'meeting',
        title: item.text,
        description: `Action item from “${m.title}”.`,
        owner: item.assignee ?? me._id,
        due: item.due,
        createdBy: me._id,
        updatedBy: { id: me._id, name: me.name },
      })
      item.task = task._id
    }
    if (item.side === 'client' && !item.request) {
      const request = await RequestModel.create({
        agency: m.agency,
        client: m.client,
        source: 'meeting',
        title: item.text,
        description: `Action item from “${m.title}”.`,
        due: item.due,
        status: 'open',
        createdBy: me._id,
        updatedBy: { id: me._id, name: me.name },
      })
      item.request = request._id
    }
  }
  await shared.save()
  const e = await logActivity(req, {
    action: 'meeting.summary_shared',
    message: `${me.name} shared the summary of “${m.title}”`,
    agency: m.agency,
    client: m.client,
    visibility: 'client',
    target: { type: 'meeting', id: m._id, label: m.title },
  })
  const requests = shared.summary!.actionItems.filter((a) => a.side === 'client').length
  await notify({
    recipients: [...new Set([...m.participants!.client, ...(await ClientMemberModel.find({ client: m.client, role: 'admin', status: 'active' }, { user: 1 }).lean()).map((c) => c.user)].map(String))].map((id) => objectId(id)),
    audience: 'client',
    agency: m.agency,
    client: m.client,
    category: 'meetings',
    event: 'meeting.summary_shared',
    title: `Summary of “${m.title}”`,
    body: requests ? `${requests} item${requests === 1 ? '' : 's'} needed from you.` : '',
    entity: { type: 'meeting', id: m._id },
    link: `/c/meetings/${m._id}`,
    activity: e?._id,
  })
  res.json({ meeting: shared })
})

// ── Client ──────────────────────────────────────────────────────────────────

/** The client never sees the transcript; the summary only once shared (D23). */
function forClient(m: Record<string, any>) {
  const { transcript: _t, summary, createdBy: _c, updatedBy: _u, rev: _r, reminderSentAt: _rs, ...rest } = m
  return { ...rest, summary: summary?.status === 'shared' ? { text: summary.text, decisions: summary.decisions, actionItems: summary.actionItems.map(({ task: _x, ...a }: any) => a), sharedAt: summary.sharedAt } : null }
}

clientMeetingsRouter.get('/', async (req, res) => {
  const f = z.object({ when: z.enum(['upcoming', 'past']).default('upcoming') }).parse(req.query)
  const now = new Date()
  const filter = {
    ...(await scopeFilter(req, { softDelete: true })),
    ...(f.when === 'upcoming' ? { status: 'scheduled', endAt: { $gte: now } } : { $or: [{ status: 'completed' }, { endAt: { $lt: now } }] }),
  } as Record<string, unknown>
  const items = await MeetingModel.find(filter).sort({ startAt: f.when === 'upcoming' ? 1 : -1 }).limit(100).lean()
  res.json({ items: items.map(forClient) })
})

clientMeetingsRouter.get('/:id', async (req, res) => {
  const m = await MeetingModel.findOne({ ...(await scopeFilter(req, { softDelete: true })), _id: objectId(req.params.id, 'Meeting not found.') }).lean()
  if (!m) throw notFound('Meeting not found.')
  res.json({ meeting: forClient(m) })
})

/** D68: "Meeting in 15 min" goes out at once, to both sides. */
export async function remindMeetings() {
  for (;;) {
    const now = Date.now()
    const m = (await MeetingModel.findOneAndUpdate(
      { status: 'scheduled', deletedAt: null, reminderSentAt: null, startAt: { $gt: new Date(now), $lte: new Date(now + 15 * 60_000) } },
      { $set: { reminderSentAt: new Date() } },
      { returnDocument: 'after' },
    ).lean()) as MeetingDoc | null
    if (!m) return
    const base = { agency: m.agency, client: m.client, category: 'meetings' as const, event: 'meeting.soon', title: `Starting soon: ${m.title}`, body: m.joinUrl, entity: { type: 'meeting', id: m._id }, urgent: true }
    await notify({ ...base, recipients: m.participants!.agency, audience: 'agency', link: `/app/meetings/${m._id}` })
    await notify({ ...base, recipients: m.participants!.client, audience: 'client', link: `/c/meetings/${m._id}` })
  }
}
