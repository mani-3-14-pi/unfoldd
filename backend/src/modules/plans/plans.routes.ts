import { Router, type Request } from 'express'
import type { Types } from 'mongoose'
import { z } from 'zod'
import { logActivity } from '../../lib/activity.ts'
import { transition } from '../../lib/concurrency.ts'
import { objectId } from '../../lib/ids.ts'
import { notify } from '../../lib/notify.ts'
import { csvEnum, pageQuery, paginate } from '../../lib/pagination.ts'
import { clientCan, currentUser, isManagerPlus, loadClient, scopeFilter } from '../../lib/scope.ts'
import { idempotent } from '../../middleware/idempotency.ts'
import { AppError, forbidden, invalid, notFound } from '../../utils/AppError.ts'
import { endAutoBanner, upsertAutoBanner } from '../banners/banner.service.ts'
import { CampaignModel } from '../campaigns/campaign.model.ts'
import { ClientModel } from '../clients/client.model.ts'
import { clientPeople } from '../content/content.recipients.ts'
import { ContentModel, FORMATS, PLATFORMS } from '../content/content.model.ts'
import { buildMessage, messageInput } from '../feedback/feedback.service.ts'
import { MessageModel } from '../feedback/message.model.ts'
import { ThreadModel } from '../feedback/thread.model.ts'
import { MembershipModel } from '../users/membership.model.ts'
import { PLAN_STATUSES, PLAN_TRANSITIONS, ContentPlanModel, type ContentPlan } from './plan.model.ts'

/** Monthly content plans (Flow 4): agency planner and the client's plan review. */
export const plansRouter = Router()
export const clientPlansRouter = Router()

type PlanDoc = ContentPlan & { _id: Types.ObjectId; createdAt: Date }

const monthLabel = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const bannerKey = (plan: { _id: Types.ObjectId }) => `plan_sent:${plan._id}`

/** Plan items are content rows in this plan (D33). Cancelled ones drop off the plan. */
const planItems = (planId: Types.ObjectId, fields?: Record<string, 1>) =>
  ContentModel.find({ plan: planId, deletedAt: null, state: { $ne: 'cancelled' } }, fields).sort({ publishDate: 1, createdAt: 1 }).lean()

/** D34: an item changed (or added) after the plan was approved. */
const updatedSinceApproval = (plan: { status: string; decidedAt?: Date | null }, item: { planEditedAt?: Date | null }) =>
  plan.status === 'approved' && !!plan.decidedAt && !!item.planEditedAt && item.planEditedAt > plan.decidedAt

/** Threads on the plan, as one person may see them: submitted ones plus their own drafts. */
async function planThreads(planId: Types.ObjectId, viewer: Types.ObjectId) {
  const threads = await ThreadModel.find({
    'context.type': 'content_plan',
    'context.id': planId,
    deletedAt: null,
    $or: [{ submittedAt: { $ne: null } }, { 'author.id': viewer }],
  })
    .sort({ createdAt: 1 })
    .lean()
  const messages = await MessageModel.find({ thread: { $in: threads.map((t) => t._id) }, deletedAt: null }).sort({ createdAt: 1 }).lean()
  return threads.map((t) => ({ ...t, draft: !t.submittedAt, messages: messages.filter((m) => String(m.thread) === String(t._id)) }))
}

/** The agency people who should hear about a plan: whoever created it, the account manager, and managers with access. */
async function planWatchers(plan: PlanDoc) {
  const client = await ClientModel.findById(plan.client, { accountManager: 1 }).lean()
  return [plan.createdBy, client?.accountManager].filter(Boolean) as Types.ObjectId[]
}

// ── Agency planner ───────────────────────────────────────────────────────────

async function loadPlan(req: Request, id: unknown, need: 'read' | 'write' = 'read') {
  const plan = await ContentPlanModel.findOne({ ...(await scopeFilter(req, { agencyLevel: false })), _id: objectId(id, 'Plan not found.') }).lean()
  if (!plan) throw notFound('Plan not found.')
  if (need === 'write') await loadClient(req, plan.client, 'write')
  return plan as PlanDoc
}

const listSchema = z.object({ ...pageQuery, client: z.string().optional(), status: csvEnum(PLAN_STATUSES), month: z.string().regex(/^\d{4}-\d{2}$/).optional() })

