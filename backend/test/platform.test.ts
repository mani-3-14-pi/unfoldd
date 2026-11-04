// End-to-end tests for the job queue, email, 2FA, Phase 5 (brand, meetings, library, conversations),
// Phase 6 (publishing with a fake platform, analytics, reports) and Phase 7 (account, permissions, support).
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { Types } from 'mongoose'
import { agent, completeMfa, startServer } from './helpers.ts'

let srv: Awaited<ReturnType<typeof startServer>>
let jobs: typeof import('../src/lib/jobs.ts')
let totp: typeof import('../src/lib/totp.ts')
let platforms: typeof import('../src/lib/platforms/index.ts')
let M: Record<string, any>

before(async () => {
  srv = await startServer()
  await import('../src/worker.ts')
  jobs = await import('../src/lib/jobs.ts')
  totp = await import('../src/lib/totp.ts')
  platforms = await import('../src/lib/platforms/index.ts')
  M = {
    Settings: (await import('../src/modules/settings/settings.model.ts')).SettingsModel,
    Outbox: (await import('../src/modules/notifications/outbox.model.ts')).OutboxModel,
    File: (await import('../src/modules/files/file.model.ts')).FileModel,
    Job: (await import('../src/modules/jobs/job.model.ts')).JobModel,
    User: (await import('../src/modules/users/user.model.ts')).UserModel,
    Admin: (await import('../src/modules/platform-admins/platformAdmin.model.ts')).PlatformAdminModel,
    Content: (await import('../src/modules/content/content.model.ts')).ContentModel,
    PublishJob: (await import('../src/modules/content/publishJob.model.ts')).PublishJobModel,
    Connection: (await import('../src/modules/publishing/connection.model.ts')).ConnectionModel,
    Snapshot: (await import('../src/modules/analytics/analytics.model.ts')).AnalyticsSnapshotModel,
    Notification: (await import('../src/modules/notifications/notification.model.ts')).NotificationModel,
    Task: (await import('../src/modules/tasks/task.model.ts')).TaskModel,
    Request: (await import('../src/modules/requests/request.model.ts')).RequestModel,
  }
  await M.Settings.create({ key: 'platform', signups: { enabled: true, autoApprove: true } })
})

after(async () => {
  await srv.stop()
})

const DAY = 86_400_000
const inviteToken = async (email: string) => (await M.Outbox.findOne({ to: email, kind: 'invitation' }).sort({ createdAt: -1 }).lean()).text.match(/\/invite\/([\w-]+)/)[1]

