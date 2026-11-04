import { Schema, type Model, type Types } from 'mongoose'

/** Any model, without fighting Mongoose's generics. The result is the model's hydrated document type. */
type AnyModel = Model<any, any, any, any, any, any>
type DocOf<M extends AnyModel> = ReturnType<M['hydrate']>
import { AppError, notFound } from '../utils/AppError.ts'

// Rule §12.2 / D70: a state change is `UPDATE … WHERE state IN :from`; zero rows → 409 with the current state.

export type Transition<S extends string = string> = { from: readonly S[]; to: S }

/**
 * Moves a document from one of `rule.from` to `rule.to`, atomically.
 * `filter` must already carry the tenant scope, so a row the caller can't see is a 404, never a 409.
 */
export async function transition<M extends AnyModel>(
  typed: M,
  filter: Record<string, unknown>,
  rule: Transition,
  opts: { field?: string; set?: Record<string, unknown>; label?: string } = {},
): Promise<DocOf<M>> {
  const model = typed as Model<any>
  const field = opts.field ?? 'status'
  const doc = await model.findOneAndUpdate(
    { ...filter, [field]: { $in: rule.from } },
    { $set: { [field]: rule.to, ...opts.set } },
    { returnDocument: 'after' },
  )
  if (doc) return doc
  const current = await model.findOne(filter, { [field]: 1 }).lean<Record<string, unknown>>()
  if (!current) throw notFound()
  const state = String(current[field])
  throw new AppError(409, 'invalid_state', `This ${opts.label ?? 'item'} is ${state.replace(/_/g, ' ')}, so it can’t be changed that way.`, {
    [field]: state,
  })
}

// Rule §12.3: optimistic locking. Editable documents carry `rev`; a stale save is a 409 "Updated by X — reload".

/** Fields every rev-locked document has. Spread into a schema definition. */
export const revFields = {
  rev: { type: Number, default: 1, min: 1 },
  updatedBy: { id: Schema.Types.ObjectId, name: String },
}

export async function updateWithRev<M extends AnyModel>(
  typed: M,
  filter: Record<string, unknown>,
  rev: number,
  set: Record<string, unknown>,
  by: { _id: Types.ObjectId; name: string },
): Promise<DocOf<M>> {
  const model = typed as Model<any>
  const doc = await model.findOneAndUpdate(
    { ...filter, rev },
    { $set: { ...set, updatedBy: { id: by._id, name: by.name } }, $inc: { rev: 1 } },
    { returnDocument: 'after', runValidators: true },
  )
  if (doc) return doc
  const current = await model.findOne(filter, { rev: 1, updatedBy: 1, updatedAt: 1 }).lean<Record<string, any>>()
  if (!current) throw notFound()
  const who = current.updatedBy?.name ?? 'someone else'
  throw new AppError(409, 'stale', `This was updated by ${who} since you opened it. Reload to see their changes.`, {
    rev: current.rev,
    updatedBy: current.updatedBy,
    updatedAt: current.updatedAt,
  })
}

// Rule §12.7 / D61: soft delete. Rows referenced by history are never hard-deleted.

export const softDeleteFields = {
  deletedAt: { type: Date, default: null },
  deletedBy: { type: Schema.Types.ObjectId, default: null },
}

export const notDeleted = { deletedAt: null } as const
