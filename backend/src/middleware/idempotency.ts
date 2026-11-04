import { createHash } from 'node:crypto'
import type { Request, RequestHandler } from 'express'
import { IdempotencyModel } from '../modules/idempotency/idempotency.model.ts'
import { AppError } from '../utils/AppError.ts'

const TTL_MS = 24 * 60 * 60 * 1000

const signedInScope = (req: Request) => {
  const id = req.agencyAuth?.user._id ?? req.clientAuth?.user._id ?? req.admin?._id
  return id ? String(id) : undefined
}

/** For public token routes (invite accept), where nobody is signed in yet. */
export const tokenScope = (param: string) => (req: Request) =>
  `token:${createHash('sha256').update(String(req.params[param])).digest('base64url')}`

/**
 * Honours an optional `Idempotency-Key` header on create actions (rule §12.4).
 * A repeat with the same key gets the stored response. One that arrives while the first is still running gets a 409.
 * Only 2xx responses are kept, so a request that failed can be retried with the same key.
 */
export const idempotent =
  (scopeOf: (req: Request) => string | undefined = signedInScope): RequestHandler =>
  async (req, res, next) => {
    const key = req.get('idempotency-key')
    if (!key) return next()
    if (key.length > 200) throw new AppError(400, 'invalid_input', 'Idempotency-Key is too long.')
    const scope = scopeOf(req)
    if (!scope) return next()
    const route = `${req.method} ${req.baseUrl}${req.path}`

    try {
      await IdempotencyModel.create({ scope, key, route, expiresAt: new Date(Date.now() + TTL_MS) })
    } catch (err: any) {
      if (err?.code !== 11000) throw err
      const prior = await IdempotencyModel.findOne({ scope, key }).lean()
      if (!prior) throw new AppError(409, 'request_in_progress', 'This request is still being processed.')
      if (prior.route !== route) throw new AppError(422, 'idempotency_key_reused', 'This Idempotency-Key was used for a different request.')
      if (prior.state === 'in_progress') throw new AppError(409, 'request_in_progress', 'This request is still being processed.')
      res.status(prior.status ?? 200).json(prior.body)
      return
    }

    const json = res.json.bind(res)
    res.json = (body: unknown) => {
      if (res.statusCode < 300) {
        IdempotencyModel.updateOne({ scope, key }, { $set: { state: 'done', status: res.statusCode, body } }).catch((e) =>
          console.error('Failed to store idempotent response', e),
        )
      }
      return json(body)
    }
    // Errors and empty (204) responses don't go through the json override above.
    res.on('finish', () => {
      if (res.statusCode >= 400) IdempotencyModel.deleteOne({ scope, key, state: 'in_progress' }).catch(() => {})
      else if (res.statusCode === 204) IdempotencyModel.updateOne({ scope, key }, { $set: { state: 'done', status: 204 } }).catch(() => {})
    })
    next()
  }
