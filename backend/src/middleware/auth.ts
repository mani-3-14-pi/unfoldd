import type { Request, RequestHandler } from 'express'
import { mfaRequired } from '../lib/mfa.ts'
import { readSession } from '../lib/session.ts'
import { AgencyModel } from '../modules/agencies/agency.model.ts'
import { ClientMemberModel, type ClientRole } from '../modules/clients/clientMember.model.ts'
import { ClientModel } from '../modules/clients/client.model.ts'
import { PlatformAdminModel } from '../modules/platform-admins/platformAdmin.model.ts'
import { MembershipModel, type MemberRole } from '../modules/users/membership.model.ts'
import { UserModel } from '../modules/users/user.model.ts'
import { AppError, forbidden } from '../utils/AppError.ts'

const unauthenticated = () => new AppError(401, 'unauthenticated', 'Please log in to continue.')

export const requirePlatformAdmin: RequestHandler = async (req, _res, next) => {
  const session = await readSession(req, 'platform')
  if (!session) throw unauthenticated()
  // Every platform session must have passed 2FA (when 2FA is switched on).
  if (mfaRequired() && !session.mfaAt) throw unauthenticated()
  const admin = await PlatformAdminModel.findOne({ _id: session.subject, status: 'active' }).lean()
  if (!admin) throw unauthenticated()
  req.admin = { _id: admin._id, username: admin.username, name: admin.name, sessionId: session._id }
  next()
}

/**
 * Loads the signed-in person and their current context into `req.agencyAuth` (agency portal) or
 * `req.clientAuth` (client space). Returns which one, or null when the session is missing or no longer valid.
 * Every request re-checks the membership, so removing someone takes effect immediately.
 */
async function loadUser(req: Request): Promise<'agency' | 'client' | null> {
  const session = await readSession(req, 'agency')
  if (!session?.agency) return null

  if (session.client) {
    const [user, agency, client, member] = await Promise.all([
      UserModel.findById(session.subject).lean(),
      AgencyModel.findById(session.agency).lean(),
      ClientModel.findOne({ _id: session.client, agency: session.agency, deletedAt: null }).lean(),
      ClientMemberModel.findOne({ user: session.subject, client: session.client, status: 'active' }).lean(),
    ])
    if (!user || !agency || !client || !member || agency.status !== 'active') return null
    req.clientAuth = {
      user: { _id: user._id, name: user.name, email: user.email },
      agency: { _id: agency._id, name: agency.name, logo: agency.logo ?? null },
      client: { _id: client._id, name: client.name, brandName: client.brandName, status: client.status, timezone: client.timezone },
      role: member.role as ClientRole,
      sessionId: session._id,
      expiresAt: session.expiresAt,
    }
    return 'client'
  }

  const [user, agency, membership, impersonator] = await Promise.all([
    UserModel.findById(session.subject).lean(),
    AgencyModel.findById(session.agency).lean(),
    MembershipModel.findOne({ user: session.subject, agency: session.agency, status: 'active' }).lean(),
    session.impersonator ? PlatformAdminModel.findOne({ _id: session.impersonator, status: 'active' }).lean() : null,
  ])
  if (!user || !agency || !membership) return null
  // Support sessions can open an agency in any state; its own people only while it is active.
  if (session.impersonator ? !impersonator : agency.status !== 'active') return null

  const role = membership.role as MemberRole
  // Agency owners must have passed 2FA (support sessions inherit the platform admin's).
  if (mfaRequired() && role === 'owner' && !session.impersonator && !session.mfaAt) {
    throw new AppError(401, 'mfa_required', 'As the agency owner you need two-factor sign-in. Log in again to set it up.')
  }
  req.agencyAuth = {
    user: { _id: user._id, name: user.name, email: user.email },
    agency: { _id: agency._id, name: agency.name, slug: agency.slug, status: agency.status, timezone: agency.timezone },
    role,
    canPublish: role === 'owner' || role === 'admin' || membership.canPublish,
    sessionId: session._id,
    impersonator: impersonator ? { id: impersonator._id, name: impersonator.name } : undefined,
    expiresAt: session.expiresAt,
  }
  return 'agency'
}

/** Agency portal routes. A session that is currently in a client space gets a 403 telling the app to switch. */
export const requireAgencyUser: RequestHandler = async (req, _res, next) => {
  const context = await loadUser(req)
  if (!context) throw unauthenticated()
  if (context !== 'agency') throw new AppError(403, 'wrong_context', 'You’re signed in to a client space. Switch to your agency to continue.')
  next()
}

/** Client App routes. */
export const requireClientUser: RequestHandler = async (req, _res, next) => {
  const context = await loadUser(req)
  if (!context) throw unauthenticated()
  if (context !== 'client') throw new AppError(403, 'wrong_context', 'You’re signed in to an agency portal. Switch to a client space to continue.')
  next()
}

/** Routes both apps share (files, notifications, `/auth/me`). */
export const requireUser: RequestHandler = async (req, _res, next) => {
  if (!(await loadUser(req))) throw unauthenticated()
  next()
}

/** Agency roles allowed on a route. Use after `requireAgencyUser`. */
export const requireRole =
  (...roles: MemberRole[]): RequestHandler =>
  (req, _res, next) => {
    if (!roles.includes(req.agencyAuth!.role)) throw forbidden()
    next()
  }
