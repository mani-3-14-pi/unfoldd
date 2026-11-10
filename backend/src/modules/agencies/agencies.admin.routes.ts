import { Router } from 'express'
import { isValidObjectId, Types, type PipelineStage } from 'mongoose'
import { z } from 'zod'
import { logActivity } from '../../lib/activity.ts'
import { csvEnum, dateParam, dateRange, escapeRegex, pageQuery, paginateAggregate } from '../../lib/pagination.ts'
import { createSession } from '../../lib/session.ts'
import { AppError, notFound } from '../../utils/AppError.ts'
import { SessionModel } from '../sessions/session.model.ts'
import { getSettings } from '../settings/settings.model.ts'
import { MEMBER_ROLES, MEMBER_STATUSES, MembershipModel } from '../users/membership.model.ts'
import { UserModel } from '../users/user.model.ts'
import { AGENCY_STATUSES, PLANS, SUBSCRIPTION_STATUSES, TEAM_SIZES } from './agency.constants.ts'
import { AgencyModel } from './agency.model.ts'
import { TRANSITIONS, transitionAgency, type AgencyAction } from './agency.service.ts'

export const agenciesAdminRouter = Router()

const objectId = (id: string) => {
  if (!isValidObjectId(id)) throw notFound('Agency not found.')
  return new Types.ObjectId(id)
}

const ownerLookup: PipelineStage[] = [
  { $lookup: { from: 'users', localField: 'owner', foreignField: '_id', as: 'owner', pipeline: [{ $project: { name: 1, email: 1, lastLoginAt: 1 } }] } },
  { $set: { owner: { $first: '$owner' } } },
  {
    $lookup: {
      from: 'memberships',
      localField: '_id',
      foreignField: 'agency',
      as: 'members',
      pipeline: [{ $match: { status: { $ne: 'disabled' } } }, { $count: 'n' }],
    },
  },
  { $set: { memberCount: { $ifNull: [{ $first: '$members.n' }, 0] } } },
  { $unset: 'members' },
]

const SORTS = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  name: { name: 1 },
  name_desc: { name: -1 },
  members: { memberCount: -1 },
  status_changed: { statusChangedAt: -1 },
} as const

const listSchema = z.object({
  ...pageQuery,
  status: csvEnum(AGENCY_STATUSES),
  plan: csvEnum(PLANS),
  subscriptionStatus: csvEnum(SUBSCRIPTION_STATUSES),
  teamSize: csvEnum(TEAM_SIZES),
  country: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',').filter(Boolean) : [])),
  createdFrom: dateParam,
  createdTo: dateParam,
  sort: z.enum(Object.keys(SORTS) as [keyof typeof SORTS]).default('newest'),
})

