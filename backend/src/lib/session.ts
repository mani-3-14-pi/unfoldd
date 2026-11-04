import { createHash, randomBytes } from 'node:crypto'
import type { Request, Response } from 'express'
import type { Types } from 'mongoose'
import { isProd } from '../config/env.ts'
import { SessionModel } from '../modules/sessions/session.model.ts'

type Kind = 'platform' | 'agency'

// Separate cookies, so a platform admin can hold a support session in an agency portal in the same browser.
export const COOKIE: Record<Kind, string> = { platform: 'uf_admin', agency: 'uf_session' }

export const SESSION_TTL_MS: Record<Kind, number> = {
  platform: 12 * 60 * 60 * 1000,
  agency: 7 * 24 * 60 * 60 * 1000,
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('base64url')

export async function createSession(
  req: Request,
  res: Response,
  input: {
    kind: Kind
    subject: Types.ObjectId
    agency?: Types.ObjectId
    /** Set for a client-space session. */
    client?: Types.ObjectId | null
    impersonator?: Types.ObjectId
    /** Set when the sign-in passed 2FA. */
    mfaAt?: Date | null
    ttlMs?: number
  },
) {
  const token = randomBytes(32).toString('base64url')
  const ttlMs = input.ttlMs ?? SESSION_TTL_MS[input.kind]
  const session = await SessionModel.create({
    tokenHash: hashToken(token),
    kind: input.kind,
    subject: input.subject,
    agency: input.agency,
    client: input.client ?? null,
    impersonator: input.impersonator,
    mfaAt: input.mfaAt ?? null,
    ip: req.ip,
    userAgent: req.get('user-agent')?.slice(0, 300),
    expiresAt: new Date(Date.now() + ttlMs),
  })
  res.cookie(COOKIE[input.kind], token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    path: '/',
    maxAge: ttlMs,
  })
  return session
}

export async function readSession(req: Request, kind: Kind) {
  const token: unknown = req.cookies?.[COOKIE[kind]]
  if (typeof token !== 'string' || !token) return null
  const session = await SessionModel.findOne({ tokenHash: hashToken(token), kind }).lean()
  // The TTL monitor runs about once a minute, so check expiry here too.
  if (!session || session.expiresAt.getTime() <= Date.now()) return null
  return session
}

export async function destroySession(req: Request, res: Response, kind: Kind) {
  const token: unknown = req.cookies?.[COOKIE[kind]]
  if (typeof token === 'string' && token) await SessionModel.deleteOne({ tokenHash: hashToken(token), kind })
  res.clearCookie(COOKIE[kind], { path: '/' })
}

/** Signs everyone out of an agency (its team and its clients' people), e.g. when it is suspended. */
export const revokeAgencySessions = (agency: Types.ObjectId) => SessionModel.deleteMany({ kind: 'agency', agency })

/** Rule §12.11: removing or disabling a team member ends their sessions in that agency's portal at once. */
export const revokeMemberSessions = (user: Types.ObjectId, agency: Types.ObjectId) =>
  SessionModel.deleteMany({ kind: 'agency', subject: user, agency, client: null, impersonator: null })

/** The same for a client member losing access to one client space. */
export const revokeClientMemberSessions = (user: Types.ObjectId, client: Types.ObjectId) =>
  SessionModel.deleteMany({ kind: 'agency', subject: user, client })
