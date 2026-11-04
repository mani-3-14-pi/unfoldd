// End-to-end tests for Phase 0 (tenancy, invites, access) and Phase 1 (the content review loop).
// Run with `npm test`. Uses an in-memory MongoDB, never a real database.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { Types } from 'mongoose'
import { agent, signupOwner, startServer } from './helpers.ts'

let srv: Awaited<ReturnType<typeof startServer>>
let models: {
  Settings: typeof import('../src/modules/settings/settings.model.ts').SettingsModel
  Outbox: typeof import('../src/modules/notifications/outbox.model.ts').OutboxModel
  File: typeof import('../src/modules/files/file.model.ts').FileModel
  Agency: typeof import('../src/modules/agencies/agency.model.ts').AgencyModel
  Thread: typeof import('../src/modules/feedback/thread.model.ts').ThreadModel
  Job: typeof import('../src/modules/content/publishJob.model.ts').PublishJobModel
  Notification: typeof import('../src/modules/notifications/notification.model.ts').NotificationModel
}

before(async () => {
  srv = await startServer()
  models = {
    Settings: (await import('../src/modules/settings/settings.model.ts')).SettingsModel,
    Outbox: (await import('../src/modules/notifications/outbox.model.ts')).OutboxModel,
    File: (await import('../src/modules/files/file.model.ts')).FileModel,
    Agency: (await import('../src/modules/agencies/agency.model.ts')).AgencyModel,
    Thread: (await import('../src/modules/feedback/thread.model.ts')).ThreadModel,
    Job: (await import('../src/modules/content/publishJob.model.ts')).PublishJobModel,
    Notification: (await import('../src/modules/notifications/notification.model.ts')).NotificationModel,
  }
  await models.Settings.create({ key: 'platform', signups: { enabled: true, autoApprove: true } })
})

after(async () => {
  await srv.stop()
})

/** The token from the last invitation email sent to this address (the dev mailer keeps every email). */
async function inviteToken(email: string) {
  const mail = await models.Outbox.findOne({ to: email, kind: 'invitation' }).sort({ createdAt: -1 }).lean()
  return mail!.text.match(/\/invite\/([\w-]+)/)![1]
}

/** Version files normally arrive through a presigned R2 upload; here they're created as already processed. */
async function readyFiles(agency: string, client: string, n = 1) {
  const docs = await models.File.insertMany(
    Array.from({ length: n }, (_, i) => ({
      agency,
      client,
      purpose: 'version',
      name: `slide-${i + 1}.jpg`,
      mimeType: 'image/jpeg',
      size: 1000,
      key: `test/${new Types.ObjectId()}`,
      status: 'ready',
    })),
  )
  return docs.map((d) => String(d._id))
}

