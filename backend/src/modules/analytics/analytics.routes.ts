import { Router, type Request } from 'express'
import type { Types } from 'mongoose'
import { z } from 'zod'
import { logActivity } from '../../lib/activity.ts'
import { objectId } from '../../lib/ids.ts'
import { notify } from '../../lib/notify.ts'
import { loadClient, scopeFilter } from '../../lib/scope.ts'
import { dateOnlySchema, zonedToUtc } from '../../lib/time.ts'
import { AppError, invalid, notFound } from '../../utils/AppError.ts'
import { ClientModel } from '../clients/client.model.ts'
import { clientPeople } from '../content/content.recipients.ts'
import { ContentModel } from '../content/content.model.ts'
import { ReviewDecisionModel } from '../content/reviewDecision.model.ts'
import { AnalyticsSnapshotModel, REPORT_SECTIONS, ReportModel } from './analytics.model.ts'
import { periodAnalytics } from './analytics.service.ts'

/** Analytics (P120–P125, F75–F79) and reports (P126–P129, D53). */
export const analyticsRouter = Router()
export const reportsRouter = Router()
export const clientAnalyticsRouter = Router()

const periodSchema = z.object({ client: z.string(), from: dateOnlySchema, to: dateOnlySchema }).refine((p) => p.from <= p.to, { message: 'The period ends before it starts', path: ['to'] })

analyticsRouter.get('/', async (req, res) => {
  const f = periodSchema.parse(req.query)
  const client = await loadClient(req, objectId(f.client, 'Client not found.'))
  res.json(await periodAnalytics(client._id, f.from, f.to))
})

analyticsRouter.get('/content/:id', async (req, res) => {
  const content = await ContentModel.findOne({ ...(await scopeFilter(req, { softDelete: true, agencyLevel: false })), _id: objectId(req.params.id, 'Content not found.') }, { _id: 1 }).lean()
  if (!content) throw notFound('Content not found.')
  res.json({ items: await AnalyticsSnapshotModel.find({ content: content._id }).sort({ collectedAt: -1 }).limit(100).lean() })
})

// ── Reports ─────────────────────────────────────────────────────────────────

/** The frozen data a report shows: analytics plus what the agency delivered in the period. */
async function buildSnapshot(clientId: Types.ObjectId, from: string, to: string) {
  const analytics = await periodAnalytics(clientId, from, to)
  const tz = analytics.period.timezone
  const start = zonedToUtc(from, '00:00', tz)
  const end = new Date(zonedToUtc(to, '00:00', tz).getTime() + 86_400_000)
  const [approvals, changes] = await Promise.all([
    ReviewDecisionModel.countDocuments({ client: clientId, scope: 'client', decision: 'approved', createdAt: { $gte: start, $lt: end } }),
    ReviewDecisionModel.countDocuments({ client: clientId, scope: 'client', decision: { $in: ['changes_requested', 'pulled'] }, createdAt: { $gte: start, $lt: end } }),
  ])
  return { ...analytics, delivery: { published: analytics.posts.length, approvals, revisionRounds: changes }, generatedAt: new Date() }
}

async function loadReport(req: Request, id: unknown) {
  const r = await ReportModel.findOne({ ...(await scopeFilter(req, { agencyLevel: false })), _id: objectId(id, 'Report not found.'), deletedAt: null })
  if (!r) throw notFound('Report not found.')
  return r
}

reportsRouter.get('/', async (req, res) => {
  const f = z.object({ client: z.string().optional() }).parse(req.query)
  const filter: Record<string, unknown> = { ...(await scopeFilter(req, { agencyLevel: false })), deletedAt: null }
  if (f.client) filter.$and = [{ client: objectId(f.client) }]
  res.json({ items: await ReportModel.find(filter, { snapshot: 0 }).sort({ createdAt: -1 }).limit(200).lean() })
})

const createSchema = z.object({
  client: z.string(),
  title: z.string().trim().min(1).max(150).optional(),
  from: dateOnlySchema,
  to: dateOnlySchema,
  sections: z.array(z.enum(REPORT_SECTIONS)).min(1).optional(),
  notes: z.string().max(10_000).default(''),
})

/** Creates a draft with a fresh snapshot (D53: drafts first, never auto-shared). */
reportsRouter.post('/', async (req, res) => {
  const input = createSchema.parse(req.body)
  if (input.from > input.to) throw invalid('to', 'The period ends before it starts')
  const client = await loadClient(req, objectId(input.client, 'Client not found.'), 'write')
  const me = req.agencyAuth!.user
  const report = await ReportModel.create({
    agency: client.agency,
    client: client._id,
    title: input.title ?? `${client.brandName} report · ${input.from} – ${input.to}`,
    period: { from: input.from, to: input.to },
    sections: input.sections,
    notes: input.notes,
    snapshot: await buildSnapshot(client._id, input.from, input.to),
    generatedAt: new Date(),
    createdBy: { id: me._id, name: me.name },
  })
  res.status(201).json({ report })
})

