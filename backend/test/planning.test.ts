// End-to-end tests for Phase 3 (dashboards, Needs Attention, health, banners) and Phase 4 (campaigns, content
// plans, requests, templates, calendar, delay indicators). In-memory MongoDB only.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { Types } from 'mongoose'
import { agent, signupOwner, startServer } from './helpers.ts'

let srv: Awaited<ReturnType<typeof startServer>>
let models: {
  Settings: typeof import('../src/modules/settings/settings.model.ts').SettingsModel
  Outbox: typeof import('../src/modules/notifications/outbox.model.ts').OutboxModel
  File: typeof import('../src/modules/files/file.model.ts').FileModel
  Notification: typeof import('../src/modules/notifications/notification.model.ts').NotificationModel
}

before(async () => {
  srv = await startServer()
  models = {
    Settings: (await import('../src/modules/settings/settings.model.ts')).SettingsModel,
    Outbox: (await import('../src/modules/notifications/outbox.model.ts')).OutboxModel,
    File: (await import('../src/modules/files/file.model.ts')).FileModel,
    Notification: (await import('../src/modules/notifications/notification.model.ts')).NotificationModel,
  }
  await models.Settings.create({ key: 'platform', signups: { enabled: true, autoApprove: true } })
})

after(async () => {
  await srv.stop()
})

const DAY = 86_400_000
const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString()
const day = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10)
const month = (offset: number) => {
  const d = new Date()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + offset)
  return d.toISOString().slice(0, 7)
}

