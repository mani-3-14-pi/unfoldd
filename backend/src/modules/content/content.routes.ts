import { Router, type Request, type RequestHandler } from 'express'
import type { PipelineStage, Types } from 'mongoose'
import { z } from 'zod'
import { diff, logActivity } from '../../lib/activity.ts'
import { updateWithRev } from '../../lib/concurrency.ts'
import { objectId } from '../../lib/ids.ts'
import { csvEnum, escapeRegex, pageQuery, paginateAggregate } from '../../lib/pagination.ts'
import { loadClient, scopeFilter } from '../../lib/scope.ts'
import { dateOnlySchema } from '../../lib/time.ts'
import { idempotent } from '../../middleware/idempotency.ts'
import { AppError, forbidden, invalid, notFound } from '../../utils/AppError.ts'
import { AgencyAccessModel } from '../clients/agencyAccess.model.ts'
import { CampaignModel } from '../campaigns/campaign.model.ts'
import { ClientModel } from '../clients/client.model.ts'
import { ContentPlanModel } from '../plans/plan.model.ts'
import { notifyPlanChanged } from '../plans/plans.routes.ts'
import { generateTasks, loadTemplate } from '../templates/template.service.ts'
import { FileModel } from '../files/file.model.ts'
import { MembershipModel } from '../users/membership.model.ts'
import { approvalStatus, clientStatus, timing } from './content.derive.ts'
import { CONTENT_STATES, ContentModel, FORMATS, PLATFORMS, PRIORITIES } from './content.model.ts'
import * as svc from './content.service.ts'
import { PublishJobModel } from './publishJob.model.ts'
import { ReviewDecisionModel } from './reviewDecision.model.ts'
import { VersionModel } from './version.model.ts'

/** Agency side of content: the production hub, versions, review, send, schedule and publish (Flow 5, 8). */
export const contentRouter = Router()

/** A content item the caller can see; `write` also checks the client isn't archived. */
async function loadContent(req: Request, id: unknown, need: 'read' | 'write' = 'read') {
  const content = await ContentModel.findOne({ ...(await scopeFilter(req, { softDelete: true, agencyLevel: false })), _id: objectId(id, 'Content not found.') }).lean()
  if (!content) throw notFound('Content not found.')
  if (need === 'write') await loadClient(req, content.client, 'write')
  return content as svc.ContentDoc
}

/** People on the team with access to the client: valid owners, reviewers and collaborators. */
async function teamOnClient(req: Request, client: Types.ObjectId, ids: string[], field: string) {
  const oids = ids.map((id) => objectId(id))
  const [members, access] = await Promise.all([
    MembershipModel.find({ agency: req.agencyAuth!.agency._id, user: { $in: oids }, status: 'active' }, { user: 1, role: 1 }).lean(),
    AgencyAccessModel.find({ client, user: { $in: oids } }, { user: 1 }).lean(),
  ])
  const assigned = new Set(access.map((a) => String(a.user)))
  const ok = members.filter((m) => m.role === 'owner' || m.role === 'admin' || assigned.has(String(m.user)))
  if (ok.length !== new Set(ids).size) throw invalid(field, 'Pick someone with access to this client')
  return oids
}

async function present(content: svc.ContentDoc) {
  const [versions, decisions, job, client, used] = await Promise.all([
    VersionModel.find({ content: content._id }).sort({ number: -1 }).lean(),
    ReviewDecisionModel.find({ content: content._id }).sort({ createdAt: -1 }).lean(),
    PublishJobModel.findOne({ content: content._id }).sort({ createdAt: -1 }).lean(),
    ClientModel.findById(content.client, { name: 1, brandName: 1, timezone: 1, contract: 1 }).lean(),
    svc.revisionsUsed(content._id),
  ])
  const current = versions.find((v) => String(v._id) === String(content.currentVersion))
  const limit = content.revisionLimit ?? client?.contract?.revisionsIncluded ?? 2
  return {
    ...content,
    client,
    versions,
    decisions,
    publishJob: job,
    derived: {
      approvalStatus: approvalStatus(content.state, current),
      clientStatus: clientStatus(content.state, job?.status),
      revisions: { used, included: limit, over: used > limit },
      timing: timing(content, client?.contract?.approvalLeadHours ?? 24),
    },
  }
}

// ── Production hub ───────────────────────────────────────────────────────────

const SORTS = {
  newest: { createdAt: -1 },
  updated: { updatedAt: -1 },
  due: { due: 1 },
  publish_date: { publishDate: 1 },
  title: { title: 1 },
} as const