describe('Platform: jobs, email, 2FA, phases 5–7', () => {
  let owner: ReturnType<typeof agent>
  let priya: ReturnType<typeof agent>
  let agencyId = ''
  let clientId = ''
  let priyaId = ''
  let ownerSecret = ''

  test('job queue: retries with backoff, gives up, and dedupes unique jobs', async () => {
    let calls = 0
    jobs.registerJob('test.flaky', async () => {
      calls++
      if (calls < 2) throw new Error('first try fails')
    })
    jobs.registerJob('test.broken', async () => {
      throw new jobs.PermanentJobError('never works')
    })
    await jobs.enqueue('test.flaky')
    await jobs.drainJobs()
    const flaky = await M.Job.findOne({ type: 'test.flaky' })
    assert.equal(flaky.status, 'queued')
    await M.Job.updateOne({ _id: flaky._id }, { $set: { runAt: new Date(0) } })
    await jobs.drainJobs()
    assert.equal((await M.Job.findById(flaky._id)).status, 'done')

    await jobs.enqueue('test.broken')
    await jobs.drainJobs()
    assert.equal((await M.Job.findOne({ type: 'test.broken' })).status, 'dead')

    await jobs.enqueue('test.flaky', {}, { uniqueKey: 'only-one', runAt: new Date(Date.now() + DAY) })
    assert.equal(await jobs.enqueue('test.flaky', {}, { uniqueKey: 'only-one' }), null)
  })

  test('owners must set up and use 2FA; codes can’t be replayed; backup codes work', async () => {
    owner = agent(srv.base)
    const signup = await owner.post('/auth/signup', { name: 'Asha Owner', email: 'asha@test.dev', password: 'password123', agencyName: 'Test Studio' })
    assert.equal(signup.body.mfa, 'setup')
    // No session yet.
    assert.equal((await owner.get('/auth/me')).status, 401)
    const setup = await owner.post('/auth/2fa/setup', { challenge: signup.body.challenge })
    ownerSecret = setup.body.secret
    assert.match(setup.body.otpauthUrl, /^otpauth:\/\/totp\//)
    const bad = await owner.post('/auth/2fa/verify', { challenge: signup.body.challenge, code: '000000' })
    assert.equal(bad.status, 401)
    const step = totp.currentStep()
    const ok = await owner.post('/auth/2fa/verify', { challenge: signup.body.challenge, code: totp.totpAt(ownerSecret, step) })
    assert.equal(ok.status, 200, JSON.stringify(ok.body))
    assert.equal(ok.body.backupCodes.length, 10)
    agencyId = (await owner.get('/auth/me')).body.agency.id

    // Logging in again: the same code is refused (replay), the next one works.
    const other = agent(srv.base)
    const login = await other.post('/auth/login', { email: 'asha@test.dev', password: 'password123' })
    assert.equal(login.body.mfa, 'verify')
    assert.equal((await other.post('/auth/2fa/verify', { challenge: login.body.challenge, code: totp.totpAt(ownerSecret, step) })).status, 401)
    const backup = await other.post('/auth/2fa/verify', { challenge: login.body.challenge, backupCode: ok.body.backupCodes[0] })
    assert.equal(backup.status, 200, JSON.stringify(backup.body))
    assert.equal((await other.get('/auth/me')).body.role, 'owner')
  })

  test('setup: client with an admin (no 2FA for client people)', async () => {
    clientId = (await owner.post('/clients', { name: 'Velvet Oven', brandName: 'Velvet Oven' })).body.client._id
    await owner.post(`/clients/${clientId}/invitations`, { email: 'priya@brand.dev', role: 'admin' })
    priya = agent(srv.base)
    const accepted = await priya.post(`/invitations/${await inviteToken('priya@brand.dev')}/accept`, { name: 'Priya Rao', password: 'password123' })
    assert.equal(accepted.body.mfa, undefined)
    priyaId = (await priya.get('/auth/me')).body.user.id
  })

  test('emails go out through the queue', async () => {
    assert.ok((await M.Outbox.countDocuments({ status: 'queued' })) > 0)
    await jobs.drainJobs()
    assert.equal(await M.Outbox.countDocuments({ status: 'queued' }), 0)
    assert.ok((await M.Outbox.countDocuments({ status: 'sent', provider: 'dev' })) > 0)
  })

  test('platform admins must use 2FA too', async () => {
    const { hashPassword } = await import('../src/lib/password.ts')
    await M.Admin.create({ username: 'root', name: 'Root', passwordHash: await hashPassword('admin-password-1') })
    const admin = agent(srv.base)
    const login = await admin.post('/admin/auth/login', { username: 'root', password: 'admin-password-1' })
    assert.equal(login.body.mfa, 'setup')
    assert.equal((await admin.get('/admin/auth/me')).status, 401)
    const done = await completeMfa(admin, login, '/admin/auth/2fa')
    assert.equal(done.status, 200, JSON.stringify(done.body))
    assert.equal((await admin.get('/admin/auth/me')).status, 200)
  })

  test('Brand DNA: per-section rev, client vs agency sections, history, onboarding to 100%', async () => {
    const brand = await priya.get('/client/brand')
    assert.equal(brand.body.brand.onboarding.percent, 0)
    assert.equal(brand.body.brand.meta.personalityAxes.length, 4)
    const intro = brand.body.brand.sections.intro
    const saved = await priya.put('/client/brand/sections/intro', { rev: intro.rev, data: { whatWeDo: 'Bakery', standFor: 'Real butter', audience: 'Families' } })
    assert.equal(saved.status, 200, JSON.stringify(saved.body))
    const stale = await priya.put('/client/brand/sections/intro', { rev: intro.rev, data: { whatWeDo: 'Cafe' } })
    assert.equal(stale.status, 409)
    assert.equal((await priya.put('/client/brand/sections/positioning', { rev: 1, data: { text: 'x' } })).status, 403)
    const bad = await priya.put('/client/brand/sections/personality', { rev: 1, data: { axes: { made_up_axis: 50 } } })
    assert.equal(bad.status, 400)
    await priya.put('/client/brand/sections/personality', { rev: 1, data: { axes: { playful_serious: 30, bold_subtle: 80 }, keywords: 'warm, honest' } })
    // Different sections don't conflict: the agency edits positioning at the same time.
    assert.equal((await owner.put(`/clients/${clientId}/brand/sections/positioning`, { rev: 1, data: { text: 'The neighbourhood bakery' } })).status, 200)

    const history = await owner.get(`/clients/${clientId}/brand/history?section=intro`)
    assert.equal(history.body.items[0].after.whatWeDo, 'Bakery')

    await priya.post('/client/brand/references', { sentiment: 'like', link: 'https://example.com/ref', note: 'Love this palette' })
    assert.equal((await owner.get(`/clients/${clientId}/brand/references?sentiment=like`)).body.items.length, 1)

    for (const step of ['intro', 'personality', 'likes', 'dislikes', 'references', 'assets']) await priya.post(`/client/brand/onboarding/${step}/complete`)
    const done = await priya.get('/client/brand/onboarding')
    assert.equal(done.body.onboarding.percent, 100)
    assert.equal(done.body.onboarding.mode, 'hub')
    assert.equal(await M.Notification.countDocuments({ event: 'client.onboarding_completed' }), 1)
  })

  test('meetings: transcript stays internal; sharing makes tasks and requests exactly once', async () => {
    const start = new Date(Date.now() + 10 * 60_000)
    const m = await owner.post('/meetings', { client: clientId, title: 'Kickoff', startAt: start.toISOString(), endAt: new Date(start.getTime() + 3600_000).toISOString(), participants: { client: [priyaId] } })
    assert.equal(m.status, 201, JSON.stringify(m.body))
    const id = m.body.meeting._id
    await owner.put(`/meetings/${id}/transcript`, { transcript: 'Internal: client seemed unsure about budget' })
    await owner.put(`/meetings/${id}/summary`, { text: 'Agreed on the Diwali plan', decisions: ['Two reels a week'], actionItems: [{ text: 'Draft reel scripts', side: 'agency' }, { text: 'Send product photos', side: 'client', due: '2030-01-01' }] })

    let client = await priya.get(`/client/meetings/${id}`)
    assert.equal(client.body.meeting.transcript, undefined)
    assert.equal(client.body.meeting.summary, null)

    const shared = await owner.post(`/meetings/${id}/share`)
    assert.equal(shared.status, 200, JSON.stringify(shared.body))
    assert.equal((await owner.post(`/meetings/${id}/share`)).status, 409)
    assert.equal(await M.Task.countDocuments({ meeting: id }), 1)
    assert.equal(await M.Request.countDocuments({ source: 'meeting', client: clientId }), 1)
    client = await priya.get(`/client/meetings/${id}`)
    assert.deepEqual(client.body.meeting.summary.decisions, ['Two reels a week'])

    // Starts in 10 minutes: the reminder goes out once.
    const { remindMeetings } = await import('../src/modules/meetings/meetings.routes.ts')
    await remindMeetings()
    await remindMeetings()
    assert.equal(await M.Notification.countDocuments({ event: 'meeting.soon' }), 2)
    assert.equal((await priya.get('/client/home')).body.nextMeeting.title, 'Kickoff')
  })

  test('library collections and conversations keep internal things internal', async () => {
    const internal = await owner.post(`/clients/${clientId}/collections`, { name: 'Drafts', visibility: 'internal' })
    const shared = await owner.post(`/clients/${clientId}/collections`, { name: 'Logos' })
    assert.equal(internal.status, 201)
    const file = await M.File.create({ agency: agencyId, client: clientId, purpose: 'library', name: 'logo.png', mimeType: 'image/png', size: 5, key: `t/${new Types.ObjectId()}`, status: 'ready', visibility: 'client', uploadedBy: { id: priyaId, name: 'Priya', side: 'client' } })
    assert.equal((await priya.patch(`/client/library/files/${file._id}`, { collection: internal.body.collection._id })).status, 404)
    assert.equal((await priya.patch(`/client/library/files/${file._id}`, { collection: shared.body.collection._id, category: 'brand' })).status, 200)
    const lib = await priya.get('/client/library')
    assert.deepEqual(lib.body.collections.map((c: any) => c.name), ['Logos'])
    assert.equal(lib.body.collections[0].fileCount, 1)

    const convs = await owner.get(`/clients/${clientId}/conversations`)
    const general = convs.body.items.find((c: any) => c.context.type === 'client_general' && c.visibility === 'client')
    const internalGeneral = convs.body.items.find((c: any) => c.context.type === 'client_general' && c.visibility === 'internal')
    await owner.post(`/clients/${clientId}/conversations/${internalGeneral.id}/messages`, { body: 'Internal: watch the budget' })
    await priya.post(`/client/conversations/${general.id}/messages`, { body: 'Hi team!' })
    const clientView = await priya.get('/client/conversations')
    assert.ok(clientView.body.items.every((c: any) => c.visibility === 'client'))
    assert.equal((await priya.get(`/client/conversations/${internalGeneral.id}/messages`)).status, 404)
    assert.equal((await owner.get(`/clients/${clientId}/conversations/${general.id}/messages`)).body.items[0].body, 'Hi team!')
  })

  test('publishing through a connected account: success, analytics, unknown outcome, retry', async () => {
    let mode: 'ok' | 'unknown' | 'retry' = 'ok'
    const posted: string[] = []
    platforms.PROVIDERS.instagram = {
      ...platforms.PROVIDERS.instagram,
      configured: () => true,
      async publish(_account, post) {
        if (mode === 'unknown') throw new platforms.PublishError('unknown', 'No answer after sending')
        if (mode === 'retry') throw new platforms.PublishError('retryable', 'Upload failed')
        posted.push(post.caption)
        return { externalId: `ig_${posted.length}`, url: `https://instagram.com/p/${posted.length}` }
      },
      async metrics() {
        return { reach: 200, likes: 30, comments: 5, shares: 3, saves: 2 }
      },
      async check() {},
    }
    const { sealTokens } = await import('../src/modules/publishing/connections.service.ts')
    const conn = await M.Connection.create({ agency: agencyId, client: clientId, platform: 'instagram', externalId: 'ig-1', name: 'velvetoven', tokens: sealTokens({ accessToken: 'fake', expiresAt: null }) })

    async function approvedContent(title: string) {
      const c = await owner.post('/content', { client: clientId, title, platform: 'instagram', format: 'square_1x1' })
      const id = c.body.content._id
      const f = await M.File.create({ agency: agencyId, client: clientId, purpose: 'version', name: 'a.jpg', mimeType: 'image/jpeg', size: 1, key: `t/${new Types.ObjectId()}`, status: 'ready' })
      await owner.post(`/content/${id}/versions`, { files: [String(f._id)], caption: `Caption ${title}` })
      await owner.post(`/content/${id}/submit`)
      const sent = await owner.post(`/content/${id}/internal-review`, { decision: 'approve_and_send' })
      const approved = await priya.post(`/client/content/${id}/approve`, { versionId: sent.body.content.currentVersion, expectedState: 'client_review' })
      assert.equal(approved.status, 200, JSON.stringify(approved.body))
      return id
    }
    async function scheduleAndRun(id: string) {
      const s = await owner.post(`/content/${id}/schedule`, { publishDate: new Date(Date.now() + DAY).toISOString(), account: String(conn._id) })
      assert.equal(s.status, 200, JSON.stringify(s.body))
      // Time travel: the publish time has come.
      await M.Content.updateOne({ _id: id }, { $set: { publishDate: new Date(Date.now() - 1000) } })
      await M.Job.updateMany({ type: 'publish.run' }, { $set: { runAt: new Date(0) } })
      await jobs.drainJobs()
    }

    const id1 = await approvedContent('Launch')
    await scheduleAndRun(id1)
    let c1 = await M.Content.findById(id1).lean()
    assert.equal(c1.state, 'published', JSON.stringify(await M.PublishJob.findOne({ content: id1 }).lean()))
    assert.equal(c1.externalPostId, 'ig_1')
    const { collectAnalytics } = await import('../src/modules/analytics/analytics.service.ts')
    await collectAnalytics()
    const snap = await M.Snapshot.findOne({ content: id1 }).lean()
    assert.equal(snap.metrics.engagements, 40)
    assert.equal(snap.metrics.engagementRate, 20)

    mode = 'unknown'
    const id2 = await approvedContent('Unknown')
    await scheduleAndRun(id2)
    c1 = await M.Content.findById(id2).lean()
    assert.equal(c1.state, 'scheduled')
    assert.equal((await M.PublishJob.findOne({ content: id2 }).sort({ createdAt: -1 }).lean()).status, 'unknown')
    // Never retried automatically.
    assert.equal(await M.Job.countDocuments({ type: 'publish.run', status: 'queued' }), 0)

    // Nothing was sent (upload failed): back to scheduled and queued again.
    mode = 'retry'
    const id3 = await approvedContent('Retry')
    await scheduleAndRun(id3)
    assert.equal((await M.Content.findById(id3).lean()).state, 'scheduled')
    assert.equal((await M.PublishJob.findOne({ content: id3 }).sort({ createdAt: -1 }).lean()).status, 'queued')
    assert.equal(await M.Job.countDocuments({ type: 'publish.run', status: 'queued' }), 1)
    assert.deepEqual(posted, ['Caption Launch'])
  })

  test('reports: a frozen snapshot, drafted then shared', async () => {
    const from = new Date(Date.now() - 7 * DAY).toISOString().slice(0, 10)
    const to = new Date(Date.now() + DAY).toISOString().slice(0, 10)
    const r = await owner.post('/reports', { client: clientId, from, to })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    assert.ok(r.body.report.snapshot.totals)
    assert.equal((await priya.get('/client/analytics/reports')).body.items.length, 0)
    await owner.post(`/reports/${r.body.report._id}/share`)
    assert.equal((await owner.patch(`/reports/${r.body.report._id}`, { notes: 'late edit' })).status, 409)
    assert.equal((await priya.get('/client/analytics/reports')).body.items.length, 1)
    // Live analytics stay off until the agency switches them on (D47).
    assert.equal((await priya.get(`/client/analytics?from=${from}&to=${to}`)).status, 403)
  })

  test('account, permissions, billing placeholder, client settings and support', async () => {
    assert.equal((await priya.patch('/me/profile', { name: 'Priya R', timezone: 'Asia/Kolkata' })).body.profile.name, 'Priya R')
    const second = agent(srv.base)
    await second.post('/auth/login', { email: 'priya@brand.dev', password: 'password123' })
    assert.equal((await priya.post('/me/password', { currentPassword: 'password123', newPassword: 'new-password-1' })).status, 204)
    assert.equal((await second.get('/auth/me')).status, 401)

    const perms = await owner.get('/agency/permissions')
    assert.ok(perms.body.agency.capabilities.some((c: any) => c.key === 'publish'))
    const billing = await owner.get('/agency/billing')
    assert.equal(billing.body.available, false)

    assert.equal((await priya.patch('/client/settings', { contact: { phone: '+91 99999 00000' } })).body.settings.contact.phone, '+91 99999 00000')

    const ticket = await priya.post('/support/tickets', { subject: 'Upload stuck', message: 'The progress bar stops at 90%' })
    assert.equal(ticket.status, 201, JSON.stringify(ticket.body))
    assert.equal((await owner.get(`/support/tickets/${ticket.body.ticket._id}`)).status, 404)
  })
})
