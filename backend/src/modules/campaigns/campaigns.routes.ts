import { Router, type Request } from 'express'
import type { Types } from 'mongoose'
import { z } from 'zod'
import { diff, logActivity } from '../../lib/activity.ts'
import { transition, updateWithRev } from '../../lib/concurrency.ts'
import { objectId } from '../../lib/ids.ts'
import { csvEnum, escapeRegex, pageQuery, paginate } from '../../lib/pagination.ts'
import { isManagerPlus, loadClient, scopeFilter } from '../../lib/scope.ts'
import { dateOnlySchema } from '../../lib/time.ts'
import { idempotent } from '../../middleware/idempotency.ts'
import { forbidden, invalid, notFound } from '../../utils/AppError.ts'
import { ContentModel, PLATFORMS } from '../content/content.model.ts'
import { MembershipModel } from '../users/membership.model.ts'
import { loadTemplate } from '../templates/template.service.ts'
import { CAMPAIGN_STATUSES, CAMPAIGN_TRANSITIONS, CampaignModel } from './campaign.model.ts'

/** Campaigns (P32–P36): agency side, plus the read-only client view. */
export const campaignsRouter = Router()
export const clientCampaignsRouter = Router()

/** P36: progress comes from the content in the campaign, never stored. */
export async function campaignProgress(ids: Types.ObjectId[]) {
  const rows = await ContentModel.aggregate<{ _id: Types.ObjectId; total: number; approved: number; published: number }>([
    { $match: { campaign: { $in: ids }, deletedAt: null, state: { $ne: 'cancelled' } } },
    {
      $group: {
        _id: '$campaign',
        total: { $sum: 1 },
        approved: { $sum: { $cond: [{ $in: ['$state', ['approved', 'scheduled', 'publishing', 'published']] }, 1, 0] } },
        published: { $sum: { $cond: [{ $eq: ['$state', 'published'] }, 1, 0] } },
      },
    },
  ])
  return new Map(
    rows.map((r) => [String(r._id), { total: r.total, approved: r.approved, published: r.published, percent: r.total ? Math.round((r.published / r.total) * 100) : 0 }]),
  )
}

async function load(req: Request, id: unknown, need: 'read' | 'write' = 'read') {
  const campaign = await CampaignModel.findOne({ ...(await scopeFilter(req, { softDelete: true, agencyLevel: false })), _id: objectId(id, 'Campaign not found.') }).lean()
  if (!campaign) throw notFound('Campaign not found.')
  if (need === 'write') {
    await loadClient(req, campaign.client, 'write')
    if (!isManagerPlus(req.agencyAuth!.role)) throw forbidden('Only a manager can change campaigns.')
  }
  return campaign
}

async function team(req: Request, ids: string[], field: string) {
  const oids = ids.map((id) => objectId(id))
  if ((await MembershipModel.countDocuments({ agency: req.agencyAuth!.agency._id, user: { $in: oids }, status: 'active' })) !== new Set(ids).size) {
    throw invalid(field, 'Pick someone on your team')
  }
  return oids
}

const listSchema = z.object({ ...pageQuery, client: z.string().optional(), status: csvEnum(CAMPAIGN_STATUSES) })

campaignsRouter.get('/', async (req, res) => {
  const f = listSchema.parse(req.query)
  const filter: Record<string, unknown> = await scopeFilter(req, { softDelete: true, agencyLevel: false })
  if (f.client) filter.$and = [{ client: objectId(f.client) }]
  filter.status = f.status.length ? { $in: f.status } : { $ne: 'archived' }
  if (f.q) filter.name = new RegExp(escapeRegex(f.q), 'i')
  const page = await paginate(CampaignModel, filter, { page: f.page, pageSize: f.pageSize, sort: { startDate: -1 } })
  const progress = await campaignProgress(page.items.map((c) => c._id))
  res.json({ ...page, items: page.items.map((c) => ({ ...c, progress: progress.get(String(c._id)) ?? { total: 0, approved: 0, published: 0, percent: 0 } })) })
})

const briefSchema = z.object({
  background: z.string().max(10_000).default(''),
  strategy: z.string().max(10_000).default(''),
  deliverables: z.string().max(10_000).default(''),
  references: z.string().max(10_000).default(''),
  successCriteria: z.string().max(10_000).default(''),
})

const fieldsSchema = z.object({
  name: z.string().trim().min(1, 'Name the campaign').max(150),
  objective: z.string().max(2000).optional(),
  audience: z.string().max(2000).optional(),
  keyMessage: z.string().max(2000).optional(),
  startDate: z.union([dateOnlySchema, z.literal('')]).optional(),
  endDate: z.union([dateOnlySchema, z.literal('')]).optional(),
  platforms: z.array(z.enum(PLATFORMS)).max(10).optional(),
  owner: z.string().nullable().optional(),
  team: z.array(z.string()).max(30).optional(),
  brief: briefSchema.partial().optional(),
})

