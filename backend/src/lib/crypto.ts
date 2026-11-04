import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { env, isProd } from '../config/env.ts'

/*
 * Encryption for secrets kept in the database: 2FA seeds and platform access tokens.
 * AES-256-GCM with the key from SECRET_KEY. Stored as `v1.<iv>.<tag>.<data>` (base64url).
 */

function key() {
  if (env.SECRET_KEY) return createHash('sha256').update(env.SECRET_KEY).digest()
  if (isProd) throw new Error('SECRET_KEY must be set in production.')
  // Development only: a stable key so local data survives restarts. Never used in production.
  return createHash('sha256').update(`dev-only:${env.MONGODB_URI}`).digest()
}

export function encrypt(plain: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.')
}

export function decrypt(stored: string) {
  const [v, iv, tag, data] = stored.split('.')
  if (v !== 'v1' || !iv || !tag || !data) throw new Error('Unknown secret format.')
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8')
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url')
export const sha256 = (s: string) => createHash('sha256').update(s).digest('base64url')
