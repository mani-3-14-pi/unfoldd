import type { Types } from 'mongoose'
import { todayIn } from '../../lib/time.ts'
import { ClientModel } from '../clients/client.model.ts'
import { ContentModel } from '../content/content.model.ts'
import { PublishJobModel } from '../content/publishJob.model.ts'
import { ContentPlanModel } from '../plans/plan.model.ts'
import { RequestModel } from '../requests/request.model.ts'
import { TaskModel } from '../tasks/task.model.ts'
import { DEFAULT_CAPACITY, MembershipModel } from '../users/membership.model.ts'

/*
 * Phase 3: every count, list and badge here is computed live from source rows (D51, rule §12.12).
 * Nothing is stored, so nothing can drift.
 */

const DAY = 86_400_000
const RISK_DAYS = 3
const ONBOARDING_STUCK_DAYS = 14
const PRE_APPROVAL = ['planned', 'in_production', 'internal_review', 'ready_for_client', 'client_review', 'changes_requested'] as const
const UNSCHEDULED = [...PRE_APPROVAL, 'approved'] as const

type ClientInfo = { _id: Types.ObjectId; brandName: string; timezone: string; status: string; statusChangedAt?: Date | null; createdAt?: Date; contract?: { approvalLeadHours?: number } | null }

async function clientsById(ids: Types.ObjectId[] | null, agency: Types.ObjectId) {
  const clients = (await ClientModel.find(
    { agency, deletedAt: null, status: { $ne: 'archived' }, ...(ids ? { _id: { $in: ids } } : {}) },
    { brandName: 1, timezone: 1, status: 1, statusChangedAt: 1, createdAt: 1, contract: 1 },
  ).lean()) as ClientInfo[]
  return new Map(clients.map((c) => [String(c._id), c]))
}

/** "Needed by" = publish date − the client's approval lead time (§6.10). */
const neededBy = (publishDate: Date, client?: ClientInfo) => new Date(publishDate.getTime() - (client?.contract?.approvalLeadHours ?? 24) * 3_600_000)

export type AttentionKind =
  | 'overdue_for_approval'
  | 'at_risk'
  | 'slot_missed'
  | 'publish_failed'
  | 'changes_requested'
  | 'internal_review'
  | 'ready_for_client'
  | 'task_overdue'
  | 'task_blocked'
  | 'request_overdue'
  | 'request_submitted'

export interface AttentionItem {
  kind: AttentionKind
  severity: 'urgent' | 'high' | 'normal'
  entity: { type: 'content' | 'task' | 'request'; id: Types.ObjectId }
  title: string
  client: { id: Types.ObjectId; brandName: string }
  /** When it is (or was) due, for sorting. */
  at: Date | null
  link: string
}

const SEVERITY_ORDER = { urgent: 0, high: 1, normal: 2 }

/**
 * P07 Needs Attention for the agency, across the given clients (null = all of the agency's).
 * `me` narrows reviews and tasks to the person when `mine` is set.
 */