const listSchema = z.object({
  ...pageQuery,
  client: z.string().optional(),
  state: csvEnum(CONTENT_STATES),
  platform: csvEnum(PLATFORMS),
  owner: z.string().optional(),
  reviewer: z.string().optional(),
  mine: z.stringbool().optional(),
  publishFrom: z.iso.datetime().optional(),
  publishTo: z.iso.datetime().optional(),
  sort: z.enum(Object.keys(SORTS) as [keyof typeof SORTS]).default('updated'),
})

contentRouter.get('/', async (req, res) => {
  const f = listSchema.parse(req.query)
  const match: Record<string, unknown> = await scopeFilter(req, { softDelete: true, agencyLevel: false })
  const and: Record<string, unknown>[] = []
  if (f.client) and.push({ client: objectId(f.client) })
  if (f.state.length) match.state = { $in: f.state }
  else match.state = { $ne: 'cancelled' }
  if (f.platform.length) match.platform = { $in: f.platform }
  if (f.owner) match.owner = objectId(f.owner)
  if (f.reviewer) match.reviewer = objectId(f.reviewer)
  if (f.mine) {
    const me = req.agencyAuth!.user._id
    and.push({ $or: [{ owner: me }, { reviewer: me }, { collaborators: me }] })
  }
  if (f.publishFrom || f.publishTo) {
    match.publishDate = { ...(f.publishFrom ? { $gte: new Date(f.publishFrom) } : {}), ...(f.publishTo ? { $lte: new Date(f.publishTo) } : {}) }
  }
  if (f.q) and.push({ title: new RegExp(escapeRegex(f.q), 'i') })
  if (and.length) match.$and = and

  const pipeline: PipelineStage[] = [
    { $match: match },
    { $lookup: { from: 'clients', localField: 'client', foreignField: '_id', as: 'clientInfo', pipeline: [{ $project: { name: 1, brandName: 1 } }] } },
    { $lookup: { from: 'users', localField: 'owner', foreignField: '_id', as: 'ownerInfo', pipeline: [{ $project: { name: 1 } }] } },
    { $lookup: { from: 'versions', localField: 'currentVersion', foreignField: '_id', as: 'version', pipeline: [{ $project: { number: 1, sentToClientAt: 1, firstViewedAt: 1, files: { $slice: ['$files', 1] } } }] } },
    { $set: { clientInfo: { $first: '$clientInfo' }, ownerInfo: { $first: '$ownerInfo' }, version: { $first: '$version' } } },
    { $project: { brief: 0, concept: 0, idea: 0, objective: 0, counters: 0 } },
  ]
  const [page, stateCounts] = await Promise.all([
    paginateAggregate<any>(ContentModel, pipeline, { page: f.page, pageSize: f.pageSize, sort: SORTS[f.sort] }),
    ContentModel.aggregate<{ _id: string; n: number }>([
      { $match: { ...match, state: { $exists: true } } },
      { $group: { _id: '$state', n: { $sum: 1 } } },
    ]),
  ])
  const counts = Object.fromEntries(CONTENT_STATES.map((s) => [s, 0])) as Record<string, number>
  for (const { _id, n } of stateCounts) counts[_id] = n
  res.json({
    ...page,
    items: page.items.map((c) => ({ ...c, approvalStatus: approvalStatus(c.state, c.version) })),
    counts,
  })
})

/**
 * Queues for the agency's dashboards (§6.3): awaiting internal review (mine, or all for Manager+),
 * ready for client, awaiting the client, changes requested, and approved-but-not-scheduled.
 */
contentRouter.get('/queues', async (req, res) => {
  const base = await scopeFilter(req, { softDelete: true, agencyLevel: false })
  const auth = req.agencyAuth!
  const reviewFilter = auth.role === 'member' ? { reviewer: auth.user._id } : {}
  const fields = { title: 1, client: 1, state: 1, stateChangedAt: 1, publishDate: 1, owner: 1, reviewer: 1, currentVersion: 1 }
  const q = (extra: Record<string, unknown>) => ContentModel.find({ ...base, ...extra }, fields).sort({ stateChangedAt: 1 }).limit(100).lean()
  const [awaitingReview, readyForClient, awaitingClient, changesRequested, readyToSchedule] = await Promise.all([
    q({ state: 'internal_review', ...reviewFilter }),
    q({ state: 'ready_for_client' }),
    q({ state: 'client_review' }),
    q({ state: 'changes_requested' }),
    q({ state: 'approved' }),
  ])
  res.json({ awaitingReview, readyForClient, awaitingClient, changesRequested, readyToSchedule })
})

