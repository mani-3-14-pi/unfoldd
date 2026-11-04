import { randomBytes, scrypt, timingSafeEqual, type BinaryLike } from 'node:crypto'

const KEY_LEN = 64

const derive = (password: string, salt: BinaryLike) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, KEY_LEN, { N: 16384, r: 8, p: 1 }, (err, key) => (err ? reject(err) : resolve(key))),
  )

/** Stored as `scrypt$<salt>$<hash>` (base64url) so the parameters can change later. */
export async function hashPassword(password: string) {
  const salt = randomBytes(16)
  const key = await derive(password, salt)
  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, salt, hash] = stored.split('$')
  if (scheme !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64url')
  const key = await derive(password, Buffer.from(salt, 'base64url'))
  return key.length === expected.length && timingSafeEqual(key, expected)
}

// Compared against when the account doesn't exist, so a wrong username takes as long as a wrong password.
export const DUMMY_HASH = await hashPassword(randomBytes(16).toString('hex'))
