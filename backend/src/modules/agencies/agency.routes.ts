import { Router } from 'express'
import { z } from 'zod'
import { diff, logActivity } from '../../lib/activity.ts'
import { updateWithRev } from '../../lib/concurrency.ts'
import { objectId } from '../../lib/ids.ts'
import { pageQuery, paginate } from '../../lib/pagination.ts'
import { scopeFilter } from '../../lib/scope.ts'
import { presignDownload, storageConfigured } from '../../lib/storage.ts'
import { timezoneSchema } from '../../lib/time.ts'
import { requireRole } from '../../middleware/auth.ts'
import { invalid } from '../../utils/AppError.ts'
import { ActivityModel } from '../activity/activity.model.ts'
import { FileModel } from '../files/file.model.ts'
import { PERMISSION_MATRIX } from '../../lib/permissions.ts'
import { MembershipModel } from '../users/membership.model.ts'
import { AGENCY_TYPES, TEAM_SIZES } from './agency.constants.ts'
import { AgencyModel } from './agency.model.ts'

/** The signed-in person's own agency: profile, workspace settings and activity (P01, P03, P154). */
export const agencyRouter = Router()

const PROFILE_FIELDS = [
  'name',
  'logo',
  'description',
  'type',
  'services',
  'website',
  'email',
  'phone',
  'contactName',
  'country',
  'teamSize',
  'timezone',
  'clientDefaults',
] as const

async function present(agency: Record<string, any>) {
  let logoUrl: string | null = null
  if (agency.logo && storageConfigured()) {
    const file = await FileModel.findOne({ _id: agency.logo, status: 'ready', deletedAt: null }).lean()
    if (file) logoUrl = (await presignDownload(file.key, file, { inline: true })).url
  }
  const profile = Object.fromEntries(PROFILE_FIELDS.map((k) => [k, agency[k]]))
  return { id: agency._id, slug: agency.slug, status: agency.status, ...profile, logoUrl, rev: agency.rev ?? 1, updatedAt: agency.updatedAt }
}

agencyRouter.get('/', async (req, res) => {
  const agency = await AgencyModel.findById(req.agencyAuth!.agency._id).lean()
  res.json({ agency: await present(agency!) })
})

const profileSchema = z.object({
  rev: z.number().int().min(1),
  name: z.string().trim().min(2, 'Enter your agency name').max(100).optional(),
  logo: z.string().nullable().optional(),
  description: z.string().trim().max(1000).optional(),
  type: z.enum([...AGENCY_TYPES, '']).optional(),
  services: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  website: z.string().trim().max(200).optional(),
  email: z.email('Enter a valid email').trim().toLowerCase().optional(),
  phone: z.string().trim().max(30).optional(),
  contactName: z.string().trim().max(100).optional(),
  country: z.string().trim().max(60).optional(),
  teamSize: z.enum([...TEAM_SIZES, '']).optional(),
  timezone: timezoneSchema.optional(),
  clientDefaults: z
    .object({
      revisionsIncluded: z.number().int().min(0).max(50),
      approvalLeadHours: z.number().int().min(0).max(24 * 30),
      internalReview: z.boolean(),
    })
    .optional(),
})

agencyRouter.patch('/', requireRole('owner', 'admin'), async (req, res) => {
  const { rev, logo, ...rest } = profileSchema.parse(req.body)
  const agencyId = req.agencyAuth!.agency._id
  const set: Record<string, unknown> = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined))
  if (logo !== undefined) {
    if (logo === null) set.logo = null
    else {
      const file = await FileModel.findOne({ _id: objectId(logo), agency: agencyId, client: null, purpose: 'logo', status: 'ready', deletedAt: null }).lean()
      if (!file) throw invalid('logo', 'Upload the logo first')
      set.logo = file._id
    }
  }

  const before = await AgencyModel.findById(agencyId).lean()
  const agency = await updateWithRev(AgencyModel, { _id: agencyId }, rev, set, req.agencyAuth!.user)
  const changes = diff(before!, agency.toObject(), [...PROFILE_FIELDS])
  if (changes) {
    await logActivity(req, {
      action: 'agency.profile_updated',
      message: `${req.agencyAuth!.user.name} updated the agency profile`,
      agency: agencyId,
      target: { type: 'agency', id: agencyId, label: agency.name },
      ...changes,
    })
  }
  res.json({ agency: await present(agency.toObject()) })
})

const activitySchema = z.object({
  ...pageQuery,
  client: z.string().optional(),
  action: z.string().max(100).optional(),
})

/** The agency's activity feed: everything the person can see, newest first. */
agencyRouter.get('/activity', async (req, res) => {
  const f = activitySchema.parse(req.query)
  const filter: Record<string, unknown> = { ...(await scopeFilter(req)), visibility: { $in: ['internal', 'client'] } }
  if (f.client) {
    const id = objectId(f.client)
    // Stay inside the scope: an inaccessible client simply yields nothing.
    filter.$and = [{ client: filter.client ?? { $exists: true } }, { client: id }]
    delete filter.client
  }
  if (f.action) filter.action = { $regex: `^${f.action.replace(/[^a-z0-9_.]/gi, '')}` }
  const page = await paginate(ActivityModel, filter, { page: f.page, pageSize: f.pageSize, sort: { createdAt: -1 } })
  res.json({ ...page, items: page.items.map(({ ip: _ip, userAgent: _ua, ...event }) => event) })
})

/** P172–P174: what each role can do. Roles are fixed, so this is read-only. */
agencyRouter.get('/permissions', (_req, res) => {
  res.json(PERMISSION_MATRIX)
})

/**
 * Billing placeholder (P158–P160). Payments aren't built yet; this shows the plan the platform admin set
 * and seat use, so the portal can render the page.
 */
agencyRouter.get('/billing', requireRole('owner'), async (req, res) => {
  const agency = await AgencyModel.findById(req.agencyAuth!.agency._id, { subscription: 1 }).lean()
  const seatsUsed = await MembershipModel.countDocuments({ agency: req.agencyAuth!.agency._id, status: 'active' })
  res.json({
    available: false,
    message: 'Online billing is coming soon. Contact Unfoldd to change your plan.',
    plan: agency?.subscription?.plan ?? 'trial',
    status: agency?.subscription?.status ?? 'trialing',
    renewsAt: agency?.subscription?.renewsAt ?? null,
    seats: { included: agency?.subscription?.seats ?? 0, used: seatsUsed },
  })
})
