// Shared setup for integration tests: an in-memory MongoDB replica set (transactions need one)
// and the real Express app on a random port. Nothing touches a real database.
import type { AddressInfo } from 'node:net'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { currentStep, totpAt } from '../src/lib/totp.ts'

export async function startServer() {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
  process.env.MONGODB_URI = replSet.getUri('unfoldd_test')
  process.env.NODE_ENV = 'test'
  // The tests cover the 2FA flows, so they run with 2FA switched on.
  process.env.MFA_REQUIRED ??= 'true'
  // URL signing is local, so dummy R2 settings let media URLs be made without a bucket.
  process.env.R2_ACCOUNT_ID ??= 'test'
  process.env.R2_ACCESS_KEY_ID ??= 'test'
  process.env.R2_SECRET_ACCESS_KEY ??= 'test'
  process.env.R2_BUCKET ??= 'test'

  const { connectDb, disconnectDb } = await import('../src/config/db.ts')
  const { createApp } = await import('../src/app.ts')
  const mongoose = (await import('mongoose')).default
  await connectDb()
  // Create collections and indexes up front: transactions can't create them.
  await Promise.all(Object.values(mongoose.models).map((m) => m.createCollection().then(() => m.syncIndexes())))

  const server = createApp().listen(0)
  await new Promise((r) => server.once('listening', r))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`

  return {
    base,
    async stop() {
      server.close()
      await disconnectDb()
      await replSet.stop()
    },
  }
}

/** A browser: keeps its own cookies. */
export function agent(base: string) {
  const jar = new Map<string, string>()
  async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(jar.size ? { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';')
      const [k, v] = pair.split('=')
      if (v) jar.set(k, v)
      else jar.delete(k)
    }
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null }
  }
  return {
    get: (p: string) => call('GET', p),
    post: (p: string, b: unknown = {}, h?: Record<string, string>) => call('POST', p, b, h),
    patch: (p: string, b: unknown) => call('PATCH', p, b),
    put: (p: string, b: unknown) => call('PUT', p, b),
    del: (p: string) => call('DELETE', p),
  }
}

type Agent = ReturnType<typeof agent>

/** Finishes a 2FA challenge (owners and platform admins) with a code computed from the secret, as an app would. */
export async function completeMfa(a: Agent, start: { body: any }, path = '/auth/2fa') {
  const { challenge, mfa } = start.body
  if (!challenge) throw new Error(`No 2FA challenge: ${JSON.stringify(start.body)}`)
  let secret: string | undefined
  if (mfa === 'setup') secret = (await a.post(`${path}/setup`, { challenge })).body.secret
  if (!secret) throw new Error('Only first-time setup is automated in tests')
  return a.post(`${path}/verify`, { challenge, code: totpAt(secret, currentStep()) })
}

/** Signs up an agency (auto-approved in tests) and completes the owner's mandatory 2FA. */
export async function signupOwner(a: Agent, body: Record<string, unknown>) {
  const res = await a.post('/auth/signup', body)
  if (res.status !== 201) return res
  const verified = await completeMfa(a, res)
  return { ...res, verified }
}
