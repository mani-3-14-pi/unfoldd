// End-to-end tests for Phase 2: the AI revision checklist (with a fake provider, so no API key or cost),
// feedback → task, the task board, dependencies and auto-unblocking.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { Types } from 'mongoose'
import type { ChecklistProvider } from '../src/lib/ai.ts'
import { agent, signupOwner, startServer } from './helpers.ts'

let srv: Awaited<ReturnType<typeof startServer>>
let ai: typeof import('../src/lib/ai.ts')
let runs: typeof import('../src/modules/checklist/checklist.service.ts')
let models: {
  Settings: typeof import('../src/modules/settings/settings.model.ts').SettingsModel
  Outbox: typeof import('../src/modules/notifications/outbox.model.ts').OutboxModel
  File: typeof import('../src/modules/files/file.model.ts').FileModel
  Run: typeof import('../src/modules/checklist/checklist.model.ts').ChecklistRunModel
  Thread: typeof import('../src/modules/feedback/thread.model.ts').ThreadModel
  Notification: typeof import('../src/modules/notifications/notification.model.ts').NotificationModel
}

/** One suggestion per feedback item, echoing its text; records what it was sent. */
const seen: string[] = []
const fakeAi: ChecklistProvider = {
  name: 'fake',
  async suggest(req) {
    seen.push(...req.feedback.map((f) => f.text))
    return { model: 'fake-1', items: req.feedback.map((f) => ({ text: `Do: ${f.text}`, sourcePins: [f.pin] })) }
  },
}

before(async () => {
  srv = await startServer()
  ai = await import('../src/lib/ai.ts')
  runs = await import('../src/modules/checklist/checklist.service.ts')
  models = {
    Settings: (await import('../src/modules/settings/settings.model.ts')).SettingsModel,
    Outbox: (await import('../src/modules/notifications/outbox.model.ts')).OutboxModel,
    File: (await import('../src/modules/files/file.model.ts')).FileModel,
    Run: (await import('../src/modules/checklist/checklist.model.ts')).ChecklistRunModel,
    Thread: (await import('../src/modules/feedback/thread.model.ts')).ThreadModel,
    Notification: (await import('../src/modules/notifications/notification.model.ts')).NotificationModel,
  }
  await models.Settings.create({ key: 'platform', signups: { enabled: true, autoApprove: true } })
  ai.setChecklistProvider(fakeAi)
})

after(async () => {
  await srv.stop()
})

async function readyFile(agency: string, client: string) {
  const doc = await models.File.create({ agency, client, purpose: 'version', name: 'a.jpg', mimeType: 'image/jpeg', size: 1, key: `t/${new Types.ObjectId()}`, status: 'ready' })
  return String(doc._id)
}

