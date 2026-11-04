import type { Request } from 'express'
import type { Types } from 'mongoose'
import { z } from 'zod'
import { logActivity } from '../../lib/activity.ts'
import { todayIn } from '../../lib/time.ts'
import { AppError, notFound } from '../../utils/AppError.ts'
import { FORMATS, PLATFORMS, PRIORITIES } from '../content/content.model.ts'
import { FILE_CATEGORIES } from '../files/file.model.ts'
import { TaskModel } from '../tasks/task.model.ts'
import { TemplateModel, type TemplateType } from './template.model.ts'

/*
 * D55: templates prefill fields and generate *production* task lists. They never hold a status and never a
 * review / approve / schedule / publish step — those are content states, so they can't drift from the truth.
 */

const NOT_A_TASK = /\b(review|approv\w*|schedul\w*|publish\w*|send to client)\b/i

const taskItem = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(5000).default(''),
    /** Days after the template is applied (negative = before the anchor date). */
    dueOffsetDays: z.number().int().min(-365).max(365).default(0),
  })
  .strict()
  .refine((t) => !NOT_A_TASK.test(t.title), { message: 'Review, approval, scheduling and publishing are content steps, not tasks', path: ['title'] })

const taskList = z.array(taskItem).max(50)

export const TEMPLATE_BODIES = {
  content: z
    .object({
      platform: z.enum(PLATFORMS).optional(),
      format: z.enum(FORMATS).optional(),
      idea: z.string().max(5000).default(''),
      concept: z.string().max(5000).default(''),
      objective: z.string().max(2000).default(''),
      brief: z.string().max(20_000).default(''),
      priority: z.enum(PRIORITIES).optional(),
      tasks: taskList.default([]),
    })
    .strict(),
  campaign: z
    .object({
      objective: z.string().max(2000).default(''),
      audience: z.string().max(2000).default(''),
      keyMessage: z.string().max(2000).default(''),
      platforms: z.array(z.enum(PLATFORMS)).default([]),
      brief: z
        .object({ background: z.string().default(''), strategy: z.string().default(''), deliverables: z.string().default(''), references: z.string().default(''), successCriteria: z.string().default('') })
        .strict()
        .default({ background: '', strategy: '', deliverables: '', references: '', successCriteria: '' }),
    })
    .strict(),
  task_list: z.object({ tasks: taskList.min(1) }).strict(),
  request: z
    .object({
      title: z.string().trim().min(1).max(200),
      description: z.string().max(5000).default(''),
      why: z.string().max(2000).default(''),
      uploadCategory: z.enum(FILE_CATEGORIES).default('other'),
      dueOffsetDays: z.number().int().min(0).max(365).default(7),
    })
    .strict(),
} satisfies Record<TemplateType, z.ZodType>

export type TemplateBody<T extends TemplateType> = z.infer<(typeof TEMPLATE_BODIES)[T]>

/** A template of the given type from the caller's agency, with its body parsed. */
export async function loadTemplate<T extends TemplateType>(agency: Types.ObjectId, id: Types.ObjectId, type: T) {
  const t = await TemplateModel.findOne({ _id: id, agency, type, deletedAt: null }).lean()
  if (!t) throw notFound('Template not found.')
  return { ...t, body: TEMPLATE_BODIES[type].parse(t.body) as TemplateBody<T> }
}

/** `YYYY-MM-DD` + n days. */
export function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * Creates a template's production tasks for a piece of content (Flow 5, step 1). Due dates count from
 * `anchor` (default: today in the client's timezone).
 */
export async function generateTasks(
  req: Request,
  target: { agency: Types.ObjectId; client: Types.ObjectId; content?: Types.ObjectId | null; owner?: Types.ObjectId | null; timezone: string; title: string },
  tasks: z.infer<typeof taskList>,
  opts: { anchor?: string; template: Types.ObjectId },
) {
  if (!tasks.length) return []
  const anchor = opts.anchor ?? todayIn(target.timezone)
  const last = await TaskModel.findOne({ agency: target.agency, client: target.client, status: 'todo' }, { position: 1 }).sort({ position: -1 }).lean()
  const me = req.agencyAuth!.user
  const rows = await TaskModel.insertMany(
    tasks.map((t, i) => ({
      agency: target.agency,
      client: target.client,
      content: target.content ?? null,
      title: t.title,
      description: t.description,
      due: addDays(anchor, t.dueOffsetDays),
      owner: target.owner ?? me._id,
      source: 'template',
      position: (last?.position ?? 0) + i + 1,
      createdBy: me._id,
      updatedBy: { id: me._id, name: me.name },
    })),
  )
  await logActivity(req, {
    action: 'template.tasks_generated',
    message: `${me.name} added ${rows.length} task${rows.length === 1 ? '' : 's'} from a template to ${target.title}`,
    agency: target.agency,
    client: target.client,
    target: target.content ? { type: 'content', id: target.content, label: target.title } : undefined,
    meta: { template: opts.template },
  })
  return rows
}

export function assertTemplateType(type: string): asserts type is TemplateType {
  if (!(type in TEMPLATE_BODIES)) throw new AppError(400, 'invalid_input', 'Unknown template type.')
}