// ── Create, read, update ──────────────────────────────────────────────────────

const fieldsSchema = z.object({
  title: z.string().trim().min(1, 'Give it a title').max(200),
  platform: z.enum(PLATFORMS),
  format: z.enum(FORMATS),
  idea: z.string().max(5000).optional(),
  concept: z.string().max(5000).optional(),
  objective: z.string().max(2000).optional(),
  brief: z.string().max(20_000).optional(),
  owner: z.string().nullable().optional(),
  reviewer: z.string().nullable().optional(),
  collaborators: z.array(z.string()).max(20).optional(),
  priority: z.enum(PRIORITIES).optional(),
  due: z.union([dateOnlySchema, z.literal('')]).optional(),
  publishDate: z.iso.datetime().nullable().optional(),
  revisionLimit: z.number().int().min(0).max(50).nullable().optional(),
  campaign: z.string().nullable().optional(),
})

/** D29/D30: why a publish date moved after the client saw it. Logged for the agency; the client sees a neutral shift. */
export const SHIFT_REASONS = ['client_delay', 'agency_delay', 'strategy_change', 'missed_slot', 'platform_issue', 'other'] as const

/** Fields that belong to the plan: changing them after the plan's approval flags the item (D34). */
const PLAN_FIELDS = ['title', 'platform', 'format', 'idea', 'concept', 'objective', 'publishDate', 'campaign'] as const

async function campaignOf(client: Types.ObjectId, id: string | null | undefined) {
  if (!id) return null
  const c = await CampaignModel.findOne({ _id: objectId(id, 'Campaign not found.'), client, deletedAt: null }, { _id: 1 }).lean()
  if (!c) throw invalid('campaign', 'Pick a campaign of this client')
  return c._id
}

async function peopleFields(req: Request, client: Types.ObjectId, input: Partial<z.infer<typeof fieldsSchema>>) {
  const out: Record<string, unknown> = {}
  if (input.owner !== undefined) out.owner = input.owner ? (await teamOnClient(req, client, [input.owner], 'owner'))[0] : null
  if (input.reviewer !== undefined) out.reviewer = input.reviewer ? (await teamOnClient(req, client, [input.reviewer], 'reviewer'))[0] : null
  if (input.collaborators !== undefined) out.collaborators = await teamOnClient(req, client, input.collaborators, 'collaborators')
  return out
}

const createSchema = fieldsSchema.extend({ client: z.string(), planned: z.boolean().default(false), template: z.string().optional() })

contentRouter.post('/', idempotent(), async (req, res) => {
  const { client: clientId, planned, owner, reviewer, collaborators, publishDate, campaign, template, ...rest } = createSchema.parse(req.body)
  const auth = req.agencyAuth!
  const client = await loadClient(req, objectId(clientId, 'Client not found.'), 'write')
  const people: Record<string, any> = await peopleFields(req, client._id, { owner, reviewer, collaborators })
  // D55: a content template prefills fields and adds its production tasks; it never changes the state machine.
  const tpl = template ? await loadTemplate(auth.agency._id, objectId(template, 'Template not found.'), 'content') : null
  const { tasks: templateTasks = [], ...prefill } = tpl?.body ?? {}
  const content = await ContentModel.create({
    ...Object.fromEntries(Object.entries(prefill).filter(([, v]) => v !== '' && v !== undefined)),
    ...rest,
    campaign: await campaignOf(client._id, campaign),
    template: tpl?._id ?? null,
    ...people,
    owner: owner === undefined ? auth.user._id : people.owner,
    publishDate: publishDate ? new Date(publishDate) : null,
    agency: auth.agency._id,
    client: client._id,
    state: planned ? 'planned' : 'in_production',
    createdBy: auth.user._id,
    updatedBy: { id: auth.user._id, name: auth.user.name },
  })
  await logActivity(req, {
    action: 'content.created',
    message: `${auth.user.name} created ${content.title}`,
    agency: auth.agency._id,
    client: client._id,
    target: { type: 'content', id: content._id, label: content.title },
  })
  if (tpl) {
    await generateTasks(
      req,
      { agency: auth.agency._id, client: client._id, content: content._id, owner: content.owner, timezone: client.timezone, title: content.title },
      templateTasks,
      { template: tpl._id },
    )
  }
  res.status(201).json({ content: await present(content.toObject() as svc.ContentDoc) })
})

contentRouter.get('/:id', async (req, res) => {
  res.json({ content: await present(await loadContent(req, req.params.id)) })
})