agenciesAdminRouter.get('/', async (req, res) => {
  const f = listSchema.parse(req.query)

  // Everything but status, so the status tabs can show counts for the rest of the filters.
  const base: Record<string, unknown> = {}
  if (f.plan.length) base['subscription.plan'] = { $in: f.plan }
  if (f.subscriptionStatus.length) base['subscription.status'] = { $in: f.subscriptionStatus }
  if (f.teamSize.length) base.teamSize = { $in: f.teamSize }
  if (f.country.length) base.country = { $in: f.country }
  const created = dateRange(f.createdFrom, f.createdTo)
  if (created) base.createdAt = created

  const search: PipelineStage[] = []
  if (f.q) {
    const rx = new RegExp(escapeRegex(f.q), 'i')
    search.push({ $match: { $or: [{ name: rx }, { email: rx }, { slug: rx }, { 'owner.name': rx }, { 'owner.email': rx }] } })
  }
  const pipeline: PipelineStage[] = [{ $match: base }, ...ownerLookup, ...search]

  const [page, statusCounts, countries] = await Promise.all([
    paginateAggregate(AgencyModel, [...pipeline, ...(f.status.length ? [{ $match: { status: { $in: f.status } } }] : [])], {
      page: f.page,
      pageSize: f.pageSize,
      sort: SORTS[f.sort],
    }),
    AgencyModel.aggregate<{ _id: string; n: number }>([...pipeline, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    AgencyModel.distinct('country', { country: { $ne: '' } }),
  ])

  const counts = Object.fromEntries(AGENCY_STATUSES.map((s) => [s, 0])) as Record<string, number>
  for (const { _id, n } of statusCounts) counts[_id] = n
  res.json({ ...page, counts, facets: { countries: countries.sort() } })
})

agenciesAdminRouter.get('/:id', async (req, res) => {
  const _id = objectId(req.params.id)
  const [agency] = await AgencyModel.aggregate([{ $match: { _id } }, ...ownerLookup])
  if (!agency) throw notFound('Agency not found.')
  const activeSessions = await SessionModel.countDocuments({ kind: 'agency', agency: _id, expiresAt: { $gt: new Date() } })
  res.json({ agency: { ...agency, activeSessions } })
})

const MEMBER_SORTS = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  name: { 'user.name': 1 },
  last_login: { 'user.lastLoginAt': -1 },
} as const

const membersSchema = z.object({
  ...pageQuery,
  role: csvEnum(MEMBER_ROLES),
  status: csvEnum(MEMBER_STATUSES),
  sort: z.enum(Object.keys(MEMBER_SORTS) as [keyof typeof MEMBER_SORTS]).default('oldest'),
})

agenciesAdminRouter.get('/:id/members', async (req, res) => {
  const agency = objectId(req.params.id)
  const f = membersSchema.parse(req.query)
  const match: Record<string, unknown> = { agency }
  if (f.role.length) match.role = { $in: f.role }
  if (f.status.length) match.status = { $in: f.status }
  const pipeline: PipelineStage[] = [
    { $match: match },
    {
      $lookup: {
        from: 'users',
        localField: 'user',
        foreignField: '_id',
        as: 'user',
        // Whether 2FA is set up, never the secret: the admin's "Reset two-factor sign-in" needs it.
        pipeline: [{ $project: { name: 1, email: 1, lastLoginAt: 1, twoFactorEnabled: { $ne: [{ $ifNull: ['$twoFactor.enabledAt', null] }, null] } } }],
      },
    },
    { $set: { user: { $first: '$user' } } },
  ]
  if (f.q) {
    const rx = new RegExp(escapeRegex(f.q), 'i')
    pipeline.push({ $match: { $or: [{ 'user.name': rx }, { 'user.email': rx }] } })
  }
  res.json(await paginateAggregate(MembershipModel, pipeline, { page: f.page, pageSize: f.pageSize, sort: MEMBER_SORTS[f.sort] }))
})

const actionSchema = z.object({ reason: z.string().trim().max(500).optional().default('') })
const pastTense: Record<AgencyAction, string> = {
  approve: 'approved',
  reject: 'rejected',
  suspend: 'suspended',
  reactivate: 'reactivated',
}

agenciesAdminRouter.post('/:id/:action', async (req, res, next) => {
  const action = req.params.action as AgencyAction
  if (!(action in TRANSITIONS)) return next()
  const { reason } = actionSchema.parse(req.body ?? {})
  if ((action === 'reject' || action === 'suspend') && !reason) {
    throw new AppError(400, 'invalid_input', 'Some fields are invalid.', { reason: ['Add a reason; the agency sees it when they log in'] })
  }
  const agency = await transitionAgency(objectId(req.params.id), action, reason)
  await logActivity(req, {
    action: `agency.${pastTense[action]}`,
    message: `${req.admin!.name} ${pastTense[action]} ${agency.name}${reason ? `: ${reason}` : ''}`,
    agency: agency._id,
    target: { type: 'agency', id: agency._id, label: agency.name },
    meta: reason ? { reason } : undefined,
  })
  res.json({ agency })
})

agenciesAdminRouter.post('/:id/impersonate', async (req, res) => {
  const agency = await AgencyModel.findById(objectId(req.params.id)).lean()
  if (!agency) throw notFound('Agency not found.')
  // Open the portal as the owner, or failing that as any active admin.
  const membership =
    (await MembershipModel.findOne({ agency: agency._id, role: 'owner', status: 'active' }).lean()) ??
    (await MembershipModel.findOne({ agency: agency._id, role: 'admin', status: 'active' }).lean())
  if (!membership) throw new AppError(409, 'no_admin', 'This agency has no active owner or admin to open the portal as.')

  const settings = await getSettings()
  await createSession(req, res, {
    kind: 'agency',
    subject: membership.user,
    agency: agency._id,
    impersonator: req.admin!._id,
    mfaAt: new Date(),
    ttlMs: settings.supportSessionMinutes * 60_000,
  })
  await logActivity(req, {
    action: 'agency.impersonation_started',
    message: `${req.admin!.name} opened ${agency.name}’s admin portal (support view)`,
    agency: agency._id,
    target: { type: 'agency', id: agency._id, label: agency.name },
    meta: { asUser: membership.user, minutes: settings.supportSessionMinutes },
  })
  res.json({ url: '/app' })
})

const subscriptionSchema = z.object({
  plan: z.enum(PLANS),
  status: z.enum(SUBSCRIPTION_STATUSES),
  seats: z.coerce.number().int().min(1).max(10_000),
  renewsAt: z.union([z.iso.date(), z.literal(''), z.null()]).optional(),
  notes: z.string().trim().max(1000).optional().default(''),
})

agenciesAdminRouter.patch('/:id/subscription', async (req, res) => {
  const input = subscriptionSchema.parse(req.body)
  const agency = await AgencyModel.findById(objectId(req.params.id))
  if (!agency) throw notFound('Agency not found.')
  const before = agency.subscription ? { ...agency.toObject().subscription } : {}
  agency.set('subscription.plan', input.plan)
  agency.set('subscription.status', input.status)
  agency.set('subscription.seats', input.seats)
  agency.set('subscription.notes', input.notes)
  agency.set('subscription.renewsAt', input.renewsAt ? new Date(`${input.renewsAt}T00:00:00.000Z`) : undefined)
  if (!agency.subscription?.startedAt) agency.set('subscription.startedAt', new Date())
  await agency.save()
  await logActivity(req, {
    action: 'agency.subscription_updated',
    message: `${req.admin!.name} updated ${agency.name}’s subscription (${input.plan}, ${input.status.replace('_', ' ')})`,
    agency: agency._id,
    target: { type: 'agency', id: agency._id, label: agency.name },
    meta: { before, after: agency.toObject().subscription },
  })
  res.json({ agency })
})

/** Lost authenticator: clears a person's 2FA so they set it up again at next login. Signs them out everywhere. */
agenciesAdminRouter.post('/:id/members/:userId/reset-2fa', async (req, res) => {
  const agency = objectId(req.params.id)
  const userId = isValidObjectId(req.params.userId) ? new Types.ObjectId(String(req.params.userId)) : null
  const member = userId && (await MembershipModel.findOne({ agency, user: userId }).lean())
  if (!member) throw notFound('Member not found.')
  await UserModel.updateOne({ _id: member.user }, { $set: { 'twoFactor.enabledAt': null, 'twoFactor.lastStep': null }, $unset: { 'twoFactor.secret': 1, 'twoFactor.backupCodes': 1 } })
  await SessionModel.deleteMany({ kind: 'agency', subject: member.user })
  const user = await UserModel.findById(member.user, { name: 1 }).lean()
  await logActivity(req, {
    action: 'user.2fa_reset',
    message: `${req.admin!.name} reset two-factor sign-in for ${user?.name}`,
    agency,
    target: { type: 'user', id: member.user, label: user?.name },
  })
  res.status(204).end()
})
