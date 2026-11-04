import { createHash } from 'node:crypto'
import { Router } from 'express'
import type { Types } from 'mongoose'
import { z } from 'zod'
import { env } from '../../config/env.ts'
import { logActivity } from '../../lib/activity.ts'
import { decrypt, encrypt, randomToken, sha256 } from '../../lib/crypto.ts'
import { objectId } from '../../lib/ids.ts'
import { OAUTH_APPS, OAUTH_PROVIDER, PLATFORM_CATALOG, PROVIDERS, usesPkce, type ConnectableAccount, type OAuthApp } from '../../lib/platforms/index.ts'
import { loadClient } from '../../lib/scope.ts'
import { requireAgencyUser } from '../../middleware/auth.ts'
import { AppError, notFound } from '../../utils/AppError.ts'
import { ConnectionModel, OAuthStateModel } from './connection.model.ts'
import { sealTokens, usableConnection } from './connections.service.ts'

/**
 * Connecting a client's social accounts (D66). Flow:
 *   1. POST /integrations/:app/authorize { client }      → { url } to send the browser to
 *   2. the platform redirects to GET /integrations/:app/callback (public; the state ties it to step 1)
 *   3. the browser lands on the portal, which lists GET /integrations/pending/:state
 *   4. POST /integrations/pending/:state { accounts: [...] } connects the chosen ones
 */
export const integrationsRouter = Router()

const STATE_TTL_MS = 15 * 60_000
const redirectUri = (app: OAuthApp) => `${env.API_URL.replace(/\/$/, '')}/api/integrations/${app}/callback`

const appParam = (s: unknown) => {
  if (!(OAUTH_APPS as readonly unknown[]).includes(s)) throw notFound('Unknown platform.')
  return s as OAuthApp
}

/** What each platform can do here, and whether its app credentials are set. */
integrationsRouter.get('/platforms', requireAgencyUser, (_req, res) => {
  res.json({
    items: PLATFORM_CATALOG.map((p) => {
      const provider = PROVIDERS[p.key as keyof typeof PROVIDERS]
      return { ...p, configured: provider?.configured() ?? false, formats: provider?.formats ?? [] }
    }),
  })
})

integrationsRouter.post('/:app/authorize', requireAgencyUser, async (req, res) => {
  const app = appParam(req.params.app)
  const provider = OAUTH_PROVIDER[app]
  if (!provider.configured()) throw new AppError(503, 'integration_not_configured', `${provider.label} isn’t set up on this server yet.`)
  const client = await loadClient(req, objectId(z.object({ client: z.string() }).parse(req.body).client, 'Client not found.'), 'manage')
  const state = randomToken()
  const verifier = usesPkce(app) ? randomToken(48) : null
  await OAuthStateModel.create({
    stateHash: sha256(state),
    app,
    agency: client.agency,
    client: client._id,
    user: { id: req.agencyAuth!.user._id, name: req.agencyAuth!.user.name },
    codeVerifier: verifier ? encrypt(verifier) : null,
    expiresAt: new Date(Date.now() + STATE_TTL_MS),
  })
  const codeChallenge = verifier ? createHash('sha256').update(verifier).digest('base64url') : undefined
  res.json({ url: provider.authorizeUrl({ state, redirectUri: redirectUri(app), codeChallenge }) })
})

/** The platform sends the browser here. Public: the one-time state is the proof of who started it. */
integrationsRouter.get('/:app/callback', async (req, res) => {
  const app = appParam(req.params.app)
  const q = z.object({ code: z.string().optional(), state: z.string(), error: z.string().optional() }).parse(req.query)
  const back = (params: Record<string, string>) => res.redirect(`${env.APP_URL.replace(/\/$/, '')}/app/integrations/callback?${new URLSearchParams(params)}`)
  const st = await OAuthStateModel.findOne({ stateHash: sha256(q.state), app })
  if (!st || st.expiresAt.getTime() < Date.now()) return back({ error: 'expired' })
  if (q.error || !q.code) return back({ error: q.error ?? 'cancelled' })
  try {
    const accounts = await OAUTH_PROVIDER[app].connect({ code: q.code, redirectUri: redirectUri(app), codeVerifier: st.codeVerifier ? decrypt(st.codeVerifier) : undefined })
    st.found = encrypt(JSON.stringify(accounts))
    await st.save()
    back({ state: q.state, client: String(st.client) })
  } catch (err) {
    console.error(`OAuth callback for ${app} failed`, err)
    back({ error: 'connect_failed' })
  }
})