const EDITABLE = ['title', 'platform', 'format', 'idea', 'concept', 'objective', 'brief', 'owner', 'reviewer', 'collaborators', 'priority', 'due', 'publishDate', 'revisionLimit', 'campaign'] as const

contentRouter.patch('/:id', async (req, res) => {
  const { rev, owner, reviewer, collaborators, publishDate, campaign, shiftReason, ...rest } = fieldsSchema
    .partial()
    .extend({ rev: z.number().int().min(1), shiftReason: z.enum(SHIFT_REASONS).optional() })
    .parse(req.body)
  const content = await loadContent(req, req.params.id, 'write')
  if (['published', 'cancelled'].includes(content.state)) throw new AppError(409, 'invalid_state', `This content is ${content.state}, so it can’t be edited.`)
  const set: Record<string, unknown> = {
    ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)),
    ...(await peopleFields(req, content.client, { owner, reviewer, collaborators })),
  }
  if (publishDate !== undefined) {
    // D28: once scheduled, the date moves through scheduling, so the queue and calendar can't disagree.
    if (['scheduled', 'publishing'].includes(content.state)) throw new AppError(409, 'invalid_state', 'Unschedule it to change the publish date.')
    set.publishDate = publishDate ? new Date(publishDate) : null
    set.missedSlotAlertedFor = null
    // The client has seen a date: moving it needs a reason, and the shift is logged (D30).
    const moved = String(set.publishDate) !== String(content.publishDate)
    if (moved && content.clientVisibleAt && content.publishDate && !shiftReason) throw invalid('shiftReason', 'Say why the date is moving')
  }
  if (campaign !== undefined) set.campaign = await campaignOf(content.client, campaign)
  const planTouched = !!content.plan && PLAN_FIELDS.some((k) => set[k] !== undefined && JSON.stringify(set[k]) !== JSON.stringify(content[k]))
  if (planTouched) set.planEditedAt = new Date()

  const updated = await updateWithRev(ContentModel, { _id: content._id, agency: content.agency }, rev, set, req.agencyAuth!.user)
  const changes = diff(content, updated.toObject(), [...EDITABLE])
  if (changes) {
    const shifted = changes.after.publishDate !== undefined
    await logActivity(req, {
      action: shifted ? 'content.publish_date_changed' : 'content.updated',
      message: `${req.agencyAuth!.user.name} ${shifted ? 'moved the publish date of' : 'updated'} ${updated.title}${shiftReason ? ` (${shiftReason.replace(/_/g, ' ')})` : ''}`,
      agency: content.agency,
      client: content.client,
      target: { type: 'content', id: content._id, label: updated.title },
      meta: shiftReason ? { shiftReason } : undefined,
      ...changes,
    })
  }
  if (planTouched && content.plan) {
    // D34: only the first change after approval tells the client; later ones keep the same flag.
    const plan = await ContentPlanModel.findById(content.plan).lean()
    const alreadyFlagged = !!plan?.decidedAt && !!content.planEditedAt && content.planEditedAt > plan.decidedAt
    if (plan?.status === 'approved' && !alreadyFlagged) await notifyPlanChanged(plan, `"${updated.title}" was updated.`)
  }
  res.json({ content: await present(updated.toObject() as svc.ContentDoc) })
})

// ── Versions ────────────────────────────────────────────────────────────────

const versionSchema = z.object({
  files: z.array(z.string()).min(1, 'Add at least one file').max(20),
  caption: z.string().max(5000).default(''),
  hashtags: z.array(z.string().trim().min(1).max(100)).max(60).default([]),
  changeNote: z.string().trim().max(2000).default(''),
  resolves: z.array(z.string()).max(200).default([]),
  resolutionNote: z.string().trim().max(2000).default(''),
})

/** Making and uploading the creative is the team members' job: owners, admins and managers review it instead. */
const creativeMakers: RequestHandler = (req, _res, next) => {
  if (req.agencyAuth!.role !== 'member') throw forbidden('Only team members upload the creative.')
  next()
}

contentRouter.post('/:id/versions', creativeMakers, idempotent(), async (req, res) => {
  const input = versionSchema.parse(req.body)
  const content = await loadContent(req, req.params.id, 'write')
  const result = await svc.uploadVersion(req, content, {
    ...input,
    files: input.files.map((f) => objectId(f, 'File not found.')),
    resolves: input.resolves.map((t) => objectId(t, 'Comment not found.')),
  })
  res.status(201).json({ ...result, content: await present(await loadContent(req, content._id.toString())) })
})

