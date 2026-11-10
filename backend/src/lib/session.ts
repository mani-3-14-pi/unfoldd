import { createHash, randomBytes } from 'node:crypto'
import type { Request, Response } from 'express'
import { SignJWT, jwtVerify, errors as joseErrors } from 'jose'
import type { Types } from 'mongoose'
import { env, isProd } from '../config/env.ts'
import { SessionModel } from '../modules/sessions/session.model.ts'

type Kind = 'platform' | 'agency'

// Separate cookies, so a platform admin can hold a support session in an agency portal in the same browser.
export const COOKIE: Record<Kind, string> = { platform: 'uf_admin', agency: 'uf_session' }

export const SESSION_TTL_MS: Record<Kind, number> = {
  platform: 12 * 60 * 60 * 1000,
  agency: 7 * 24 * 60 * 60 * 1000,
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('base64url')

/*
 * ─────────────────────────────────────────────────────────────────────────────────────────────────────────
 * Session cookie: signed JWT (HS256).
 *
 * The cookie holds a JWT whose payload is `{ sid, kind, sub, iat, exp }`. `sid` is a random session ID; its
 * SHA-256 hash is the `tokenHash` of a Session row. Verifying a request is two steps: check the signature and
 * expiry (no database), then look the Session row up by `sid` so sign-out and revocation (§12.11) still take
 * effect at once. The JWT never carries roles or permissions: those are re-read from the database on every
 * request by the auth middleware, as before.
 *
 * The signing key is JWT_SECRET, read from the server environment only. It is never sent to the browser, logged,
 * or committed (`.env` is git-ignored). Missing in production the server refuses to start.
 * ─────────────────────────────────────────────────────────────────────────────────────────────────────────
 */

const ALG = 'HS256'
const ISSUER = 'unfoldd'

let signingKey: Uint8Array | undefined
function key() {
  if (signingKey) return signingKey
  if (env.JWT_SECRET) {
    if (env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET must be at least 32 characters.')
    signingKey = new TextEncoder().encode(env.JWT_SECRET)
  } else {
    if (isProd) throw new Error('JWT_SECRET must be set in production.')
    // Development/test only: a stable key so local sessions survive restarts. Never used in production.
    signingKey = createHash('sha256').update(`dev-only-jwt:${env.MONGODB_URI}`).digest()
  }
  return signingKey
}

type Claims = { sid: string; kind: Kind }

async function signToken(claims: Claims, subject: string, ttlMs: number) {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({ sid: claims.sid, kind: claims.kind })
    .setProtectedHeader({ alg: ALG, typ: 'JWT' })
    .setIssuer(ISSUER)
    .setSubject(subject)
    .setIssuedAt(now)
    .setExpirationTime(now + Math.floor(ttlMs / 1000))
    .sign(key())
}

/** Returns the session ID from a valid, unexpired cookie of this kind, or null. Never throws on bad input. */
async function verifyToken(token: unknown, kind: Kind): Promise<string | null> {
  if (typeof token !== 'string' || !token) return null
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: [ALG], issuer: ISSUER })
    if (payload.kind !== kind || typeof payload.sid !== 'string') return null
    return payload.sid
  } catch (err) {
    if (err instanceof joseErrors.JOSEError) return null // tampered, expired, wrong key, malformed
    throw err
  }
}

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
  const sid = randomBytes(32).toString('base64url')
  const ttlMs = input.ttlMs ?? SESSION_TTL_MS[input.kind]
  const session = await SessionModel.create({
    tokenHash: hashToken(sid),
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
  const jwt = await signToken({ sid, kind: input.kind }, String(input.subject), ttlMs)
  res.cookie(COOKIE[input.kind], jwt, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    path: '/',
    maxAge: ttlMs,
  })
  return session
}

export async function readSession(req: Request, kind: Kind) {
  const sid = await verifyToken(req.cookies?.[COOKIE[kind]], kind)
  if (!sid) return null
  const session = await SessionModel.findOne({ tokenHash: hashToken(sid), kind }).lean()
  // The TTL monitor runs about once a minute, so check expiry here too.
  if (!session || session.expiresAt.getTime() <= Date.now()) return null
  return session
}

export async function destroySession(req: Request, res: Response, kind: Kind) {
  const sid = await verifyToken(req.cookies?.[COOKIE[kind]], kind)
  if (sid) await SessionModel.deleteOne({ tokenHash: hashToken(sid), kind })
  res.clearCookie(COOKIE[kind], { path: '/' })
}

/*
 * ─────────────────────────────────────────────────────────────────────────────────────────────────────────
 * Previous scheme (kept for reference): opaque token.
 *
 * The cookie held a raw random 32-byte token; the database stored its SHA-256 hash. No signature, so every
 * check was a single database lookup. Replaced by the JWT above on 2026-11-05. To go back, swap the three
 * functions above for these and drop the `jose` import.
 * ─────────────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * export async function createSession(req: Request, res: Response, input: { ...same as above }) {
 *   const token = randomBytes(32).toString('base64url')
 *   const ttlMs = input.ttlMs ?? SESSION_TTL_MS[input.kind]
 *   const session = await SessionModel.create({
 *     tokenHash: hashToken(token),
 *     kind: input.kind,
 *     subject: input.subject,
 *     agency: input.agency,
 *     client: input.client ?? null,
 *     impersonator: input.impersonator,
 *     mfaAt: input.mfaAt ?? null,
 *     ip: req.ip,
 *     userAgent: req.get('user-agent')?.slice(0, 300),
 *     expiresAt: new Date(Date.now() + ttlMs),
 *   })
 *   res.cookie(COOKIE[input.kind], token, {
 *     httpOnly: true,
 *     sameSite: 'lax',
 *     secure: isProd,
 *     path: '/',
 *     maxAge: ttlMs,
 *   })
 *   return session
 * }
 *
 * export async function readSession(req: Request, kind: Kind) {
 *   const token: unknown = req.cookies?.[COOKIE[kind]]
 *   if (typeof token !== 'string' || !token) return null
 *   const session = await SessionModel.findOne({ tokenHash: hashToken(token), kind }).lean()
 *   // The TTL monitor runs about once a minute, so check expiry here too.
 *   if (!session || session.expiresAt.getTime() <= Date.now()) return null
 *   return session
 * }
 *
 * export async function destroySession(req: Request, res: Response, kind: Kind) {
 *   const token: unknown = req.cookies?.[COOKIE[kind]]
 *   if (typeof token === 'string' && token) await SessionModel.deleteOne({ tokenHash: hashToken(token), kind })
 *   res.clearCookie(COOKIE[kind], { path: '/' })
 * }
 */

/** Signs everyone out of an agency (its team and its clients' people), e.g. when it is suspended. */
export const revokeAgencySessions = (agency: Types.ObjectId) => SessionModel.deleteMany({ kind: 'agency', agency })

/** Rule §12.11: removing or disabling a team member ends their sessions in that agency's portal at once. */
export const revokeMemberSessions = (user: Types.ObjectId, agency: Types.ObjectId) =>
  SessionModel.deleteMany({ kind: 'agency', subject: user, agency, client: null, impersonator: null })

/** The same for a client member losing access to one client space. */
export const revokeClientMemberSessions = (user: Types.ObjectId, client: Types.ObjectId) =>
  SessionModel.deleteMany({ kind: 'agency', subject: user, client })
