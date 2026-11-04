// End-to-end tests for search (P148–P150, F82): results respect the same scope as the lists (rule §12.1).
// In-memory MongoDB only.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { Types } from 'mongoose'
import { agent, signupOwner, startServer } from './helpers.ts'

let srv: Awaited<ReturnType<typeof startServer>>
let models: {
  Settings: typeof import('../src/modules/settings/settings.model.ts').SettingsModel
  Outbox: typeof import('../src/modules/notifications/outbox.model.ts').OutboxModel
  File: typeof import('../src/modules/files/file.model.ts').FileModel
}

before(async () => {
  srv = await startServer()
  models = {
    Settings: (await import('../src/modules/settings/settings.model.ts')).SettingsModel,
    Outbox: (await import('../src/modules/notifications/outbox.model.ts')).OutboxModel,
    File: (await import('../src/modules/files/file.model.ts')).FileModel,
  }
  await models.Settings.create({ key: 'platform', signups: { enabled: true, autoApprove: true } })
})

after(async () => {
  await srv.stop()
})

type Agent = ReturnType<typeof agent>

/** All result titles of one type, or [] when the type has no group. */
const titles = (body: { groups: { type: string; items: { title: string }[] }[] }, type: string) => body.groups.find((g) => g.type === type)?.items.map((i) => i.title) ?? []

async function acceptInvite(email: string, name: string) {
  const mail = await models.Outbox.findOne({ to: email }).sort({ createdAt: -1 }).lean()
  const a = agent(srv.base)
  const res = await a.post(`/invitations/${mail!.text.match(/\/invite\/([\w-]+)/)![1]}/accept`, { name, password: 'password123' })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  return a
}

describe('Search respects who can see what', () => {
  let owner: Agent
  let member: Agent
  let priya: Agent
  let agencyId = ''
  let clientA = ''
  let clientB = ''

  async function file(client: string, name: string, visibility: 'internal' | 'client') {
    await models.File.create({ agency: agencyId, client, purpose: 'library', name, mimeType: 'application/pdf', size: 1, key: `t/${new Types.ObjectId()}`, status: 'ready', visibility })
  }

  test('setup: two clients, a member assigned to one, a client person on the other', async () => {
    owner = agent(srv.base)
    await signupOwner(owner, { name: 'Asha Owner', email: 'asha@search.dev', password: 'password123', agencyName: 'Search Studio' })
    agencyId = (await owner.get('/auth/me')).body.agency.id
    clientA = (await owner.post('/clients', { name: 'Velvet Oven Foods', brandName: 'Velvet Oven' })).body.client._id
    clientB = (await owner.post('/clients', { name: 'Aeronext Ltd', brandName: 'Aeronext' })).body.client._id

    await owner.post('/agency/invitations', { email: 'mo@search.dev', role: 'member' })
    member = await acceptInvite('mo@search.dev', 'Mo Member')
    const moId = (await member.get('/auth/me')).body.user.id
    assert.equal((await owner.post(`/clients/${clientB}/access`, { userId: moId })).status, 201)

    await owner.post(`/clients/${clientA}/invitations`, { email: 'priya@search.dev', role: 'admin' })
    priya = await acceptInvite('priya@search.dev', 'Priya Rao')

    // Client A: one item sent to the client, one draft. Client B: one item.
    const sent = (await owner.post('/content', { client: clientA, title: 'Launch carousel', platform: 'instagram', format: 'carousel' })).body.content._id
    const f = await models.File.create({ agency: agencyId, client: clientA, purpose: 'version', name: 'v.jpg', mimeType: 'image/jpeg', size: 1, key: `t/${new Types.ObjectId()}`, status: 'ready' })
    await owner.post(`/content/${sent}/versions`, { files: [String(f._id)] })
    await owner.post(`/content/${sent}/submit`)
    const res = await owner.post(`/content/${sent}/internal-review`, { decision: 'approve_and_send' })
    assert.equal(res.body.content.state, 'client_review', JSON.stringify(res.body))
    await owner.post('/content', { client: clientA, title: 'Launch draft idea', platform: 'instagram', format: 'reel' })
    await owner.post('/content', { client: clientB, title: 'Launch teaser', platform: 'linkedin', format: 'linkedin' })
    await owner.post('/tasks', { client: clientA, title: 'Launch shoot' })

    await file(clientA, 'launch-brief-internal.pdf', 'internal')
    await file(clientA, 'launch-moodboard.pdf', 'client')
    await file(clientB, 'launch-specs.pdf', 'client')
  })

  test('the owner finds everything in the agency', async () => {
    const res = await owner.get('/search?q=launch')
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.deepEqual(titles(res.body, 'content').sort(), ['Launch carousel', 'Launch draft idea', 'Launch teaser'])
    assert.deepEqual(titles(res.body, 'tasks'), ['Launch shoot'])
    assert.equal(titles(res.body, 'files').length, 3)
    assert.ok(res.body.groups.every((g: { items: { link: string }[] }) => g.items.every((i) => i.link.startsWith('/app/'))))
  })

  test('a member without access to a client finds none of its work', async () => {
    const res = await member.get('/search?q=launch')
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.deepEqual(titles(res.body, 'content'), ['Launch teaser'])
    assert.deepEqual(titles(res.body, 'tasks'), [])
    assert.deepEqual(titles(res.body, 'files'), ['launch-specs.pdf'])
    assert.deepEqual(titles(await member.get('/search?q=velvet').then((r) => r.body), 'clients'), [])
    assert.deepEqual(titles(await member.get('/search?q=aero').then((r) => r.body), 'clients'), ['Aeronext'])
  })

  test('a client person finds only what was shared with them, in their own client', async () => {
    const res = await priya.get('/search?q=launch')
    assert.equal(res.status, 200, JSON.stringify(res.body))
    // The draft was never sent (D64); Aeronext's content belongs to another client.
    assert.deepEqual(titles(res.body, 'content'), ['Launch carousel'])
    // Internal files and the other client's files stay hidden.
    assert.deepEqual(titles(res.body, 'files'), ['launch-moodboard.pdf'])
    // Tasks, clients and the team are agency-only.
    for (const type of ['tasks', 'clients', 'people']) assert.deepEqual(titles(res.body, type), [])
    assert.ok(res.body.groups.every((g: { items: { link: string }[] }) => g.items.every((i) => i.link.startsWith('/c/'))))
  })

  test('short queries are refused and regex characters are literal', async () => {
    assert.equal((await owner.get('/search?q=l')).status, 400)
    const res = await owner.get(`/search?q=${encodeURIComponent('.*')}`)
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.groups, [])
  })
})
