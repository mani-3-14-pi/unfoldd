import { JobModel } from '../modules/jobs/job.model.ts'

/*
 * Job queue API. Modules register handlers by type at startup; anything can `enqueue` work.
 *
 *   registerJob('email.send', async (payload) => { ... })
 *   await enqueue('email.send', { outboxId }, { maxAttempts: 8 })
 *   every('content.tick', 60_000)               // recurring
 *
 * A handler that throws is retried with exponential backoff until `maxAttempts`, then marked dead.
 * Throw `PermanentJobError` to stop retrying at once.
 */

export class PermanentJobError extends Error {}

type Handler = (payload: any, job: { id: string; attempts: number }) => Promise<void>

const handlers = new Map<string, Handler>()
const recurring = new Map<string, number>()
const LEASE_MS = 5 * 60_000

export function registerJob(type: string, handler: Handler) {
  handlers.set(type, handler)
}

export async function enqueue(type: string, payload: Record<string, unknown> = {}, opts: { runAt?: Date; uniqueKey?: string; maxAttempts?: number } = {}) {
  try {
    return await JobModel.create({ type, payload, runAt: opts.runAt ?? new Date(), uniqueKey: opts.uniqueKey ?? null, maxAttempts: opts.maxAttempts ?? 5 })
  } catch (err: any) {
    // The same unique job is already waiting: that's the point of the key.
    if (err?.code === 11000) return null
    throw err
  }
}

/** Cancels waiting jobs with this key (e.g. a publish that was unscheduled). */
export const cancelJob = (uniqueKey: string) =>
  JobModel.updateMany({ uniqueKey, status: 'queued' }, { $set: { status: 'dead', lastError: 'cancelled', finishedAt: new Date(), uniqueKey: null } })

/** Lets a running job hand its key to a follow-up job it queues (e.g. a publish retry). */
export const releaseKey = (uniqueKey: string) => JobModel.updateMany({ uniqueKey, status: 'running' }, { $set: { uniqueKey: null } })

/** Runs `type` every `intervalMs`. Each run schedules the next, so only one is ever waiting. */
export function every(type: string, intervalMs: number) {
  recurring.set(type, intervalMs)
}

async function runOne(): Promise<boolean> {
  const now = new Date()
  const job = await JobModel.findOneAndUpdate(
    {
      type: { $in: [...handlers.keys()] },
      $or: [{ status: 'queued', runAt: { $lte: now } }, { status: 'running', leaseUntil: { $lt: now } }],
    },
    { $set: { status: 'running', leaseUntil: new Date(now.getTime() + LEASE_MS) }, $inc: { attempts: 1 } },
    { sort: { runAt: 1 }, returnDocument: 'after' },
  ).lean()
  if (!job) return false

  const handler = handlers.get(job.type)!
  try {
    await handler(job.payload, { id: String(job._id), attempts: job.attempts })
    await JobModel.updateOne({ _id: job._id }, { $set: { status: 'done', finishedAt: new Date(), uniqueKey: null, lastError: '' } })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const dead = err instanceof PermanentJobError || job.attempts >= job.maxAttempts
    if (dead) console.error(`Job ${job.type} ${job._id} gave up:`, message)
    await JobModel.updateOne(
      { _id: job._id },
      dead
        ? { $set: { status: 'dead', lastError: message.slice(0, 1000), finishedAt: new Date(), uniqueKey: null } }
        : { $set: { status: 'queued', lastError: message.slice(0, 1000), leaseUntil: null, runAt: new Date(Date.now() + Math.min(2 ** job.attempts * 30_000, 3_600_000)) } },
    )
  }
  // Recurring jobs schedule their next run whatever happened.
  const interval = recurring.get(job.type)
  if (interval) await enqueue(job.type, {}, { runAt: new Date(Date.now() + interval), uniqueKey: `recurring:${job.type}`, maxAttempts: 1 })
  return true
}

/** Runs every due job now, one by one. Tests use this instead of the timer. */
export async function drainJobs(limit = 200) {
  let n = 0
  while (n < limit && (await runOne())) n++
  return n
}

let timer: NodeJS.Timeout | null = null

export async function startWorker(pollMs = 2000) {
  for (const type of recurring.keys()) await enqueue(type, {}, { uniqueKey: `recurring:${type}`, maxAttempts: 1 })
  let busy = false
  timer = setInterval(async () => {
    if (busy) return
    busy = true
    try {
      await drainJobs(50)
    } catch (err) {
      console.error('Job worker error', err)
    } finally {
      busy = false
    }
  }, pollMs)
}

export function stopWorker() {
  if (timer) clearInterval(timer)
  timer = null
}