describe('Phase 2: revision engine', () => {
  let owner: ReturnType<typeof agent>
  let priya: ReturnType<typeof agent>
  let agencyId = ''
  let clientId = ''
  let contentId = ''
  let versionId = ''

  /** A fresh piece of content sent to the client for review. */
  async function sentContent(title: string) {
    const c = await owner.post('/content', { client: clientId, title, platform: 'instagram', format: 'square_1x1' })
    const id = c.body.content._id
    await owner.post(`/content/${id}/versions`, { files: [await readyFile(agencyId, clientId)] })
    await owner.post(`/content/${id}/submit`)
    const sent = await owner.post(`/content/${id}/internal-review`, { decision: 'approve_and_send' })
    assert.equal(sent.body.content.state, 'client_review')
    return { id, versionId: String(sent.body.content.currentVersion) }
  }

  async function requestChanges(id: string, vid: string, comments: string[]) {
    for (const body of comments) {
      const r = await priya.post(`/client/content/${id}/threads`, { versionId: vid, body })
      assert.equal(r.status, 201, JSON.stringify(r.body))
    }
    const r = await priya.post(`/client/content/${id}/request-changes`, { versionId: vid, expectedState: 'client_review' })
    assert.equal(r.status, 200, JSON.stringify(r.body))
  }

  test('setup: agency, client admin, content in review', async () => {
    owner = agent(srv.base)
    await signupOwner(owner, { name: 'Asha Owner', email: 'asha@test.dev', password: 'password123', agencyName: 'Test Studio' })
    agencyId = (await owner.get('/auth/me')).body.agency.id
    clientId = (await owner.post('/clients', { name: 'Velvet Oven', brandName: 'Velvet Oven' })).body.client._id
    await owner.post(`/clients/${clientId}/invitations`, { email: 'priya@brand.dev', role: 'admin' })
    const mail = await models.Outbox.findOne({ to: 'priya@brand.dev' }).lean()
    priya = agent(srv.base)
    await priya.post(`/invitations/${mail!.text.match(/\/invite\/([\w-]+)/)![1]}/accept`, { name: 'Priya', password: 'password123' })
    ;({ id: contentId, versionId } = await sentContent('Diwali post'))
  })

  test('request changes queues an AI run; suggestions are agency-only', async () => {
    await requestChanges(contentId, versionId, ['Make the logo bigger', 'Use warmer colours'])
    assert.equal(await models.Run.countDocuments({ content: contentId, status: 'queued' }), 1)

    await runs.processChecklistRuns()
    const run = await models.Run.findOne({ content: contentId }).lean()
    assert.equal(run!.status, 'done', run!.error)
    assert.equal(run!.suggestions, 2)
    assert.deepEqual(seen.sort(), ['Make the logo bigger', 'Use warmer colours'])

    const agencyView = await owner.get(`/content/${contentId}/checklist`)
    assert.equal(agencyView.body.items.length, 2)
    assert.ok(agencyView.body.items.every((i: any) => i.status === 'suggested'))
    assert.equal(await models.Notification.countDocuments({ event: 'checklist.suggested' }), 1)

    // Raw suggestions never reach the client (D21).
    assert.equal((await priya.get(`/client/content/${contentId}/checklist`)).body.items.length, 0)
  })

  test('accept with an edit, remove the other; the client sees only the accepted one', async () => {
    const items = (await owner.get(`/content/${contentId}/checklist`)).body.items
    const accepted = await owner.patch(`/content/${contentId}/checklist/items/${items[0]._id}`, { status: 'accepted', text: 'Logo 20% bigger' })
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body))
    await owner.patch(`/content/${contentId}/checklist/items/${items[1]._id}`, { status: 'removed' })

    const client = await priya.get(`/client/content/${contentId}/checklist`)
    assert.equal(client.body.items.length, 1)
    assert.equal(client.body.items[0].text, 'Logo 20% bigger')
    assert.equal(client.body.items[0].done, false)
    assert.deepEqual(client.body.items[0].pins, [1])
  })

  test('an accepted item becomes at most one task', async () => {
    const [item] = (await owner.get(`/content/${contentId}/checklist`)).body.items.filter((i: any) => i.status === 'accepted')
    const first = await owner.post(`/content/${contentId}/checklist/items/${item._id}/task`)
    assert.equal(first.status, 201, JSON.stringify(first.body))
    const again = await owner.post(`/content/${contentId}/checklist/items/${item._id}/task`)
    assert.equal(again.status, 200)
    assert.equal(again.body.task._id, first.body.task._id)
  })

  test('feedback → task is idempotent too', async () => {
    const threads = (await owner.get(`/content/${contentId}/threads?visibility=client`)).body.items
    const second = threads.find((t: any) => t.pin === 2)
    const a = await owner.post(`/content/${contentId}/threads/${second._id}/task`)
    const b = await owner.post(`/content/${contentId}/threads/${second._id}/task`)
    assert.equal(a.status, 201, JSON.stringify(a.body))
    assert.equal(b.body.task._id, a.body.task._id)
    assert.equal(a.body.task.title, 'Use warmer colours')
  })

  test('dependencies block, refuse cycles, and unblock with a notification when done', async () => {
    const tasks = (await owner.get(`/tasks?content=${contentId}`)).body.items
    const fromChecklist = tasks.find((t: any) => t.source === 'checklist')
    const later = await owner.post('/tasks', { client: clientId, content: contentId, title: 'Export final files' })
    assert.equal(later.status, 201, JSON.stringify(later.body))

    const set = await owner.put(`/tasks/${later.body.task._id}/dependencies`, { dependencies: [{ type: 'task', id: fromChecklist._id }] })
    assert.equal(set.status, 200, JSON.stringify(set.body))
    assert.equal(set.body.task.blocked.isBlocked, true)

    const cycle = await owner.put(`/tasks/${fromChecklist._id}/dependencies`, { dependencies: [{ type: 'task', id: later.body.task._id }] })
    assert.equal(cycle.status, 400)

    // Starting the work shows the client "In progress" on the feedback (Flow 7, step 5).
    await owner.post(`/tasks/${fromChecklist._id}/move`, { status: 'in_progress', expectedStatus: 'todo' })
    const thread = await models.Thread.findOne({ content: contentId, pin: 1 }).lean()
    assert.equal(thread!.status, 'in_progress')

    // A stale drag is a 409.
    const stale = await owner.post(`/tasks/${fromChecklist._id}/move`, { status: 'in_review', expectedStatus: 'todo' })
    assert.equal(stale.status, 409)

    const done = await owner.post(`/tasks/${fromChecklist._id}/move`, { status: 'done', expectedStatus: 'in_progress' })
    assert.equal(done.status, 200, JSON.stringify(done.body))
    const freed = await owner.get(`/tasks/${later.body.task._id}`)
    assert.equal(freed.body.task.blocked.isBlocked, false)
    assert.equal(await models.Notification.countDocuments({ event: 'task.unblocked' }), 1)

    // Its checklist item now reads as done for the client.
    const client = await priya.get(`/client/content/${contentId}/checklist`)
    assert.equal(client.body.items[0].done, true)

    const board = await owner.get(`/tasks?view=board&client=${clientId}`)
    assert.deepEqual(board.body.columns.map((c: any) => c.status), ['todo', 'in_progress', 'in_review', 'done'])
  })

  test('a transient AI failure is retried; a permanent one is recorded', async () => {
    const { AiPermanentError } = ai
    let calls = 0
    ai.setChecklistProvider({
      name: 'flaky',
      async suggest() {
        calls++
        throw calls === 1 ? new Error('overloaded') : new AiPermanentError('bad key')
      },
    })
    const c = await sentContent('Reel')
    await requestChanges(c.id, c.versionId, ['Shorter intro'])
    await runs.processChecklistRuns()
    let run = await models.Run.findOne({ content: c.id }).lean()
    assert.equal(run!.status, 'queued')
    assert.equal(run!.attempts, 1)

    await models.Run.updateOne({ _id: run!._id }, { $set: { runAfter: new Date(0) } })
    await runs.processChecklistRuns()
    run = await models.Run.findOne({ content: c.id }).lean()
    assert.equal(run!.status, 'failed')
    assert.equal(run!.error, 'bad key')
    // The raw feedback is untouched and still usable.
    assert.equal((await owner.get(`/feedback?client=${clientId}`)).body.total >= 1, true)
  })

  test('with AI switched off, runs are recorded as skipped and nothing breaks', async () => {
    ai.setChecklistProvider(null)
    const c = await sentContent('Story')
    await requestChanges(c.id, c.versionId, ['Swap the photo'])
    const run = await models.Run.findOne({ content: c.id }).lean()
    assert.equal(run!.status, 'skipped')
    const view = await owner.get(`/content/${c.id}/checklist`)
    assert.equal(view.body.ai.enabled, false)
    assert.equal((await owner.post(`/content/${c.id}/checklist/run`)).status, 409)
  })
})