export async function agencyAttention(agency: Types.ObjectId, clientIds: Types.ObjectId[] | null, me: { _id: Types.ObjectId; mine: boolean }) {
  const clients = await clientsById(clientIds, agency)
  const ids = [...clients.values()].map((c) => c._id)
  const now = new Date()
  const items: AttentionItem[] = []
  const client = (id: Types.ObjectId) => {
    const c = clients.get(String(id))!
    return { id: c._id, brandName: c.brandName }
  }
  const scope = { agency, client: { $in: ids }, deletedAt: null }

  const [dated, changes, reviews, ready, failedJobs, tasks, requests] = await Promise.all([
    ContentModel.find({ ...scope, state: { $in: UNSCHEDULED }, publishDate: { $ne: null, $lte: new Date(now.getTime() + 60 * DAY) } }, { title: 1, client: 1, state: 1, publishDate: 1 }).lean(),
    ContentModel.find({ ...scope, state: 'changes_requested' }, { title: 1, client: 1, stateChangedAt: 1 }).lean(),
    ContentModel.find({ ...scope, state: 'internal_review', ...(me.mine ? { reviewer: me._id } : {}) }, { title: 1, client: 1, stateChangedAt: 1 }).lean(),
    ContentModel.find({ ...scope, state: 'ready_for_client', sendAt: null }, { title: 1, client: 1, stateChangedAt: 1 }).lean(),
    PublishJobModel.find({ agency, client: { $in: ids }, status: { $in: ['failed', 'unknown'] } }, { content: 1, client: 1, status: 1, updatedAt: 1 }).lean(),
    TaskModel.find(
      { ...scope, status: { $in: ['todo', 'in_progress', 'in_review'] }, ...(me.mine ? { $or: [{ owner: me._id }, { collaborators: me._id }] } : {}) },
      { title: 1, client: 1, due: 1, blocked: 1 },
    ).lean(),
    RequestModel.find({ ...scope, status: { $in: ['open', 'submitted'] } }, { title: 1, client: 1, due: 1, status: 1, submittedAt: 1 }).lean(),
  ])

  for (const c of dated) {
    const info = clients.get(String(c.client))
    const nb = neededBy(c.publishDate!, info)
    const link = `/app/content/${c._id}`
    const entity = { type: 'content' as const, id: c._id }
    if (c.publishDate! <= now) items.push({ kind: 'slot_missed', severity: 'urgent', entity, title: c.title, client: client(c.client), at: c.publishDate!, link })
    else if (c.state !== 'approved' && nb <= now) items.push({ kind: 'overdue_for_approval', severity: 'urgent', entity, title: c.title, client: client(c.client), at: nb, link })
    else if (c.state !== 'approved' && nb.getTime() - now.getTime() < RISK_DAYS * DAY) items.push({ kind: 'at_risk', severity: 'high', entity, title: c.title, client: client(c.client), at: nb, link })
  }
  if (failedJobs.length) {
    const titles = await ContentModel.find({ _id: { $in: failedJobs.map((j) => j.content) } }, { title: 1 }).lean()
    for (const j of failedJobs) {
      const t = titles.find((x) => String(x._id) === String(j.content))
      if (t) items.push({ kind: 'publish_failed', severity: 'urgent', entity: { type: 'content', id: j.content }, title: t.title, client: client(j.client), at: j.updatedAt, link: `/app/content/${j.content}` })
    }
  }
  for (const c of changes) items.push({ kind: 'changes_requested', severity: 'high', entity: { type: 'content', id: c._id }, title: c.title, client: client(c.client), at: c.stateChangedAt, link: `/app/content/${c._id}` })
  for (const c of reviews) items.push({ kind: 'internal_review', severity: 'normal', entity: { type: 'content', id: c._id }, title: c.title, client: client(c.client), at: c.stateChangedAt, link: `/app/content/${c._id}` })
  for (const c of ready) items.push({ kind: 'ready_for_client', severity: 'normal', entity: { type: 'content', id: c._id }, title: c.title, client: client(c.client), at: c.stateChangedAt, link: `/app/content/${c._id}` })
  for (const t of tasks) {
    const today = todayIn(clients.get(String(t.client))!.timezone)
    const entity = { type: 'task' as const, id: t._id }
    if (t.due && t.due < today) items.push({ kind: 'task_overdue', severity: 'high', entity, title: t.title, client: client(t.client), at: new Date(`${t.due}T00:00:00Z`), link: `/app/tasks/${t._id}` })
    else if (t.blocked?.manual || t.blocked?.byDependency) items.push({ kind: 'task_blocked', severity: 'normal', entity, title: t.title, client: client(t.client), at: t.due ? new Date(`${t.due}T00:00:00Z`) : null, link: `/app/tasks/${t._id}` })
  }
  for (const r of requests) {
    const today = todayIn(clients.get(String(r.client))!.timezone)
    const entity = { type: 'request' as const, id: r._id }
    if (r.status === 'submitted') items.push({ kind: 'request_submitted', severity: 'normal', entity, title: r.title, client: client(r.client), at: r.submittedAt ?? null, link: `/app/requests/${r._id}` })
    else if (r.due && r.due < today) items.push({ kind: 'request_overdue', severity: 'high', entity, title: r.title, client: client(r.client), at: new Date(`${r.due}T00:00:00Z`), link: `/app/requests/${r._id}` })
  }

  return items.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (a.at?.getTime() ?? Infinity) - (b.at?.getTime() ?? Infinity))
}

export type Health = 'blocked' | 'needs_attention' | 'on_track'

/**
 * D69 client health. Blocked: work waits on an overdue client request. Needs attention: overdue tasks, an approval
 * past "needed by", a publish failure or missed slot, or onboarding stuck for more than 14 days. Else on track.
 */
