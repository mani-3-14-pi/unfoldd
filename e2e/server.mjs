// The API for the end-to-end tests: an in-memory MongoDB replica set (transactions need one) and the backend
// on it. It never reads backend/.env, so tests can't touch a real database, storage bucket or email provider.
// Playwright starts this as a web server; the DB address is written to e2e/.tmp/mongo-uri for the test helpers.
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const backend = join(here, '..', 'backend')
const require = createRequire(join(backend, 'package.json'))
const { MongoMemoryReplSet } = require('mongodb-memory-server')
const mongoose = require('mongoose')

export const API_PORT = process.env.E2E_API_PORT ?? '8790'

const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
const uri = replSet.getUri('unfoldd_e2e')

// New agencies are approved at once, so each test can sign up its own owner.
await mongoose.connect(uri)
await mongoose.connection.db.collection('settings').updateOne(
  { key: 'platform' },
  { $set: { key: 'platform', signups: { enabled: true, autoApprove: true }, supportSessionMinutes: 60 } },
  { upsert: true },
)
await mongoose.disconnect()

mkdirSync(join(here, '.tmp'), { recursive: true })
writeFileSync(join(here, '.tmp', 'mongo-uri'), uri)

const api = spawn(process.execPath, ['src/server.ts'], {
  cwd: backend,
  stdio: 'inherit',
  env: {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    NODE_ENV: 'development',
    PORT: API_PORT,
    MONGODB_URI: uri,
    APP_URL: 'http://localhost:5175',
    // 2FA stays off here, as in development; the backend's own tests cover it.
    MFA_REQUIRED: 'false',
    AI_PROVIDER: 'none',
  },
})

const stop = async () => {
  api.kill()
  await replSet.stop()
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
api.on('exit', async (code) => {
  await replSet.stop()
  process.exit(code ?? 1)
})
