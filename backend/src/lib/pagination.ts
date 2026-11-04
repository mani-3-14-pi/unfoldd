import type { Model, PipelineStage, QueryFilter, SortOrder } from 'mongoose'
import { z } from 'zod'

export const PAGE_SIZES = [10, 25, 50, 100] as const

export const pageQuery = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .refine((n) => (PAGE_SIZES as readonly number[]).includes(n), 'Unsupported page size')
    .default(25),
  q: z.string().trim().max(200).optional(),
}

/** `?status=active,suspended` → ['active', 'suspended'], restricted to the allowed values. */
export const csvEnum = <T extends string>(values: readonly [T, ...T[]]) =>
  z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',').filter(Boolean) : []))
    .pipe(z.array(z.enum(values)))

/** A `YYYY-MM-DD` date; `to` dates are inclusive of the whole day. */
export const dateParam = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()

export function dateRange(from?: string, to?: string) {
  if (!from && !to) return undefined
  const range: { $gte?: Date; $lt?: Date } = {}
  if (from) range.$gte = new Date(`${from}T00:00:00.000Z`)
  if (to) range.$lt = new Date(new Date(`${to}T00:00:00.000Z`).getTime() + 86_400_000)
  return range
}

export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export interface Page<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export function toPage<T>(items: T[], total: number, page: number, pageSize: number): Page<T> {
  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
}

export async function paginate<T = any>(
  model: Pick<Model<any>, 'find' | 'countDocuments'>,
  filter: QueryFilter<T> | Record<string, unknown>,
  opts: { page: number; pageSize: number; sort: Record<string, SortOrder> },
): Promise<Page<T>> {
  const m = model as Model<any>
  const [items, total] = await Promise.all([
    m
      .find(filter)
      .sort({ ...opts.sort, _id: -1 })
      .skip((opts.page - 1) * opts.pageSize)
      .limit(opts.pageSize)
      .lean(),
    m.countDocuments(filter),
  ])
  return toPage(items as T[], total, opts.page, opts.pageSize)
}

/** Same as `paginate`, for lists that need $lookup/$addFields before matching or sorting. */
export async function paginateAggregate<T>(
  model: Pick<Model<any>, 'aggregate'>,
  pipeline: PipelineStage[],
  opts: { page: number; pageSize: number; sort: Record<string, 1 | -1> },
) {
  const [result] = await model.aggregate<{ items: T[]; total: { n: number }[] }>([
    ...pipeline,
    {
      $facet: {
        items: [{ $sort: { ...opts.sort, _id: -1 } }, { $skip: (opts.page - 1) * opts.pageSize }, { $limit: opts.pageSize }],
        total: [{ $count: 'n' }],
      },
    },
  ])
  return toPage(result.items, result.total[0]?.n ?? 0, opts.page, opts.pageSize)
}