campaignsRouter.post('/', idempotent(), async (req, res) => {
  const input = fieldsSchema.extend({ client: z.string(), template: z.string().optional() }).parse(req.body)
  const auth = req.agencyAuth!
  if (!isManagerPlus(auth.role)) throw forbidden('Only a manager can create campaigns.')
  const client = await loadClient(req, objectId(input.client, 'Client not found.'), 'write')
  if (input.startDate && input.endDate && input.endDate < input.startDate) throw invalid('endDate', 'Ends before it starts')
  const fromTemplate = input.template ? (await loadTemplate(auth.agency._id, objectId(input.template, 'Template not found.'), 'campaign')).body : null
  const campaign = await CampaignModel.create({
    ...fromTemplate,
    ...Object.fromEntries(Object.entries(input).filter(([k, v]) => v !== undefined && !['client', 'template', 'owner', 'team', 'brief'].includes(k))),
    brief: { ...fromTemplate?.brief, ...input.brief },
    agency: auth.agency._id,
    client: client._id,
    owner: input.owner ? (await team(req, [input.owner], 'owner'))[0] : auth.user._id,
    team: input.team ? await team(req, input.team, 'team') : [],
    createdBy: auth.user._id,
    updatedBy: { id: auth.user._id, name: auth.user.name },
  })
  await logActivity(req, {
    action: 'campaign.created',
    message: `${auth.user.name} created the campaign ${campaign.name}`,
    agency: auth.agency._id,
    client: client._id,
    visibility: 'client',
    target: { type: 'campaign', id: campaign._id, label: campaign.name },
  })
  res.status(201).json({ campaign })
})

campaignsRouter.get('/:id', async (req, res) => {
  const campaign = await load(req, req.params.id)
  const [progress, content] = await Promise.all([
    campaignProgress([campaign._id]),
    ContentModel.find({ campaign: campaign._id, deletedAt: null }, { title: 1, state: 1, platform: 1, format: 1, publishDate: 1, owner: 1 }).sort({ publishDate: 1 }).lean(),
  ])
  res.json({ campaign: { ...campaign, progress: progress.get(String(campaign._id)) ?? { total: 0, approved: 0, published: 0, percent: 0 }, content } })
})

const EDITABLE = ['name', 'objective', 'audience', 'keyMessage', 'startDate', 'endDate', 'platforms', 'owner', 'team', 'brief'] as const

campaignsRouter.patch('/:id', async (req, res) => {
  const { rev, owner, team: members, brief, ...rest } = fieldsSchema.partial().extend({ rev: z.number().int().min(1) }).parse(req.body)
  const campaign = await load(req, req.params.id, 'write')
  const set: Record<string, unknown> = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined))
  if (owner !== undefined) set.owner = owner ? (await team(req, [owner], 'owner'))[0] : null
  if (members) set.team = await team(req, members, 'team')
  if (brief) for (const [k, v] of Object.entries(brief)) if (v !== undefined) set[`brief.${k}`] = v
  const updated = await updateWithRev(CampaignModel, { _id: campaign._id, agency: campaign.agency }, rev, set, req.agencyAuth!.user)
  const changes = diff(campaign, updated.toObject(), [...EDITABLE])
  if (changes) {
    await logActivity(req, {
      action: 'campaign.updated',
      message: `${req.agencyAuth!.user.name} updated the campaign ${updated.name}`,
      agency: campaign.agency,
      client: campaign.client,
      target: { type: 'campaign', id: campaign._id, label: updated.name },
      ...changes,
    })
  }
  res.json({ campaign: updated })
})

campaignsRouter.post('/:id/:action', async (req, res, next) => {
  const action = req.params.action
  if (!['activate', 'complete', 'archive', 'restore'].includes(action)) return next()
  const campaign = await load(req, req.params.id, 'write')
  const filter = { _id: campaign._id, agency: campaign.agency }
  const updated =
    action === 'restore'
      ? await transition(CampaignModel, filter, { from: ['archived'], to: campaign.statusBeforeArchive ?? 'planning' }, { label: 'campaign', set: { statusBeforeArchive: null } })
      : await transition(CampaignModel, filter, CAMPAIGN_TRANSITIONS[action as keyof typeof CAMPAIGN_TRANSITIONS], {
          label: 'campaign',
          set: action === 'archive' ? { statusBeforeArchive: campaign.status } : {},
        })
  await logActivity(req, {
    action: `campaign.${action.replace(/e?$/, 'ed')}`,
    message: `${req.agencyAuth!.user.name} set the campaign ${campaign.name} to ${updated.status}`,
    agency: campaign.agency,
    client: campaign.client,
    visibility: 'client',
    target: { type: 'campaign', id: campaign._id, label: campaign.name },
    before: { status: campaign.status },
    after: { status: updated.status },
  })
  res.json({ campaign: updated })
})

// ── Client view (F63: Campaigns in the client space) ─────────────────────────

const CLIENT_FIELDS = { name: 1, objective: 1, keyMessage: 1, startDate: 1, endDate: 1, platforms: 1, status: 1 }

clientCampaignsRouter.get('/', async (req, res) => {
  const filter: Record<string, unknown> = { ...(await scopeFilter(req, { softDelete: true })), status: { $ne: 'archived' } }
  const items = await CampaignModel.find(filter, CLIENT_FIELDS).sort({ startDate: -1 }).limit(200).lean()
  const progress = await campaignProgress(items.map((c) => c._id))
  res.json({ items: items.map((c) => ({ ...c, progress: progress.get(String(c._id)) ?? { total: 0, approved: 0, published: 0, percent: 0 } })) })
})

clientCampaignsRouter.get('/:id', async (req, res) => {
  const campaign = await CampaignModel.findOne({ ...(await scopeFilter(req, { softDelete: true })), _id: objectId(req.params.id, 'Campaign not found.') }, CLIENT_FIELDS).lean()
  if (!campaign) throw notFound('Campaign not found.')
  const progress = await campaignProgress([campaign._id])
  // Only content the client can already see (D64).
  const content = await ContentModel.find({ campaign: campaign._id, deletedAt: null, clientVisibleAt: { $ne: null } }, { title: 1, platform: 1, format: 1, publishDate: 1 }).lean()
  res.json({ campaign: { ...campaign, progress: progress.get(String(campaign._id)), content } })
})