async function pending(state: string, agency: Types.ObjectId) {
  const st = await OAuthStateModel.findOne({ stateHash: sha256(state), agency })
  if (!st?.found) throw notFound('This connection attempt expired. Start again.')
  return { st, accounts: JSON.parse(decrypt(st.found)) as ConnectableAccount[] }
}

/** The accounts found, without their tokens, for the person to choose from. */
integrationsRouter.get('/pending/:state', requireAgencyUser, async (req, res) => {
  const { st, accounts } = await pending(String(req.params.state), req.agencyAuth!.agency._id)
  res.json({ client: st.client, accounts: accounts.map(({ tokens: _t, ...a }) => a) })
})

integrationsRouter.post('/pending/:state', requireAgencyUser, async (req, res) => {
  const { accounts: picks } = z.object({ accounts: z.array(z.object({ platform: z.string(), externalId: z.string() })).min(1).max(50) }).parse(req.body)
  const { st, accounts } = await pending(String(req.params.state), req.agencyAuth!.agency._id)
  const client = await loadClient(req, st.client, 'manage')
  const me = req.agencyAuth!.user
  const connected = []
  for (const pick of picks) {
    const a = accounts.find((x) => x.platform === pick.platform && x.externalId === pick.externalId)
    if (!a) continue
    const conn = await ConnectionModel.findOneAndUpdate(
      { client: client._id, platform: a.platform, externalId: a.externalId },
      {
        $set: { agency: client.agency, name: a.name, handle: a.handle ?? '', tokens: sealTokens(a.tokens), tokenExpiresAt: a.tokens.expiresAt ?? null, meta: a.meta ?? {}, status: 'active', lastError: '', lastCheckedAt: new Date(), connectedBy: { id: me._id, name: me.name } },
      },
      { upsert: true, returnDocument: 'after' },
    ).lean()
    connected.push(conn)
    await logActivity(req, {
      action: 'integration.connected',
      message: `${me.name} connected ${PROVIDERS[a.platform].label} (${a.name}) to ${client.brandName}`,
      agency: client.agency,
      client: client._id,
      target: { type: 'connection', id: conn!._id, label: a.name },
    })
  }
  await OAuthStateModel.deleteOne({ _id: st._id })
  res.status(201).json({ connections: connected })
})

integrationsRouter.get('/connections', requireAgencyUser, async (req, res) => {
  const client = await loadClient(req, objectId(z.object({ client: z.string() }).parse(req.query).client, 'Client not found.'))
  res.json({ items: await ConnectionModel.find({ client: client._id, status: { $ne: 'disconnected' } }).sort({ platform: 1, name: 1 }).lean() })
})

/** Checks a connection right now (and refreshes its token if needed). */
integrationsRouter.post('/connections/:id/check', requireAgencyUser, async (req, res) => {
  const conn = await ConnectionModel.findOne({ _id: objectId(req.params.id, 'Connection not found.'), agency: req.agencyAuth!.agency._id }).lean()
  if (!conn) throw notFound('Connection not found.')
  await loadClient(req, conn.client)
  try {
    const { provider, account } = await usableConnection(conn._id)
    await provider.check(account)
    await ConnectionModel.updateOne({ _id: conn._id }, { $set: { status: 'active', lastError: '', lastCheckedAt: new Date() } })
    res.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await ConnectionModel.updateOne({ _id: conn._id }, { $set: { status: 'error', lastError: message.slice(0, 500), lastCheckedAt: new Date() } })
    res.json({ ok: false, error: message })
  }
})

integrationsRouter.delete('/connections/:id', requireAgencyUser, async (req, res) => {
  const conn = await ConnectionModel.findOne({ _id: objectId(req.params.id, 'Connection not found.'), agency: req.agencyAuth!.agency._id }).lean()
  if (!conn) throw notFound('Connection not found.')
  await loadClient(req, conn.client, 'manage')
  // Keep the row (history points at it); drop the tokens.
  await ConnectionModel.updateOne({ _id: conn._id }, { $set: { status: 'disconnected', tokens: sealTokens({ accessToken: '' }) } })
  res.status(204).end()
})