reportsRouter.get('/:id', async (req, res) => {
  res.json({ report: await loadReport(req, req.params.id) })
})

const patchSchema = z.object({ title: z.string().trim().min(1).max(150).optional(), notes: z.string().max(10_000).optional(), sections: z.array(z.enum(REPORT_SECTIONS)).min(1).optional() })

reportsRouter.patch('/:id', async (req, res) => {
  const input = patchSchema.parse(req.body)
  const r = await loadReport(req, req.params.id)
  if (r.status === 'shared') throw new AppError(409, 'already_shared', 'A shared report can’t change. Create a new one.')
  r.set(Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)))
  await r.save()
  res.json({ report: r })
})

/** Re-takes the snapshot of a draft. */
reportsRouter.post('/:id/refresh', async (req, res) => {
  const r = await loadReport(req, req.params.id)
  const fresh = await buildSnapshot(r.client, r.period!.from, r.period!.to)
  const updated = await ReportModel.findOneAndUpdate({ _id: r._id, status: 'draft' }, { $set: { snapshot: fresh, generatedAt: new Date() } }, { returnDocument: 'after' }).lean()
  if (!updated) throw new AppError(409, 'already_shared', 'A shared report can’t change.')
  res.json({ report: updated })
})

/** Freezes the report and shows it to the client under Analytics → Reports (D53). */
reportsRouter.post('/:id/share', async (req, res) => {
  const r = await loadReport(req, req.params.id)
  await loadClient(req, r.client, 'manage')
  const me = req.agencyAuth!.user
  const shared = await ReportModel.findOneAndUpdate({ _id: r._id, status: 'draft' }, { $set: { status: 'shared', sharedAt: new Date(), sharedBy: { id: me._id, name: me.name } } }, { returnDocument: 'after' }).lean()
  if (!shared) throw new AppError(409, 'already_shared', 'This report was already shared.')
  const e = await logActivity(req, {
    action: 'report.shared',
    message: `${me.name} shared the report “${r.title}”`,
    agency: r.agency,
    client: r.client,
    visibility: 'client',
    target: { type: 'report', id: r._id, label: r.title },
  })
  await notify({
    recipients: await clientPeople(r.client),
    audience: 'client',
    agency: r.agency,
    client: r.client,
    category: 'clients',
    event: 'report.shared',
    title: `New report: ${r.title}`,
    entity: { type: 'report', id: r._id },
    link: `/c/reports/${r._id}`,
    activity: e?._id,
  })
  res.json({ report: shared })
})

reportsRouter.delete('/:id', async (req, res) => {
  const r = await loadReport(req, req.params.id)
  if (r.status === 'shared') throw new AppError(409, 'already_shared', 'A shared report stays with the client.')
  await ReportModel.updateOne({ _id: r._id }, { $set: { deletedAt: new Date() } })
  res.status(204).end()
})

// ── Client ──────────────────────────────────────────────────────────────────

/** D47: analytics show only when the agency switched "Show analytics to client" on. Shared reports always show. */
async function assertAnalyticsOn(req: Request) {
  const c = await ClientModel.findById(req.clientAuth!.client._id, { showAnalytics: 1 }).lean()
  if (!c?.showAnalytics) throw new AppError(403, 'analytics_off', 'Analytics aren’t available for your brand yet.')
}

clientAnalyticsRouter.get('/', async (req, res) => {
  await assertAnalyticsOn(req)
  const f = z.object({ from: dateOnlySchema, to: dateOnlySchema }).parse(req.query)
  const data = await periodAnalytics(req.clientAuth!.client._id, f.from, f.to)
  res.json(data)
})

clientAnalyticsRouter.get('/reports', async (req, res) => {
  res.json({ items: await ReportModel.find({ ...(await scopeFilter(req)), status: 'shared', deletedAt: null }, { title: 1, period: 1, sharedAt: 1 }).sort({ sharedAt: -1 }).lean() })
})

clientAnalyticsRouter.get('/reports/:id', async (req, res) => {
  const r = await ReportModel.findOne({ ...(await scopeFilter(req)), _id: objectId(req.params.id, 'Report not found.'), status: 'shared', deletedAt: null }, { createdBy: 0 }).lean()
  if (!r) throw notFound('Report not found.')
  res.json({ report: r })
})
