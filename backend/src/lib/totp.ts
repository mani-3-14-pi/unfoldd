import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/** RFC 6238 time-based one-time passwords (authenticator apps), 30-second steps, 6 digits, SHA-1. */

const STEP_S = 30
const DIGITS = 6
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(buf: Buffer) {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(s: string) {
  const clean = s.replace(/=+$/, '').replace(/\s/g, '').toUpperCase()
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch)
    if (idx < 0) throw new Error('Invalid base32')
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

export const newTotpSecret = () => base32Encode(randomBytes(20))

export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_S)

export function totpAt(secret: string, step: number) {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(step))
  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest()
  const offset = hmac[hmac.length - 1] & 0xf
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS
  return String(code).padStart(DIGITS, '0')
}

/**
 * Checks a code against the current step and one step either side (clock drift). Returns the matching step,
 * so the caller can refuse a code that was already used (replay), or null.
 */
export function verifyTotp(secret: string, code: string, opts: { notAfterStep?: number | null; now?: number } = {}) {
  const clean = code.replace(/\s/g, '')
  if (!/^\d{6}$/.test(clean)) return null
  const now = currentStep(opts.now)
  for (const step of [now - 1, now, now + 1]) {
    if (opts.notAfterStep != null && step <= opts.notAfterStep) continue
    const expected = Buffer.from(totpAt(secret, step))
    if (timingSafeEqual(expected, Buffer.from(clean))) return step
  }
  return null
}

export const otpauthUrl = (secret: string, account: string, issuer = 'Unfoldd') =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_S}`