describe('Phases 3 and 4: planning, requests and command centres', () => {
  let owner: ReturnType<typeof agent>
  let priya: ReturnType<typeof agent>
  let agencyId = ''
  let clientId = ''
  let priyaId = ''

  async function versionFile() {
    const f = await models.File.create({ agency: agencyId, client: clientId, purpose: 'version', name: 'a.jpg', mimeType: 'image/jpeg', size: 1, key: `t/${new Types.ObjectId()}`, status: 'ready' })
    return String(f._id)
  }

  /** Content sent to the client, with a publish date. */
  async function sentContent(title: string, publishDate: string) {
    const c = await owner.post('/content', { client: clientId, title, platform: 'instagram', format: 'square_1x1', publishDate })
    const id = c.body.content._id
    await owner.post(`/content/${id}/versions`, { files: [await versionFile()] })
    await owner.post(`/content/${id}/submit`)
    const sent = await owner.post(`/content/${id}/internal-review`, { decision: 'approve_and_send' })
    assert.equal(sent.body.content.state, 'client_review', JSON.stringify(sent.body))
    return sent.body.content
  }

  test('setup', async () => {
    owner = agent(srv.base)
    await signupOwner(owner, { name: 'Asha Owner', email: 'asha@test.dev', password: 'password123', agencyName: 'Test Studio' })
    agencyId = (await owner.get('/auth/me')).body.agency.id
    clientId = (await owner.post('/clients', { name: 'Velvet Oven', brandName: 'Velvet Oven' })).body.client._id
    await owner.post(`/clients/${clientId}/invitations`, { email: 'priya@brand.dev', role: 'admin' })
    const mail = await models.Outbox.findOne({ to: 'priya@brand.dev' }).lean()
    priya = agent(srv.base)
    await priya.post(`/invitations/${mail!.text.match(/\/invite\/([\w-]+)/)![1]}/accept`, { name: 'Priya Rao', password: 'password123' })
    priyaId = (await priya.get('/auth/me')).body.user.id
  })

  test('campaign progress is derived from its content', async () => {
    const created = await owner.post('/campaigns', { client: clientId, name: 'Diwali 2026', objective: 'Festive sales', brief: { strategy: 'internal only' } })
    assert.equal(created.status, 201, JSON.stringify(created.body))
    const id = created.body.campaign._id
    await owner.post('/content', { client: clientId, title: 'Teaser', platform: 'instagram', format: 'reel', campaign: id })
    const detail = await owner.get(`/campaigns/${id}`)
    assert.equal(detail.body.campaign.progress.total, 1)
    assert.equal(detail.body.campaign.progress.percent, 0)

    // The client sees the campaign but not the internal brief.
    const client = await priya.get('/client/campaigns')
    assert.equal(client.body.items.length, 1)
    assert.equal(client.body.items[0].brief, undefined)
  })

  test('content plan: bulk items, send with banner, request changes needs a comment, approve', async () => {
    const plan = await owner.post('/plans', { client: clientId, month: month(1) })
    assert.equal(plan.status, 201, JSON.stringify(plan.body))
    const planId = plan.body.plan._id
    assert.equal((await owner.post('/plans', { client: clientId, month: month(1) })).status, 409)

    const bulk = await owner.post(`/plans/${planId}/items/bulk`, { groups: [{ platform: 'instagram', format: 'feed_4x5', count: 3 }, { platform: 'linkedin', format: 'linkedin', count: 1 }] })
    assert.equal(bulk.status, 201, JSON.stringify(bulk.body))
    assert.equal(bulk.body.items.length, 4)
    assert.ok(bulk.body.items.every((i: any) => i.state === 'planned'))

    // Not visible before it's sent (D64).
    assert.equal((await priya.get('/client/plans')).body.items.length, 0)
    const sent = await owner.post(`/plans/${planId}/send`)
    assert.equal(sent.body.plan.status, 'sent', JSON.stringify(sent.body))

    const home = await priya.get('/client/home')
    assert.equal(home.body.banners.length, 1)
    assert.match(home.body.banners[0].headline, /plan is ready/)
    assert.ok(home.body.needsAttention.items.some((i: any) => i.kind === 'plan'))

    const noComment = await priya.post(`/client/plans/${planId}/request-changes`, { expectedStatus: 'sent' })
    assert.equal(noComment.status, 400)

    const view = await priya.get(`/client/plans/${planId}`)
    assert.equal(view.body.plan.label, 'Review Required')
    const item = view.body.plan.items[0]
    await priya.post(`/client/plans/${planId}/threads`, { item: item._id, body: 'Swap this for a recipe post' })
    const changes = await priya.post(`/client/plans/${planId}/request-changes`, { expectedStatus: 'sent' })
    assert.equal(changes.status, 200, JSON.stringify(changes.body))
    assert.equal((await priya.get('/client/home')).body.banners.length, 0)

    await owner.post(`/plans/${planId}/send`)
    const approved = await priya.post(`/client/plans/${planId}/approve`, { expectedStatus: 'sent' })
    assert.equal(approved.body.plan.status, 'approved')

    // D34: an edit after approval flags the item and tells the client once.
    const detail = await owner.get(`/content/${item._id}`)
    await owner.patch(`/content/${item._id}`, { rev: detail.body.content.rev, title: 'Recipe post' })
    const again = await owner.get(`/content/${item._id}`)
    await owner.patch(`/content/${item._id}`, { rev: again.body.content.rev, idea: 'Grandma’s recipe' })
    const flagged = (await priya.get(`/client/plans/${planId}`)).body.plan.items.find((i: any) => i._id === item._id)
    assert.equal(flagged.updatedSinceApproval, true)
    assert.equal(await models.Notification.countDocuments({ event: 'plan.updated_since_approval' }), 1)
  })

  test('requests: tasks wait on them, client health shows Blocked, uploads land in the library', async () => {
    const r = await owner.post('/requests', { client: clientId, title: 'Logo in SVG', due: day(-2), uploadCategory: 'brand' })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    const requestId = r.body.request._id

    const task = await owner.post('/tasks', { client: clientId, title: 'Build the brand kit' })
    const dep = await owner.put(`/tasks/${task.body.task._id}/dependencies`, { dependencies: [{ type: 'request', id: requestId }] })
    assert.equal(dep.body.task.blocked.isBlocked, true, JSON.stringify(dep.body))

    const clients = await owner.get('/clients')
    assert.equal(clients.body.items[0].health.health, 'blocked')

    // Client side: it's in Needed From You and on Home, overdue.
    const list = await priya.get('/client/requests')
    assert.equal(list.body.items[0].label, 'Needed')
    assert.equal(list.body.items[0].overdue, true)
    assert.ok((await priya.get('/client/home')).body.needsAttention.items.some((i: any) => i.kind === 'request'))

    // The client uploads (here: the file row R2 would have produced) and attaches it.
    const file = await models.File.create({
      agency: agencyId,
      client: clientId,
      purpose: 'request',
      name: 'logo.svg',
      mimeType: 'image/svg+xml',
      size: 10,
      key: `t/${new Types.ObjectId()}`,
      status: 'ready',
      visibility: 'client',
      uploadedBy: { id: priyaId, name: 'Priya Rao', side: 'client' },
    })
    const attached = await priya.post(`/client/requests/${requestId}/files`, { file: String(file._id) })
    assert.equal(attached.status, 201, JSON.stringify(attached.body))
    const submitted = await priya.post(`/client/requests/${requestId}/submit`, { response: 'Here you go' })
    assert.equal(submitted.body.request.label, 'Submitted', JSON.stringify(submitted.body))
    assert.equal(submitted.body.request.files[0].locked, true)
    assert.equal((await priya.del(`/client/requests/${requestId}/files/${file._id}`)).status, 409)

    // D36: it's in the client's library, under the request's category.
    const library = await priya.get('/files?category=brand')
    assert.equal(library.body.items.length, 1)

    const done = await owner.post(`/requests/${requestId}/complete`)
    assert.equal(done.body.request.status, 'completed', JSON.stringify(done.body))
    assert.equal((await owner.get(`/tasks/${task.body.task._id}`)).body.task.blocked.isBlocked, false)
  })

  test('templates prefill and add production tasks, and refuse approval steps (D55)', async () => {
    const bad = await owner.post('/templates', { type: 'task_list', name: 'Bad', body: { tasks: [{ title: 'Client approval' }] } })
    assert.equal(bad.status, 400)
    const withStatus = await owner.post('/templates', { type: 'content', name: 'Bad', body: { state: 'approved' } })
    assert.equal(withStatus.status, 400)

    const tpl = await owner.post('/templates', {
      type: 'content',
      name: 'Carousel',
      body: { platform: 'instagram', format: 'carousel', brief: 'Five slides, hook first', tasks: [{ title: 'Write copy', dueOffsetDays: 1 }, { title: 'Design slides', dueOffsetDays: 3 }] },
    })
    assert.equal(tpl.status, 201, JSON.stringify(tpl.body))
    const content = await owner.post('/content', { client: clientId, title: 'Tips carousel', platform: 'instagram', format: 'carousel', template: tpl.body.template._id })
    assert.equal(content.body.content.brief, 'Five slides, hook first')
    const tasks = await owner.get(`/tasks?content=${content.body.content._id}`)
    assert.deepEqual(tasks.body.items.map((t: any) => t.title).sort(), ['Design slides', 'Write copy'])
  })

  test('dashboard: needs attention, pending approvals and workload, all computed', async () => {
    // Publishing in two days, not approved: needed-by is tomorrow, inside the 3-day risk window.
    await sentContent('Launch post', iso(2 * DAY))
    await owner.post('/tasks', { client: clientId, title: 'Overdue thing', due: day(-3) })

    const dash = await owner.get('/dashboard')
    assert.equal(dash.status, 200, JSON.stringify(dash.body))
    const kinds = dash.body.needsAttention.items.map((i: any) => i.kind)
    assert.ok(kinds.includes('at_risk'), kinds.join(','))
    assert.ok(kinds.includes('task_overdue'), kinds.join(','))
    assert.equal(dash.body.pendingApprovals.length, 1)
    assert.equal(dash.body.metrics.awaitingApproval, 1)
    assert.ok(dash.body.workload[0].activeTasks >= 1)
    assert.equal(dash.body.clients[0].health, 'needs_attention')
  })

  test('schedule shift: needs a reason once the client has seen the date; the client sees N days', async () => {
    const content = await sentContent('Moving post', iso(10 * DAY))
    const noReason = await owner.patch(`/content/${content._id}`, { rev: content.rev, publishDate: iso(12 * DAY) })
    assert.equal(noReason.status, 400)
    const moved = await owner.patch(`/content/${content._id}`, { rev: content.rev, publishDate: iso(12 * DAY), shiftReason: 'client_delay' })
    assert.equal(moved.status, 200, JSON.stringify(moved.body))
    const client = await priya.get(`/client/content/${content._id}`)
    assert.equal(client.body.content.delay.shiftedDays, 2)
    assert.ok(client.body.content.delay.reviewPendingSince)
  })

  test('calendar: agency layers, client view, range limit', async () => {
    const from = iso(-5 * DAY)
    const to = iso(20 * DAY)
    const agencyCal = await owner.get(`/calendar?from=${from}&to=${to}`)
    assert.equal(agencyCal.status, 200, JSON.stringify(agencyCal.body))
    const layers = new Set(agencyCal.body.events.map((e: any) => e.layer))
    assert.ok(layers.has('content') && layers.has('tasks'))
    assert.ok(agencyCal.body.events.some((e: any) => e.layer === 'content' && e.risk.atRisk))

    const clientCal = await priya.get(`/client/calendar?from=${from}&to=${to}`)
    assert.ok(clientCal.body.events.every((e: any) => e.layer === 'content' || e.layer === 'requests'))
    assert.ok(clientCal.body.events.every((e: any) => e.risk === undefined))

    assert.equal((await owner.get(`/calendar?from=${from}&to=${iso(100 * DAY)}`)).status, 400)
  })

  test('banners: scheduled ones stay hidden until their start; ending one removes it', async () => {
    const later = await owner.post('/banners', { client: clientId, headline: 'Coming soon', startAt: iso(DAY), publish: true })
    assert.equal(later.body.banner.state, 'scheduled', JSON.stringify(later.body))
    const now = await owner.post('/banners', { client: clientId, headline: 'Festive offer', cta: { label: 'See plan', link: '/c/plans' }, publish: true })
    assert.equal(now.body.banner.state, 'live')
    assert.equal((await owner.post('/banners', { client: clientId, headline: 'x', cta: { label: 'x', link: 'https://evil.example' } })).status, 400)

    let home = await priya.get('/client/home')
    assert.deepEqual(home.body.banners.map((b: any) => b.headline), ['Festive offer'])
    await owner.post(`/banners/${now.body.banner._id}/end`)
    home = await priya.get('/client/home')
    assert.equal(home.body.banners.length, 0)
  })
})