plansRouter.get('/', async (req, res) => {
  const f = listSchema.parse(req.query)
  const filter: Record<string, unknown> = await scopeFilter(req, { agencyLevel: false })
  if (f.client) filter.$and = [{ client: objectId(f.client) }]
  if (f.status.length) filter.status = { $in: f.status }
  if (f.month) filter.month = f.month
  const page = await paginate(ContentPlanModel, filter, { page: f.page, pageSize: f.pageSize, sort: { month: -1 } })
  const counts = await ContentModel.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { plan: { $in: page.items.map((p) => p._id) }, deletedAt: null, state: { $ne: 'cancelled' } } },
    { $group: { _id: '$plan', n: { $sum: 1 } } },
  ])
  res.json({ ...page, items: page.items.map((p) => ({ ...p, itemCount: counts.find((c) => String(c._id) === String(p._id))?.n ?? 0 })) })
})

const createSchema = z.object({ client: z.string(), month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Pick a month'), note: z.string().max(2000).default('') })

plansRouter.post('/', idempotent(), async (req, res) => {
  const input = createSchema.parse(req.body)
  const auth = req.agencyAuth!
  if (!isManagerPlus(auth.role)) throw forbidden('Only a manager can create plans.')
  const client = await loadClient(req, objectId(input.client, 'Client not found.'), 'write')
  const exists = await ContentPlanModel.findOne({ client: client._id, month: input.month }, { _id: 1 }).lean()
  if (exists) throw new AppError(409, 'plan_exists', `There is already a plan for ${monthLabel(input.month)}.`, { planId: exists._id })
  const plan = await ContentPlanModel.create({ agency: auth.agency._id, client: client._id, month: input.month, note: input.note, createdBy: auth.user._id })
  await logActivity(req, {
    action: 'plan.created',
    message: `${auth.user.name} started the ${monthLabel(plan.month)} plan for ${client.brandName}`,
    agency: auth.agency._id,
    client: client._id,
    target: { type: 'content_plan', id: plan._id, label: plan.month },
  })
  res.status(201).json({ plan })
})

plansRouter.get('/:id', async (req, res) => {
  const plan = await loadPlan(req, req.params.id)
  const [items, threads] = await Promise.all([planItems(plan._id), planThreads(plan._id, req.agencyAuth!.user._id)])
  res.json({ plan: { ...plan, items: items.map((i) => ({ ...i, updatedSinceApproval: updatedSinceApproval(plan, i) })), threads } })
})

const itemSchema = z.object({
  title: z.string().trim().min(1).max(200),
  platform: z.enum(PLATFORMS),
  format: z.enum(FORMATS),
  idea: z.string().max(5000).default(''),
  concept: z.string().max(5000).default(''),
  objective: z.string().max(2000).default(''),
  /** The planned date (D28: the same publish_date the item keeps for life). */
  publishDate: z.iso.datetime().nullable().optional(),
  campaign: z.string().nullable().optional(),
  owner: z.string().nullable().optional(),
})

async function itemDoc(req: Request, plan: PlanDoc, input: z.infer<typeof itemSchema>) {
  const auth = req.agencyAuth!
  let campaign: Types.ObjectId | null = null
  if (input.campaign) {
    const c = await CampaignModel.findOne({ _id: objectId(input.campaign, 'Campaign not found.'), client: plan.client, deletedAt: null }, { _id: 1 }).lean()
    if (!c) throw invalid('campaign', 'Pick a campaign of this client')
    campaign = c._id
  }
  let owner: Types.ObjectId | null = auth.user._id
  if (input.owner !== undefined) {
    owner = input.owner ? objectId(input.owner) : null
    if (owner && !(await MembershipModel.exists({ agency: auth.agency._id, user: owner, status: 'active' }))) throw invalid('owner', 'Pick someone on your team')
  }
  const now = new Date()
  const shared = plan.status !== 'draft'
  return {
    agency: plan.agency,
    client: plan.client,
    plan: plan._id,
    campaign,
    title: input.title,
    platform: input.platform,
    format: input.format,
    idea: input.idea,
    concept: input.concept,
    objective: input.objective,
    publishDate: input.publishDate ? new Date(input.publishDate) : null,
    owner,
    state: 'planned' as const,
    planEditedAt: now,
    // Added to a plan the client already has: visible to them at once (D64).
    clientVisibleAt: shared ? now : null,
    sharedPublishDate: shared && input.publishDate ? new Date(input.publishDate) : null,
    createdBy: auth.user._id,
    updatedBy: { id: auth.user._id, name: auth.user.name },
  }
}

/** D34: an approved plan stays approved, but the client is told an item changed. */
export async function notifyPlanChanged(plan: { _id: Types.ObjectId; agency: Types.ObjectId; client: Types.ObjectId; month: string; status: string }, what: string) {
  if (plan.status !== 'approved') return
  await notify({
    recipients: await clientPeople(plan.client),
    audience: 'client',
    agency: plan.agency,
    client: plan.client,
    category: 'reviews',
    event: 'plan.updated_since_approval',
    title: `Your ${monthLabel(plan.month)} plan was updated`,
    body: what,
    entity: { type: 'content_plan', id: plan._id },
    link: `/c/plans/${plan._id}`,
  })
}

plansRouter.post('/:id/items', idempotent(), async (req, res) => {
  const input = itemSchema.parse(req.body)
  const plan = await loadPlan(req, req.params.id, 'write')
  const item = await ContentModel.create(await itemDoc(req, plan, input))
  await notifyPlanChanged(plan, `“${item.title}” was added.`)
  res.status(201).json({ item })
})

const bulkSchema = z.object({
  /** P40: e.g. 12 Instagram + 6 LinkedIn. */
  groups: z.array(z.object({ platform: z.enum(PLATFORMS), format: z.enum(FORMATS), count: z.number().int().min(1).max(60), title: z.string().trim().max(150).optional() })).min(1).max(10),
})

plansRouter.post('/:id/items/bulk', idempotent(), async (req, res) => {
  const { groups } = bulkSchema.parse(req.body)
  const plan = await loadPlan(req, req.params.id, 'write')
  const total = groups.reduce((n, g) => n + g.count, 0)
  if (total > 100) throw invalid('groups', 'Add at most 100 items at once')
  const docs = []
  for (const g of groups) {
    for (let i = 1; i <= g.count; i++) {
      docs.push(await itemDoc(req, plan, { title: `${g.title ?? `${g.platform} ${g.format.replace(/_/g, ' ')}`} ${i}`, platform: g.platform, format: g.format, idea: '', concept: '', objective: '' }))
    }
  }
  const items = await ContentModel.insertMany(docs)
  await logActivity(req, {
    action: 'plan.items_added',
    message: `${req.agencyAuth!.user.name} added ${items.length} items to the ${monthLabel(plan.month)} plan`,
    agency: plan.agency,
    client: plan.client,
    target: { type: 'content_plan', id: plan._id, label: plan.month },
  })
  await notifyPlanChanged(plan, `${items.length} items were added.`)
  res.status(201).json({ items })
})

/** Send for review (P41): items become visible to the client, with a banner and a notification (Flow 4, D52, D64). */
plansRouter.post('/:id/send', async (req, res) => {
  const plan = await loadPlan(req, req.params.id, 'write')
  const auth = req.agencyAuth!
  if (!isManagerPlus(auth.role)) throw forbidden('Only a manager can send a plan.')
  const items = await planItems(plan._id, { _id: 1, publishDate: 1 })
  if (!items.length) throw new AppError(409, 'empty_plan', 'Add items to the plan before sending it.')
  const now = new Date()
  const sent = await transition(ContentPlanModel, { _id: plan._id }, PLAN_TRANSITIONS.send, {
    label: 'plan',
    set: { statusChangedAt: now, sentAt: now, sentBy: { id: auth.user._id, name: auth.user.name }, decidedAt: null, decidedBy: null },
  })
  await ContentModel.updateMany({ plan: plan._id, clientVisibleAt: null }, { $set: { clientVisibleAt: now } })
  await ContentModel.updateMany({ plan: plan._id, sharedPublishDate: null, publishDate: { $ne: null } }, [{ $set: { sharedPublishDate: '$publishDate' } }], { updatePipeline: true })

  const label = monthLabel(plan.month)
  await upsertAutoBanner({
    agency: plan.agency,
    client: plan.client,
    key: bannerKey(plan),
    headline: `Your ${label} plan is ready`,
    text: `${items.length} piece${items.length === 1 ? '' : 's'} planned. Take a look and let us know what you think.`,
    cta: { label: 'Review plan', link: `/c/plans/${plan._id}` },
    endAt: new Date(now.getTime() + 14 * 86_400_000),
  })
  const e = await logActivity(req, {
    action: 'plan.sent',
    message: `${auth.user.name} sent the ${label} plan for review`,
    agency: plan.agency,
    client: plan.client,
    visibility: 'client',
    target: { type: 'content_plan', id: plan._id, label: plan.month },
  })
  await notify({
    recipients: await clientPeople(plan.client),
    audience: 'client',
    agency: plan.agency,
    client: plan.client,
    category: 'reviews',
    event: 'plan.review_required',
    title: `Review required: your ${label} plan`,
    body: `${items.length} pieces planned.`,
    entity: { type: 'content_plan', id: plan._id },
    link: `/c/plans/${plan._id}`,
    urgent: true,
    activity: e?._id,
  })
  res.json({ plan: sent })
})

plansRouter.post('/:id/threads/:threadId/messages', async (req, res) => {
  const plan = await loadPlan(req, req.params.id, 'write')
  res.status(201).json({ message: await planReply(req, plan, req.params.threadId, z.object(messageInput).parse(req.body)) })
})

const threadUpdate = z.object({ status: z.enum(['open', 'in_progress', 'resolved']), resolutionNote: z.string().trim().max(2000).default('') })

plansRouter.patch('/:id/threads/:threadId', async (req, res) => {
  const input = threadUpdate.parse(req.body)
  const plan = await loadPlan(req, req.params.id, 'write')
  const me = req.agencyAuth!.user
  const thread = await ThreadModel.findOneAndUpdate(
    { _id: objectId(req.params.threadId, 'Comment not found.'), 'context.type': 'content_plan', 'context.id': plan._id, submittedAt: { $ne: null } },
    {
      $set:
        input.status === 'resolved'
          ? { status: 'resolved', resolvedAt: new Date(), resolvedBy: { id: me._id, name: me.name }, resolutionNote: input.resolutionNote }
          : { status: input.status, resolvedAt: null },
    },
    { returnDocument: 'after' },
  )
  if (!thread) throw notFound('Comment not found.')
  res.json({ thread })
})

async function planReply(req: Request, plan: PlanDoc, threadId: unknown, input: z.infer<z.ZodObject<typeof messageInput>>) {
  const thread = await ThreadModel.findOne({ _id: objectId(threadId, 'Comment not found.'), 'context.type': 'content_plan', 'context.id': plan._id, deletedAt: null })
  if (!thread) throw notFound('Comment not found.')
  if (!thread.submittedAt) throw new AppError(409, 'draft', 'This comment is still a draft.')
  const now = new Date()
  const message = await MessageModel.create({ ...(await buildMessage(req, plan, input as any, 'client')), thread: thread._id, submittedAt: now })
  await ThreadModel.updateOne({ _id: thread._id }, { $inc: { messageCount: 1 }, $set: { lastMessageAt: now } })
  const me = currentUser(req)
  await notify({
    recipients: me.side === 'client' ? await planWatchers(plan) : ((await MessageModel.distinct('author.id', { thread: thread._id, 'author.side': 'client' })) as Types.ObjectId[]),
    audience: me.side === 'client' ? 'agency' : 'client',
    agency: plan.agency,
    client: plan.client,
    category: 'feedback',
    event: 'plan.replied',
    title: `${me.name} replied on the ${monthLabel(plan.month)} plan`,
    entity: { type: 'content_plan', id: plan._id },
    link: me.side === 'client' ? `/app/plans/${plan._id}` : `/c/plans/${plan._id}`,
    except: me._id,
  })
  return message
}

// ── Client review of the plan (F46–F47, D34, D80) ────────────────────────────

async function loadClientPlan(req: Request, id: unknown) {
  const plan = await ContentPlanModel.findOne({ ...(await scopeFilter(req)), _id: objectId(id, 'Plan not found.'), status: { $ne: 'draft' } }).lean()
  if (!plan) throw notFound('Plan not found.')
  return plan as PlanDoc
}

/** D63: anything awaiting the client's decision reads "Review Required". */
const clientPlanLabel = (status: string) => ({ sent: 'Review Required', approved: 'Approved', changes_requested: 'Changes Requested' })[status] ?? status

clientPlansRouter.get('/', async (req, res) => {
  const plans = await ContentPlanModel.find({ ...(await scopeFilter(req)), status: { $ne: 'draft' } }).sort({ month: -1 }).limit(36).lean()
  res.json({ items: plans.map((p) => ({ id: p._id, month: p.month, status: p.status, label: clientPlanLabel(p.status), sentAt: p.sentAt, decidedAt: p.decidedAt })) })
})

clientPlansRouter.get('/:id', async (req, res) => {
  const plan = await loadClientPlan(req, req.params.id)
  const auth = req.clientAuth!
  const [items, threads] = await Promise.all([
    planItems(plan._id, { title: 1, platform: 1, format: 1, idea: 1, concept: 1, objective: 1, publishDate: 1, campaign: 1, planEditedAt: 1, state: 1 }),
    planThreads(plan._id, auth.user._id),
  ])
  const campaigns = await CampaignModel.find({ _id: { $in: items.map((i) => i.campaign).filter(Boolean) } }, { name: 1 }).lean()
  res.json({
    plan: {
      id: plan._id,
      month: plan.month,
      status: plan.status,
      label: clientPlanLabel(plan.status),
      sentAt: plan.sentAt,
      decided: plan.decidedAt ? { by: plan.decidedBy?.name, at: plan.decidedAt } : null,
      items: items.map(({ planEditedAt: _p, campaign, state, ...i }) => ({
        ...i,
        inProduction: state !== 'planned',
        campaign: campaigns.find((c) => String(c._id) === String(campaign))?.name ?? null,
        updatedSinceApproval: updatedSinceApproval(plan, { planEditedAt: _p }),
      })),
      threads,
      can: { comment: ['sent', 'approved'].includes(plan.status) && clientCan(auth.role, 'feedback'), decide: plan.status === 'sent' && clientCan(auth.role, 'approve') },
    },
  })
})

const commentSchema = z.object({ item: z.string().optional(), ...messageInput })

/** A comment on the whole plan or on one item, saved as the caller's draft until they submit (D80, D14). */
clientPlansRouter.post('/:id/threads', idempotent(), async (req, res) => {
  const input = commentSchema.parse(req.body)
  const plan = await loadClientPlan(req, req.params.id)
  if (!clientCan(req.clientAuth!.role, 'feedback')) throw forbidden('Your role can view but not comment.')
  if (!['sent', 'approved'].includes(plan.status)) throw new AppError(409, 'not_in_review', 'This plan isn’t open for comments right now.')
  let item: Types.ObjectId | null = null
  if (input.item) {
    const c = await ContentModel.findOne({ _id: objectId(input.item, 'Item not found.'), plan: plan._id, deletedAt: null }, { _id: 1 }).lean()
    if (!c) throw notFound('Item not found.')
    item = c._id
  }
  const message = await buildMessage(req, plan, input as any, 'client')
  const thread = await ThreadModel.create({
    agency: plan.agency,
    client: plan.client,
    context: { type: 'content_plan', id: plan._id },
    content: item,
    kind: 'feedback',
    visibility: 'client',
    status: 'open',
    author: message.author,
    messageCount: 1,
    lastMessageAt: new Date(),
  })
  await MessageModel.create({ ...message, thread: thread._id, submittedAt: null })
  res.status(201).json({ thread })
})

clientPlansRouter.delete('/:id/threads/:threadId', async (req, res) => {
  const plan = await loadClientPlan(req, req.params.id)
  const done = await ThreadModel.updateOne(
    { _id: objectId(req.params.threadId, 'Draft not found.'), 'context.id': plan._id, 'author.id': req.clientAuth!.user._id, submittedAt: null, deletedAt: null },
    { $set: { deletedAt: new Date() } },
  )
  if (!done.matchedCount) throw notFound('Draft not found.')
  res.status(204).end()
})

clientPlansRouter.post('/:id/threads/:threadId/messages', async (req, res) => {
  const plan = await loadClientPlan(req, req.params.id)
  if (!clientCan(req.clientAuth!.role, 'feedback')) throw forbidden()
  res.status(201).json({ message: await planReply(req, plan, req.params.threadId, z.object(messageInput).parse(req.body)) })
})

/** Submits the caller's plan drafts. Returns how many. */
async function submitPlanDrafts(req: Request, plan: PlanDoc) {
  const me = req.clientAuth!.user._id
  const drafts = await ThreadModel.find({ 'context.type': 'content_plan', 'context.id': plan._id, 'author.id': me, submittedAt: null, deletedAt: null }, { _id: 1 }).lean()
  if (!drafts.length) return 0
  const now = new Date()
  const ids = drafts.map((d) => d._id)
  await ThreadModel.updateMany({ _id: { $in: ids } }, { $set: { submittedAt: now } })
  await MessageModel.updateMany({ thread: { $in: ids } }, { $set: { submittedAt: now } })
  return ids.length
}

clientPlansRouter.post('/:id/review/submit', async (req, res) => {
  const plan = await loadClientPlan(req, req.params.id)
  if (!clientCan(req.clientAuth!.role, 'feedback')) throw forbidden()
  const submitted = await submitPlanDrafts(req, plan)
  if (submitted) {
    await notify({
      recipients: await planWatchers(plan),
      audience: 'agency',
      agency: plan.agency,
      client: plan.client,
      category: 'feedback',
      event: 'plan.feedback',
      title: `${req.clientAuth!.user.name} commented on the ${monthLabel(plan.month)} plan`,
      entity: { type: 'content_plan', id: plan._id },
      link: `/app/plans/${plan._id}`,
    })
  }
  res.json({ submitted })
})

const decisionSchema = z.object({ expectedStatus: z.enum(PLAN_STATUSES), confirm: z.boolean().default(false), note: z.string().trim().max(2000).default('') })

async function decide(req: Request, plan: PlanDoc, decision: 'approve' | 'requestChanges', input: z.infer<typeof decisionSchema>) {
  const me = req.clientAuth!.user
  if (!clientCan(req.clientAuth!.role, 'approve')) throw forbidden('Only an admin or approver can decide on the plan.')
  if (plan.status !== input.expectedStatus && !input.confirm) {
    throw new AppError(409, 'decided_meanwhile', `${plan.decidedBy?.name ?? 'Someone'} already decided on this plan.`, {
      status: plan.status,
      decision: { by: plan.decidedBy?.name, at: plan.decidedAt },
    })
  }
  await submitPlanDrafts(req, plan)
  if (decision === 'requestChanges') {
    // D80: the agency must learn what to change.
    const comments = await ThreadModel.countDocuments({ 'context.type': 'content_plan', 'context.id': plan._id, submittedAt: { $gte: plan.sentAt ?? plan.createdAt }, status: { $ne: 'resolved' }, deletedAt: null })
    if (!comments) throw new AppError(400, 'feedback_required', 'Add at least one comment describing the changes you need.')
  }
  const now = new Date()
  const updated = await transition(ContentPlanModel, { _id: plan._id }, decision === 'approve' ? PLAN_TRANSITIONS.approve : PLAN_TRANSITIONS.requestChanges, {
    label: 'plan',
    set: { statusChangedAt: now, decidedAt: now, decidedBy: { id: me._id, name: me.name } },
  })
  await endAutoBanner(bannerKey(plan))
  const verb = decision === 'approve' ? 'approved' : 'requested changes on'
  const e = await logActivity(req, {
    action: decision === 'approve' ? 'plan.approved' : 'plan.changes_requested',
    message: `${me.name} ${verb} the ${monthLabel(plan.month)} plan`,
    agency: plan.agency,
    client: plan.client,
    visibility: 'client',
    target: { type: 'content_plan', id: plan._id, label: plan.month },
    meta: input.note ? { note: input.note } : undefined,
  })
  await notify({
    recipients: await planWatchers(plan),
    audience: 'agency',
    agency: plan.agency,
    client: plan.client,
    category: 'reviews',
    event: e?.action ?? 'plan.decided',
    title: `${me.name} ${verb} the ${monthLabel(plan.month)} plan`,
    body: input.note,
    entity: { type: 'content_plan', id: plan._id },
    link: `/app/plans/${plan._id}`,
    urgent: decision === 'requestChanges',
    activity: e?._id,
  })
  return updated
}

clientPlansRouter.post('/:id/approve', idempotent(), async (req, res) => {
  const plan = await loadClientPlan(req, req.params.id)
  res.json({ plan: await decide(req, plan, 'approve', decisionSchema.parse(req.body)) })
})

clientPlansRouter.post('/:id/request-changes', idempotent(), async (req, res) => {
  const plan = await loadClientPlan(req, req.params.id)
  res.json({ plan: await decide(req, plan, 'requestChanges', decisionSchema.parse(req.body)) })
})

export { monthLabel }
