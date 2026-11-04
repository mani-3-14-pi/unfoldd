import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, type Browser, type Page } from '@playwright/test'
import { MongoClient, ObjectId } from 'mongodb'

let counter = 0
/** A unique suffix per call, so parallel tests never collide on emails or names. */
export const unique = () => `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`

const dbUri = () => readFileSync(join(__dirname, '.tmp', 'mongo-uri'), 'utf8')

/** Direct access to the test database, for what the browser can't do without outside services (R2, email). */
export async function withDb<T>(fn: (db: ReturnType<MongoClient['db']>) => Promise<T>) {
  const client = await MongoClient.connect(dbUri())
  try {
    return await fn(client.db())
  } finally {
    await client.close()
  }
}

/** Fails the test on any page error or console error (missing media is expected without R2). */
export function watchErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/503|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`)
  })
  page.on('response', (r) => {
    if (r.status() >= 500 && !(r.status() === 503 && r.url().includes('/api/files'))) errors.push(`${r.status()} ${r.url()}`)
  })
  return () => expect(errors, errors.join('\n')).toEqual([])
}

/** Signs up a new agency through the UI (approved at once in the test setup) and lands on the dashboard. */
export async function signUpOwner(page: Page) {
  const id = unique()
  const email = `owner-${id}@e2e.test`
  await page.goto('/signup')
  await page.fill('#su-name', 'Asha Owner')
  await page.fill('#su-email', email)
  await page.fill('#su-agency', `Studio ${id}`)
  await page.fill('#su-password', 'correct-horse-battery')
  await page.click('button[type=submit]')
  await page.waitForURL('**/app')
  return { email, agencyName: `Studio ${id}` }
}

/** Calls the API with the page's session cookie. Create actions get an Idempotency-Key. */
export async function api<T = any>(page: Page, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, data?: unknown): Promise<T> {
  const res = await page.request.fetch(`/api${path}`, {
    method,
    data,
    headers: method === 'POST' ? { 'Idempotency-Key': crypto.randomUUID() } : undefined,
  })
  expect(res.ok(), `${method} ${path}: ${res.status()} ${await res.text()}`).toBeTruthy()
  return res.status() === 204 ? (undefined as T) : res.json()
}

/** Stands in for an R2 upload: ready "version" files for a client, straight into the database. */
export function seedVersionFiles(clientId: string, count = 2) {
  return withDb(async (db) => {
    const client = await db.collection('clients').findOne({ _id: new ObjectId(clientId) })
    const owner = await db.collection('memberships').findOne({ agency: client!.agency, role: 'owner' })
    const user = await db.collection('users').findOne({ _id: owner!.user })
    const ids: string[] = []
    for (let i = 0; i < count; i++) {
      const _id = new ObjectId()
      await db.collection('files').insertOne({
        _id,
        agency: client!.agency,
        client: client!._id,
        purpose: 'version',
        name: `slide-${i + 1}.png`,
        mimeType: 'image/png',
        size: 1000,
        key: `e2e/${_id}`,
        status: 'ready',
        category: 'other',
        visibility: 'internal',
        uploadedBy: { id: user!._id, name: user!.name, side: 'agency' },
        usedIn: [],
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      ids.push(String(_id))
    }
    return ids
  })
}

/** The invite link's token from the outbox (the dev mailer never sends anything). */
export async function inviteToken(email: string) {
  for (let i = 0; i < 40; i++) {
    const mail = await withDb((db) => db.collection('outboxemails').find({ to: email }).sort({ _id: -1 }).limit(1).next())
    const token = mail?.text.match(/\/invite\/([A-Za-z0-9_-]+)/)?.[1]
    if (token) return token
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`No invitation email for ${email}`)
}

/** A client with V01 sent for review: the starting point for the review tests. */
export async function contentInReview(page: Page) {
  const { client } = await api(page, 'POST', '/clients', { name: 'Velvet Oven Foods', brandName: 'Velvet Oven', timezone: 'Asia/Kolkata' })
  const { content } = await api(page, 'POST', '/content', { client: client._id, title: 'Diwali menu carousel', platform: 'instagram', format: 'carousel' })
  await api(page, 'POST', `/content/${content._id}/versions`, { files: await seedVersionFiles(client._id), caption: 'Light up your Diwali' })
  await api(page, 'POST', `/content/${content._id}/submit`)
  await api(page, 'POST', `/content/${content._id}/internal-review`, { decision: 'approve_and_send' })
  return { clientId: client._id as string, contentId: content._id as string }
}

/** Invites a client admin and accepts the link in a fresh browser: returns that person's page, in the client app. */
export async function clientAdmin(browser: Browser, agencyPage: Page, clientId: string) {
  const email = `client-${unique()}@e2e.test`
  await api(agencyPage, 'POST', `/clients/${clientId}/invitations`, { email, role: 'admin' })
  const token = await inviteToken(email)
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(`/invite/${token}`)
  await page.fill('#invite-name', 'Priya Client')
  await page.fill('#invite-password', 'client-pass-123')
  await page.getByRole('button', { name: 'Accept and create account' }).click()
  await page.waitForURL('**/c')
  return page
}

/** The status pill in a portal page header, matched exactly (not "Mark as published" for "Published"). */
export const headerPill = (page: Page, label: string) => page.locator('header span.rounded-full', { hasText: new RegExp(`^${label}$`) }).first()