describe('Phase 0 + Phase 1: the core loop', () => {
  const owner = agent('')
  const priya = agent('')
  let agencyId = ''
  let clientId = ''
  let contentId = ''

  test('owner signs up and creates a client', async () => {
    Object.assign(owner, agent(srv.base))
    const signup = await signupOwner(owner, { name: 'Asha Owner', email: 'asha@test.dev', password: 'password123', agencyName: 'Test Studio' })
    assert.equal(signup.status, 201, JSON.stringify(signup.body))
    const me = await owner.get('/auth/me')
    assert.equal(me.body.context, 'agency')
    assert.equal(me.body.role, 'owner')
    agencyId = me.body.agency.id

    const client = await owner.post('/clients', { name: 'Velvet Oven Pvt Ltd', brandName: 'Velvet Oven' })
    assert.equal(client.status, 201, JSON.stringify(client.body))
    clientId = client.body.client._id
    assert.equal(client.body.client.contract.revisionsIncluded, 2)
    assert.equal(client.body.client.status, 'onboarding')
  })

  test('the first client invite must be an admin', async () => {
    const res = await owner.post(`/clients/${clientId}/invitations`, { email: 'priya@brand.dev', role: 'viewer' })
    assert.equal(res.status, 400)
  })

  test('client admin is invited and accepts with a new account', async () => {
    const inv = await owner.post(`/clients/${clientId}/invitations`, { email: 'priya@brand.dev', role: 'admin' })
    assert.equal(inv.status, 201, JSON.stringify(inv.body))
    const token = await inviteToken('priya@brand.dev')

    Object.assign(priya, agent(srv.base))
    const preview = await priya.get(`/invitations/${token}`)
    assert.equal(preview.body.status, 'pending')
    assert.equal(preview.body.client.brandName, 'Velvet Oven')
    assert.equal(preview.body.accountExists, false)

    const accept = await priya.post(`/invitations/${token}/accept`, { name: 'Priya Client', password: 'password123' })
    assert.equal(accept.status, 200, JSON.stringify(accept.body))
    const me = await priya.get('/auth/me')
    assert.equal(me.body.context, 'client')
    assert.equal(me.body.role, 'admin')

    const again = await agent(srv.base).post(`/invitations/${token}/accept`, { password: 'password123' })
    assert.equal(again.status, 409)
  })

  test('accepting for an existing account needs its password', async () => {
    const inv = await owner.post('/agency/invitations', { email: 'priya@brand.dev', role: 'member' })
    assert.equal(inv.status, 201, JSON.stringify(inv.body))
    const token = await inviteToken('priya@brand.dev')
    const wrong = await agent(srv.base).post(`/invitations/${token}/accept`, { password: 'not-her-password' })
    assert.equal(wrong.status, 401)
    await owner.post(`/agency/invitations/${inv.body.invitation.id}/revoke`)
  })

  test('client people are kept out of agency routes and other tenants', async () => {
    assert.equal((await priya.get('/clients')).status, 403)
    const other = agent(srv.base)
    await signupOwner(other, { name: 'Other Owner', email: 'other@test.dev', password: 'password123', agencyName: 'Other Studio' })
    assert.equal((await other.get(`/clients/${clientId}`)).status, 404)
  })

  test('agency creates content, uploads V01 and submits it for internal review', async () => {
    const created = await owner.post('/content', { client: clientId, title: 'Diwali carousel', platform: 'instagram', format: 'carousel' })
    assert.equal(created.status, 201, JSON.stringify(created.body))
    contentId = created.body.content._id
    assert.equal(created.body.content.state, 'in_production')

    const files = await readyFiles(agencyId, clientId, 3)
    const v1 = await owner.post(`/content/${contentId}/versions`, { files, caption: 'Light up 🪔', hashtags: ['#diwali'] })
    assert.equal(v1.status, 201, JSON.stringify(v1.body))
    assert.equal(v1.body.number, 1)

    // Not visible to the client before it's sent (D64).
    assert.equal((await priya.get(`/client/content/${contentId}`)).status, 404)

    const submitted = await owner.post(`/content/${contentId}/submit`)
    assert.equal(submitted.body.content.state, 'internal_review')

    // Internal feedback is never visible to the client (D20).
    const internal = await owner.post(`/content/${contentId}/threads`, { visibility: 'internal', body: 'Logo a bit small' })
    assert.equal(internal.status, 201, JSON.stringify(internal.body))
    assert.equal(internal.body.thread.pin, 1)
  })

  test('a submitted version is locked', async () => {
    const detail = await owner.get(`/content/${contentId}`)
    const res = await owner.patch(`/content/${contentId}/versions/${detail.body.content.currentVersion}`, { caption: 'changed' })
    assert.equal(res.status, 409)
  })

  test('internal approve & send puts it in front of the client', async () => {
    const res = await owner.post(`/content/${contentId}/internal-review`, { decision: 'approve_and_send' })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(res.body.content.state, 'client_review')

    const hub = await priya.get('/client/content?status=review_required')
    assert.equal(hub.body.total, 1)
    assert.equal(hub.body.items[0].status.label, 'Review Required')
    assert.equal(await models.Notification.countDocuments({ event: 'content.review_required' }), 1)
  })

  test('client reviews: drafts are private until submitted, internal notes never show', async () => {
    const detail = await priya.get(`/client/content/${contentId}`)
    const version = detail.body.content.version
    assert.equal(detail.body.content.can.decide, true)
    // Opening the version as an approver marks it viewed (D04).
    await priya.get(`/client/content/${contentId}/versions/${version._id}`)
    assert.equal((await owner.get(`/content/${contentId}`)).body.content.derived.approvalStatus, 'viewed')

    const draft = await priya.post(`/client/content/${contentId}/threads`, {
      versionId: version._id,
      body: 'Make the diya brighter',
      anchor: { versionFile: version.files[1].id, shapes: [{ type: 'circle', points: [{ x: 0.4, y: 0.4 }, { x: 0.6, y: 0.6 }] }] },
    })
    assert.equal(draft.status, 201, JSON.stringify(draft.body))
    assert.equal(draft.body.thread.submittedAt, null)
    assert.equal(draft.body.thread.pin, null)

    // The agency can't see the draft yet.
    const agencySees = await owner.get(`/content/${contentId}/threads?visibility=client`)
    assert.equal(agencySees.body.items.length, 0)
    const clientSees = await priya.get(`/client/content/${contentId}/threads`)
    assert.equal(clientSees.body.items.length, 1)
    assert.ok(clientSees.body.items.every((t: any) => t.visibility === 'client'))
  })

  test('request changes needs feedback, submits the drafts and counts a revision', async () => {
    const detail = await priya.get(`/client/content/${contentId}`)
    const res = await priya.post(`/client/content/${contentId}/request-changes`, { versionId: detail.body.content.version._id, expectedState: 'client_review' })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(res.body.content.status.bucket, 'changes_requested')
    assert.equal(res.body.content.revisions.used, 1)

    const threads = (await owner.get(`/content/${contentId}/threads?visibility=client`)).body.items
    assert.equal(threads.length, 1)
    assert.equal(threads[0].pin, 1)
    assert.equal(threads[0].status, 'open')

    const inbox = await owner.get('/feedback')
    assert.equal(inbox.body.total, 1)
  })

  test('a second decision on a stale screen is a 409, not a silent overwrite (D07)', async () => {
    const detail = await priya.get(`/client/content/${contentId}`)
    const res = await priya.post(`/client/content/${contentId}/request-changes`, { versionId: detail.body.content.version._id, expectedState: 'client_review' })
    assert.equal(res.status, 409)
    assert.equal(res.body.error.code, 'decided_meanwhile')
  })

  test('V02 resolves the feedback and goes back through review', async () => {
    const thread = (await owner.get(`/content/${contentId}/threads?visibility=client`)).body.items[0]
    const files = await readyFiles(agencyId, clientId, 3)
    const v2 = await owner.post(`/content/${contentId}/versions`, { files, caption: 'Light up 🪔✨', resolves: [thread._id], resolutionNote: 'Brightened' })
    assert.equal(v2.status, 201, JSON.stringify(v2.body))
    assert.equal(v2.body.number, 2)
    assert.equal(v2.body.content.state, 'in_production')

    const resolved = await models.Thread.findById(thread._id).lean()
    assert.equal(resolved!.status, 'resolved')
    assert.equal(resolved!.resolvedInVersion!.number, 2)

    await owner.post(`/content/${contentId}/submit`)
    const approve = await owner.post(`/content/${contentId}/internal-review`, { decision: 'approve' })
    assert.equal(approve.body.content.state, 'ready_for_client')
    const sent = await owner.post(`/content/${contentId}/send`)
    assert.equal(sent.body.content.state, 'client_review')
  })

  test('approving with unsent drafts asks first, then closes open feedback (D16)', async () => {
    const detail = await priya.get(`/client/content/${contentId}`)
    const versionId = detail.body.content.version._id
    assert.equal(detail.body.content.version.number, 2)
    await priya.post(`/client/content/${contentId}/threads`, { versionId, body: 'Fix the typo before posting' })

    const asked = await priya.post(`/client/content/${contentId}/approve`, { versionId, expectedState: 'client_review' })
    assert.equal(asked.status, 409)
    assert.equal(asked.body.error.code, 'has_drafts')

    const ok = await priya.post(`/client/content/${contentId}/approve`, { versionId, expectedState: 'client_review', drafts: 'post_as_messages' })
    assert.equal(ok.status, 200, JSON.stringify(ok.body))
    assert.equal(ok.body.content.status.label, 'Approved')
    assert.equal(ok.body.content.approved.by, 'Priya Client')
    assert.equal(await models.Thread.countDocuments({ content: contentId, visibility: 'client', submittedAt: null, deletedAt: null }), 0)
  })

  test('scheduling, pulling approval, and manual publish', async () => {
    const when = new Date(Date.now() + 3 * 86_400_000).toISOString()
    const scheduled = await owner.post(`/content/${contentId}/schedule`, { publishDate: when })
    assert.equal(scheduled.status, 200, JSON.stringify(scheduled.body))
    assert.equal(scheduled.body.content.state, 'scheduled')
    assert.equal(await models.Job.countDocuments({ content: contentId, status: 'queued' }), 1)

    // The approver pulls the approval (D08): the job is cancelled.
    const detail = await priya.get(`/client/content/${contentId}`)
    const pulled = await priya.post(`/client/content/${contentId}/request-changes`, { versionId: detail.body.content.version._id, expectedState: 'scheduled' })
    assert.equal(pulled.status, 200, JSON.stringify(pulled.body))
    assert.equal(pulled.body.content.status.bucket, 'changes_requested')
    assert.equal(await models.Job.countDocuments({ content: contentId, status: 'queued' }), 0)

    // Another approval of the same version, then a manual publish straight from approved (D26).
    const reapprove = await priya.post(`/client/content/${contentId}/approve`, { versionId: detail.body.content.version._id, expectedState: 'changes_requested' })
    assert.equal(reapprove.status, 200, JSON.stringify(reapprove.body))
    const published = await owner.post(`/content/${contentId}/mark-published`, { url: 'https://instagram.com/p/abc' })
    assert.equal(published.status, 200, JSON.stringify(published.body))
    assert.equal(published.body.content.state, 'published')

    const late = await owner.post(`/content/${contentId}/versions`, { files: await readyFiles(agencyId, clientId) })
    assert.equal(late.status, 409)
  })

  test('parallel uploads never share a version number (D60)', async () => {
    const created = await owner.post('/content', { client: clientId, title: 'Reel', platform: 'instagram', format: 'reel' })
    const id = created.body.content._id
    const results = await Promise.all(
      [1, 2, 3].map(async () => owner.post(`/content/${id}/versions`, { files: await readyFiles(agencyId, clientId) })),
    )
    const numbers = results.filter((r) => r.status === 201).map((r) => r.body.number)
    assert.equal(new Set(numbers).size, numbers.length)
    assert.ok(numbers.length >= 1)
  })

  test('removing a team member ends their session at once (rule §12.11)', async () => {
    await owner.post('/agency/invitations', { email: 'dev@test.dev', role: 'member' })
    const dev = agent(srv.base)
    const accepted = await dev.post(`/invitations/${await inviteToken('dev@test.dev')}/accept`, { name: 'Dev Member', password: 'password123' })
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body))
    // A Member sees no clients until assigned.
    assert.equal((await dev.get('/clients')).body.total, 0)

    const me = await dev.get('/auth/me')
    const removed = await owner.del(`/agency/members/${me.body.user.id}`)
    assert.equal(removed.status, 200, JSON.stringify(removed.body))
    assert.equal((await dev.get('/auth/me')).status, 401)
  })

  test('a client always keeps one admin', async () => {
    const members = await owner.get(`/clients/${clientId}/members`)
    const admin = members.body.items.find((m: any) => m.role === 'admin')
    const res = await owner.patch(`/clients/${clientId}/members/${admin.user._id}`, { role: 'viewer' })
    assert.equal(res.status, 409)
    assert.equal(res.body.error.code, 'last_admin')
  })
})
