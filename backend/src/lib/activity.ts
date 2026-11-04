import type { Request } from 'express'
import type { Types } from 'mongoose'
import { ActivityModel, type Visibility } from '../modules/activity/activity.model.ts'

type Actor = { type: 'platform_admin' | 'agency_user' | 'client_user' | 'system'; id?: Types.ObjectId; name?: string }

export interface ActivityInput {
  action: string
  message: string
  agency?: Types.ObjectId
  client?: Types.ObjectId
  /** Defaults to `internal` (agency only). */
  visibility?: Visibility
  target?: { type: string; id?: Types.ObjectId; label?: string }
  before?: unknown
  after?: unknown
  meta?: Record<string, unknown>
  /** Defaults to whoever is signed in on the request. */
  actor?: Actor
}

function actorOf(req: Request): { actor: Actor; impersonator?: { id: Types.ObjectId; name: string } } {
  if (req.agencyAuth) {
    const { user, impersonator } = req.agencyAuth
    return { actor: { type: 'agency_user', id: user._id, name: user.name }, impersonator }
  }
  if (req.clientAuth) return { actor: { type: 'client_user', id: req.clientAuth.user._id, name: req.clientAuth.user.name } }
  if (req.admin) return { actor: { type: 'platform_admin', id: req.admin._id, name: req.admin.name } }
  return { actor: { type: 'system', name: 'System' } }
}

/** Appends to the event log. Logging must never break the request, so failures are only reported. */
export async function logActivity(req: Request | null, input: ActivityInput) {
  const fromReq = req ? actorOf(req) : { actor: { type: 'system', name: 'System' } as Actor }
  try {
    return await ActivityModel.create({
      ...input,
      actor: input.actor ?? fromReq.actor,
      impersonator: 'impersonator' in fromReq ? fromReq.impersonator : undefined,
      ip: req?.ip,
      userAgent: req?.get('user-agent')?.slice(0, 300),
    })
  } catch (err) {
    console.error('Failed to write activity log', err)
    return null
  }
}

/** Only the fields that changed, for an event's before/after. */
export function diff(before: Record<string, any>, after: Record<string, any>, keys: string[]) {
  const b: Record<string, unknown> = {}
  const a: Record<string, unknown> = {}
  for (const k of keys) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
      b[k] = before[k]
      a[k] = after[k]
    }
  }
  return Object.keys(a).length ? { before: b, after: a } : null
}
