import type { Types } from 'mongoose'
import { decrypt, encrypt } from '../../lib/crypto.ts'
import { notify } from '../../lib/notify.ts'
import { PROVIDERS, PublishError, type PlatformKey, type Tokens } from '../../lib/platforms/index.ts'
import { ClientModel } from '../clients/client.model.ts'
import { ConnectionModel } from './connection.model.ts'

const REFRESH_AHEAD_MS = 10 * 60_000

export const sealTokens = (t: Tokens) => encrypt(JSON.stringify(t))

function unseal(sealed: string): Tokens {
  const t = JSON.parse(decrypt(sealed))
  return { ...t, expiresAt: t.expiresAt ? new Date(t.expiresAt) : null }
}

/**
 * A connection with usable tokens, refreshed first when they're about to expire. A failed refresh marks the
 * connection expired and raises a "Reconnect" alert.
 */
export async function usableConnection(id: Types.ObjectId) {
  const conn = await ConnectionModel.findById(id).select('+tokens')
  if (!conn || conn.status === 'disconnected') throw new PublishError('auth', 'The account was disconnected.')
  let tokens = unseal(conn.tokens)
  const provider = PROVIDERS[conn.platform as PlatformKey]
  if (tokens.expiresAt && tokens.expiresAt.getTime() - Date.now() < REFRESH_AHEAD_MS) {
    if (!provider.refresh) {
      await markBroken(conn._id, 'expired', 'Access expired.')
      throw new PublishError('auth', `${provider.label} access expired. Reconnect the account.`)
    }
    try {
      tokens = await provider.refresh(tokens)
      await ConnectionModel.updateOne({ _id: conn._id }, { $set: { tokens: sealTokens(tokens), tokenExpiresAt: tokens.expiresAt ?? null, status: 'active', lastError: '' } })
    } catch (err) {
      await markBroken(conn._id, 'expired', err instanceof Error ? err.message : String(err))
      throw new PublishError('auth', `${provider.label} access expired. Reconnect the account.`)
    }
  }
  return { conn, provider, account: { externalId: conn.externalId, tokens } }
}

/** D27: "Reconnect Instagram" to the client's team, once per breakage. */
export async function markBroken(id: Types.ObjectId, status: 'expired' | 'error', error: string) {
  const conn = await ConnectionModel.findOneAndUpdate({ _id: id, status: 'active' }, { $set: { status, lastError: error.slice(0, 500) } }, { returnDocument: 'after' }).lean()
  if (!conn) return
  const client = await ClientModel.findById(conn.client, { accountManager: 1, brandName: 1 }).lean()
  const label = PROVIDERS[conn.platform as PlatformKey].label
  await notify({
    recipients: [conn.connectedBy?.id, client?.accountManager].filter(Boolean) as Types.ObjectId[],
    audience: 'agency',
    agency: conn.agency,
    client: conn.client,
    category: 'publishing',
    event: 'connection.broken',
    title: `Reconnect ${label} for ${client?.brandName}`,
    body: `${conn.name}: ${error.slice(0, 200)}`,
    entity: { type: 'connection', id: conn._id },
    link: `/app/clients/${conn.client}/integrations`,
    urgent: true,
  })
}
