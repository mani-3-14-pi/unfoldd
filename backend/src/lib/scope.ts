import type { Request } from 'express'
import type { Model, QueryFilter, Types } from 'mongoose'
import { AgencyAccessModel } from '../modules/clients/agencyAccess.model.ts'
import { ClientModel } from '../modules/clients/client.model.ts'
import type { ClientRole } from '../modules/clients/clientMember.model.ts'
import type { MemberRole } from '../modules/users/membership.model.ts'
import { AppError, forbidden, notFound } from '../utils/AppError.ts'

/*
 * The shared data-access layer (rule §12.1, D20). Every query for tenant data builds its filter here:
 *  - agency people: always `agency`, and for Managers/Members only the clients they're assigned to;
 *  - client people: `agency` + their one `client`, and only `visibility: client` rows.
 * Anything outside the scope is simply not found: not found and not allowed are both a 404.
 */

export const isAgencyAdmin = (role: MemberRole) => role === 'owner' || role === 'admin'
export const isManagerPlus = (role: MemberRole) => role !== 'member'

/** What each client role can do (D47). */
export const CLIENT_CAN = {
  approve: ['admin', 'approver'],
  feedback: ['admin', 'approver', 'contributor'],
  upload: ['admin', 'approver', 'contributor'],
  editBrand: ['admin', 'approver', 'contributor'],
  invite: ['admin'],
} as const satisfies Record<string, readonly ClientRole[]>

export const clientCan = (role: ClientRole, action: keyof typeof CLIENT_CAN) => (CLIENT_CAN[action] as readonly string[]).includes(role)

const accessCache = new WeakMap<Request, Promise<Types.ObjectId[] | null>>()

/** Client ids an agency person may see, or null for "all" (Owner/Admin). Cached per request. */
export function accessibleClientIds(req: Request): Promise<Types.ObjectId[] | null> {
  const auth = req.agencyAuth
  if (!auth) throw new Error('accessibleClientIds needs an agency session')
  if (isAgencyAdmin(auth.role)) return Promise.resolve(null)
  let ids = accessCache.get(req)
  if (!ids) {
    ids = AgencyAccessModel.find({ agency: auth.agency._id, user: auth.user._id }, { client: 1 })
      .lean()
      .then((rows) => rows.map((r) => r.client))
    accessCache.set(req, ids)
  }
  return ids
}

export interface ScopeOptions {
  /** Name of the client field on the model. Default `client`. */
  clientField?: string
  /** The model has a `visibility` field: client people see only `client` rows. */
  visibility?: boolean
  /** The model has `deletedAt`: hide soft-deleted rows. */
  softDelete?: boolean
  /** Agency people also see rows with no client (agency-level rows). Default true. */
  agencyLevel?: boolean
}

/** The tenant filter for the signed-in person. Combine it with your own conditions; never replace it. */
export async function scopeFilter(req: Request, opts: ScopeOptions = {}): Promise<Record<string, unknown>> {
  const field = opts.clientField ?? 'client'
  const filter: Record<string, unknown> = {}
  if (opts.softDelete) filter.deletedAt = null

  if (req.clientAuth) {
    filter.agency = req.clientAuth.agency._id
    filter[field] = req.clientAuth.client._id
    if (opts.visibility) filter.visibility = 'client'
    return filter
  }
  if (req.agencyAuth) {
    filter.agency = req.agencyAuth.agency._id
    const ids = await accessibleClientIds(req)
    if (ids) filter[field] = { $in: opts.agencyLevel === false ? ids : [...ids, null] }
    return filter
  }
  // Fail closed: a route that forgot its auth middleware sees nothing.
  throw notFound()
}

/** One row by id inside the caller's scope, or a 404. */
export async function findScoped<T>(model: Model<T>, req: Request, id: Types.ObjectId, opts: ScopeOptions = {}, message?: string) {
  const doc = await model.findOne({ ...(await scopeFilter(req, opts)), _id: id } as QueryFilter<T>)
  if (!doc) throw notFound(message)
  return doc
}

type ClientNeed = 'read' | 'write' | 'manage'

/**
 * A client the caller can see. `write` also refuses archived clients (read-only, §6.10).
 * `manage` (client settings, members, access) needs Manager or above on the agency side.
 */
export async function loadClient(req: Request, id: Types.ObjectId, need: ClientNeed = 'read') {
  const client = await ClientModel.findOne({ ...(await scopeFilter(req, { clientField: '_id', softDelete: true, agencyLevel: false })), _id: id })
  if (!client) throw notFound('Client not found.')
  if (need === 'manage' && (!req.agencyAuth || !isManagerPlus(req.agencyAuth.role))) throw forbidden()
  if (need !== 'read' && client.status === 'archived') {
    throw new AppError(409, 'client_archived', 'This client is archived, so it’s read-only. Restore it to make changes.')
  }
  return client
}

/** The `{ agency, client }` pair to stamp on a new row, from the caller's context. */
export const tenantOf = (req: Request) => {
  if (req.clientAuth) return { agency: req.clientAuth.agency._id, client: req.clientAuth.client._id as Types.ObjectId | null }
  if (req.agencyAuth) return { agency: req.agencyAuth.agency._id, client: null as Types.ObjectId | null }
  throw notFound()
}

/** The signed-in person, whichever app they're in. */
export const currentUser = (req: Request) => {
  const user = req.agencyAuth?.user ?? req.clientAuth?.user
  if (!user) throw notFound()
  return { ...user, side: (req.agencyAuth ? 'agency' : 'client') as 'agency' | 'client' }
}
