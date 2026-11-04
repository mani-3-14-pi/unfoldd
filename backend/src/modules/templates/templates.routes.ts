import { Router } from 'express'
import { z } from 'zod'
import { logActivity } from '../../lib/activity.ts'
import { updateWithRev } from '../../lib/concurrency.ts'
import { objectId } from '../../lib/ids.ts'
import { csvEnum, escapeRegex, pageQuery, paginate } from '../../lib/pagination.ts'
import { loadClient } from '../../lib/scope.ts'
import { dateOnlySchema } from '../../lib/time.ts'
import { requireRole } from '../../middleware/auth.ts'
import { notFound } from '../../utils/AppError.ts'
import { ClientModel } from '../clients/client.model.ts'
import { ContentModel } from '../content/content.model.ts'
import { TEMPLATE_TYPES, TemplateModel } from './template.model.ts'
import { TEMPLATE_BODIES, assertTemplateType, generateTasks, loadTemplate } from './template.service.ts'

/** Agency templates (P140–P144). Everyone can use them; Manager+ maintain them. */
export const templatesRouter = Router()

const listSchema = z.object({ ...pageQuery, type: csvEnum(TEMPLATE_TYPES) })

templatesRouter.get('/', async (req, res) => {
  const f = listSchema.parse(req.query)
  const filter: Record<string, unknown> = { agency: req.agencyAuth!.agency._id, deletedAt: null }
  if (f.type.length) filter.type = { $in: f.type }
  if (f.q) filter.name = new RegExp(escapeRegex(f.q), 'i')
  res.json(await paginate(TemplateModel, filter, { page: f.page, pageSize: f.pageSize, sort: { name: 1 } }))
})

templatesRouter.get('/:id', async (req, res) => {
  const t = await TemplateModel.findOne({ _id: objectId(req.params.id, 'Template not found.'), agency: req.agencyAuth!.agency._id, deletedAt: null }).lean()
  if (!t) throw notFound('Template not found.')
  res.json({ template: t })
})

const createSchema = z.object({
  type: z.enum(TEMPLATE_TYPES),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).default(''),
  body: z.unknown(),
})

templatesRouter.post('/', requireRole('owner', 'admin', 'manager'), async (req, res) => {
  const input = createSchema.parse(req.body)
  const auth = req.agencyAuth!
  const template = await TemplateModel.create({
    agency: auth.agency._id,
    type: input.type,
    name: input.name,
    description: input.description,
    body: TEMPLATE_BODIES[input.type].parse(input.body ?? {}),
    createdBy: auth.user._id,
    updatedBy: { id: auth.user._id, name: auth.user.name },
  })
  await logActivity(req, {
    action: 'template.created',
    message: `${auth.user.name} created the ${input.type.replace('_', ' ')} template ${template.name}`,
    agency: auth.agency._id,
    target: { type: 'template', id: template._id, label: template.name },
  })
  res.status(201).json({ template })
})

const patchSchema = z.object({ rev: z.number().int().min(1), name: z.string().trim().min(1).max(120).optional(), description: z.string().trim().max(1000).optional(), body: z.unknown().optional() })

templatesRouter.patch('/:id', requireRole('owner', 'admin', 'manager'), async (req, res) => {
  const { rev, body, ...rest } = patchSchema.parse(req.body)
  const auth = req.agencyAuth!
  const current = await TemplateModel.findOne({ _id: objectId(req.params.id, 'Template not found.'), agency: auth.agency._id, deletedAt: null }).lean()
  if (!current) throw notFound('Template not found.')
  assertTemplateType(current.type)
  const set: Record<string, unknown> = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined))
  if (body !== undefined) set.body = TEMPLATE_BODIES[current.type].parse(body)
  res.json({ template: await updateWithRev(TemplateModel, { _id: current._id, agency: auth.agency._id }, rev, set, auth.user) })
})

templatesRouter.delete('/:id', requireRole('owner', 'admin', 'manager'), async (req, res) => {
  const auth = req.agencyAuth!
  const done = await TemplateModel.updateOne(
    { _id: objectId(req.params.id, 'Template not found.'), agency: auth.agency._id, deletedAt: null },
    { $set: { deletedAt: new Date(), deletedBy: auth.user._id } },
  )
  if (!done.matchedCount) throw notFound('Template not found.')
  res.status(204).end()
})

const applySchema = z.object({ content: z.string(), anchor: dateOnlySchema.optional() })

/** Generates a task-list or content template's production tasks for a piece of content. */
templatesRouter.post('/:id/apply', async (req, res) => {
  const input = applySchema.parse(req.body)
  const auth = req.agencyAuth!
  const raw = await TemplateModel.findOne({ _id: objectId(req.params.id, 'Template not found.'), agency: auth.agency._id, deletedAt: null }, { type: 1 }).lean()
  if (!raw || (raw.type !== 'task_list' && raw.type !== 'content')) throw notFound('Template not found.')
  const template = await loadTemplate(auth.agency._id, raw._id, raw.type)
  const content = await ContentModel.findOne({ _id: objectId(input.content, 'Content not found.'), agency: auth.agency._id, deletedAt: null }).lean()
  if (!content) throw notFound('Content not found.')
  await loadClient(req, content.client, 'write')
  const client = await ClientModel.findById(content.client, { timezone: 1 }).lean()
  const tasks = await generateTasks(
    req,
    { agency: auth.agency._id, client: content.client, content: content._id, owner: content.owner, timezone: client!.timezone, title: content.title },
    template.body.tasks,
    { anchor: input.anchor, template: template._id },
  )
  res.status(201).json({ tasks })
})