export async function clientHealth(agency: Types.ObjectId, clientIds: Types.ObjectId[] | null) {
  const clients = await clientsById(clientIds, agency)
  const ids = [...clients.values()].map((c) => c._id)
  const now = new Date()
  const scope = { agency, client: { $in: ids }, deletedAt: null }
  const [requests, tasks, dated, failed] = await Promise.all([
    RequestModel.find({ ...scope, status: 'open', due: { $ne: '' } }, { client: 1, due: 1 }).lean(),
    TaskModel.find({ ...scope, status: { $in: ['todo', 'in_progress', 'in_review'] } }, { client: 1, due: 1, dependencies: 1 }).lean(),
    ContentModel.find({ ...scope, state: { $in: UNSCHEDULED }, publishDate: { $ne: null, $lte: new Date(now.getTime() + 30 * DAY) } }, { client: 1, state: 1, publishDate: 1 }).lean(),
    PublishJobModel.distinct('client', { agency, client: { $in: ids }, status: { $in: ['failed', 'unknown'] } }),
  ])

  const result = new Map<string, { health: Health; reasons: string[] }>()
  for (const c of clients.values()) {
    const key = String(c._id)
    const today = todayIn(c.timezone)
    const overdueRequests = new Set(requests.filter((r) => String(r.client) === key && r.due < today).map((r) => String(r._id)))
    const myTasks = tasks.filter((t) => String(t.client) === key)
    if (myTasks.some((t) => t.dependencies.some((d) => d.type === 'request' && overdueRequests.has(String(d.id))))) {
      result.set(key, { health: 'blocked', reasons: ['Work is waiting on an overdue request'] })
      continue
    }
    const reasons: string[] = []
    if (myTasks.some((t) => t.due && t.due < today)) reasons.push('Overdue tasks')
    const mine = dated.filter((d) => String(d.client) === key)
    if (mine.some((d) => d.state !== 'approved' && neededBy(d.publishDate!, c) <= now)) reasons.push('Approval past its needed-by date')
    if (mine.some((d) => d.publishDate! <= now)) reasons.push('Missed publish slot')
    if (failed.some((f: Types.ObjectId) => String(f) === key)) reasons.push('Publishing failed')
    const since = c.statusChangedAt ?? c.createdAt
    if (c.status === 'onboarding' && since && now.getTime() - since.getTime() > ONBOARDING_STUCK_DAYS * DAY) reasons.push('Onboarding stuck for over 14 days')
    result.set(key, { health: reasons.length ? 'needs_attention' : 'on_track', reasons })
  }
  return result
}

/** P09 / D56: active tasks against capacity. Available < 80% ≤ At capacity ≤ 100% < Overloaded. */
export async function teamWorkload(agency: Types.ObjectId) {
  const [members, counts] = await Promise.all([
    MembershipModel.find({ agency, status: 'active' }, { user: 1, role: 1, capacity: 1, titles: 1, departments: 1 }).populate<{ user: { _id: Types.ObjectId; name: string } }>('user', 'name').lean(),
    TaskModel.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { agency, deletedAt: null, status: { $in: ['todo', 'in_progress', 'in_review'] }, owner: { $ne: null } } },
      { $group: { _id: '$owner', n: { $sum: 1 } } },
    ]),
  ])
  return members
    .filter((m) => m.user)
    .map((m) => {
      const active = counts.find((c) => String(c._id) === String(m.user._id))?.n ?? 0
      // Memberships stored before these fields existed have none; lean reads skip schema defaults.
      const capacity = m.capacity || DEFAULT_CAPACITY
      const load = active / capacity
      return {
        user: m.user,
        role: m.role,
        titles: m.titles ?? [],
        departments: m.departments ?? [],
        activeTasks: active,
        capacity,
        load: Math.round(load * 100),
        status: load < 0.8 ? 'available' : load <= 1 ? 'at_capacity' : 'overloaded',
      }
    })
    .sort((a, b) => b.load - a.load)
}

/** P06 overview numbers, mapped as in §6.3. */
export async function overviewMetrics(agency: Types.ObjectId, clientIds: Types.ObjectId[] | null, attention: AttentionItem[]) {
  const scope: Record<string, unknown> = { agency, deletedAt: null, ...(clientIds ? { client: { $in: clientIds } } : {}) }
  const [states, plansSent] = await Promise.all([
    ContentModel.aggregate<{ _id: string; n: number }>([{ $match: scope }, { $group: { _id: '$state', n: { $sum: 1 } } }]),
    ContentPlanModel.countDocuments({ agency, status: 'sent', ...(clientIds ? { client: { $in: clientIds } } : {}) }),
  ])
  const n = (...s: string[]) => states.filter((x) => s.includes(x._id)).reduce((a, b) => a + b.n, 0)
  return {
    awaitingReview: n('internal_review', 'ready_for_client'),
    awaitingApproval: n('client_review') + plansSent,
    changesRequested: n('changes_requested'),
    inProduction: n('in_production'),
    readyToSchedule: n('approved'),
    scheduled: n('scheduled', 'publishing'),
    overdue: attention.filter((a) => a.kind === 'task_overdue' || a.kind === 'overdue_for_approval').length,
  }
}