const versionEditSchema = versionSchema.pick({ files: true, caption: true, hashtags: true, changeNote: true }).partial()

/** A version can be edited only until it's submitted. After that, a change is a new version (D06). */
contentRouter.patch('/:id/versions/:versionId', creativeMakers, async (req, res) => {
  const input = versionEditSchema.parse(req.body)
  const content = await loadContent(req, req.params.id, 'write')
  const versionId = objectId(req.params.versionId, 'Version not found.')
  if (String(content.currentVersion) !== String(versionId) || content.state !== 'in_production') {
    throw new AppError(409, 'version_locked', 'Only the current version can be edited, while the content is in production.')
  }
  const set: Record<string, unknown> = Object.fromEntries(Object.entries(input).filter(([k, v]) => v !== undefined && k !== 'files'))
  if (input.files) set.files = await svc.versionFiles(content, input.files.map((f) => objectId(f, 'File not found.')))
  const version = await VersionModel.findOneAndUpdate({ _id: versionId, content: content._id, lockedAt: null }, { $set: set }, { returnDocument: 'after' })
  if (!version) throw new AppError(409, 'version_locked', 'This version was already submitted, so it can’t be edited. Upload a new version instead.')
  if (input.files) {
    await FileModel.updateMany({ _id: { $in: version.files.map((f) => f.file) } }, { $addToSet: { usedIn: { type: 'version', id: version._id } } })
  }
  res.json({ version })
})

// ── Actions ─────────────────────────────────────────────────────────────────

const noteSchema = z.object({ note: z.string().trim().max(2000).default('') })

contentRouter.post('/:id/start-production', async (req, res) => {
  res.json({ content: await svc.startProduction(req, await loadContent(req, req.params.id, 'write')) })
})

contentRouter.post('/:id/submit', async (req, res) => {
  res.json({ content: await svc.submit(req, await loadContent(req, req.params.id, 'write')) })
})

const internalSchema = z.object({ decision: z.enum(['approve', 'approve_and_send', 'request_changes']), note: z.string().trim().max(2000).default('') })

contentRouter.post('/:id/internal-review', async (req, res) => {
  const { decision, note } = internalSchema.parse(req.body)
  res.json({ content: await svc.internalDecision(req, await loadContent(req, req.params.id, 'write'), decision, note) })
})

const sendSchema = z.object({ sendAt: z.iso.datetime().nullable().optional(), note: z.string().trim().max(2000).default('') })

/** Send now, send later (`sendAt`), or re-send the same version with a reply from changes_requested. */
contentRouter.post('/:id/send', async (req, res) => {
  const { sendAt, note } = sendSchema.parse(req.body ?? {})
  const content = await loadContent(req, req.params.id, 'write')
  res.json({ content: await svc.send(req, content, { sendAt: sendAt ? new Date(sendAt) : null, note }) })
})

contentRouter.post('/:id/continue-editing', async (req, res) => {
  res.json({ content: await svc.continueEditing(req, await loadContent(req, req.params.id, 'write')) })
})

const scheduleSchema = z.object({ publishDate: z.iso.datetime(), account: z.string().nullable().optional() })

contentRouter.post('/:id/schedule', async (req, res) => {
  const { publishDate, account } = scheduleSchema.parse(req.body)
  const connection = account ? objectId(account, 'Account not found.') : null
  res.json({ content: await svc.schedule(req, await loadContent(req, req.params.id, 'write'), new Date(publishDate), connection) })
})

contentRouter.post('/:id/unschedule', async (req, res) => {
  res.json({ content: await svc.unschedule(req, await loadContent(req, req.params.id, 'write')) })
})

const publishedSchema = z.object({ url: z.url('Paste the post’s link').max(1000), externalId: z.string().trim().max(200).default('') })

contentRouter.post('/:id/mark-published', async (req, res) => {
  const input = publishedSchema.parse(req.body)
  res.json({ content: await svc.markPublished(req, await loadContent(req, req.params.id, 'write'), input) })
})

contentRouter.post('/:id/retry-publish', async (req, res) => {
  res.json({ job: await svc.retryPublish(req, await loadContent(req, req.params.id, 'write')) })
})

contentRouter.post('/:id/cancel', async (req, res) => {
  const { note } = noteSchema.parse(req.body ?? {})
  res.json({ content: await svc.cancel(req, await loadContent(req, req.params.id, 'write'), note) })
})

contentRouter.post('/:id/restore', async (req, res) => {
  res.json({ content: await svc.restore(req, await loadContent(req, req.params.id, 'write')) })
})

export { loadContent }
