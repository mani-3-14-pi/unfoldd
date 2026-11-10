import type { Request, Response } from 'express'
import mongoose from 'mongoose'

/*
 * Live updates (server-sent events). The browser keeps one `GET /api/events` open; when something of its agency
 * changes, it gets a `change` event and refetches what it shows. The event only says *that* something changed,
 * never what: the data itself still comes through the normal, permission-checked routes.
 *
 * Changes are picked up with a MongoDB change stream, so they're seen whichever process or job made them.
 */

/** The collections the dashboard is built from. */
const WATCHED = ['contents', 'versions', 'tasks', 'contentplans', 'clients', 'activities', 'memberships', 'publishjobs']
/** Several writes in a row (one action often touches a few documents) become one event. */
const BATCH_MS = 300
/** Keeps proxies from closing an idle connection. */
const HEARTBEAT_MS = 25_000

const listeners = new Map<string, Set<Response>>()
const pending = new Map<string, NodeJS.Timeout>()

function broadcast(agency: string) {
  if (!listeners.has(agency) || pending.has(agency)) return
  pending.set(
    agency,
    setTimeout(() => {
      pending.delete(agency)
      for (const res of listeners.get(agency) ?? []) res.write('event: change\ndata: {}\n\n')
    }, BATCH_MS),
  )
}

/** `GET /api/events` for an agency session. */
export function liveEvents(req: Request, res: Response) {
  const agency = String(req.agencyAuth!.agency._id)
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.write('retry: 5000\n\n')
  if (!listeners.has(agency)) listeners.set(agency, new Set())
  listeners.get(agency)!.add(res)
  const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS)
  req.on('close', () => {
    clearInterval(heartbeat)
    listeners.get(agency)?.delete(res)
    if (!listeners.get(agency)?.size) listeners.delete(agency)
  })
}

/** Starts watching the database. Reopens after an error; without a replica set, live updates are just off. */
export function startLiveUpdates() {
  const stream = mongoose.connection.db!.watch(
    [{ $match: { operationType: { $in: ['insert', 'update', 'replace'] }, 'ns.coll': { $in: WATCHED } } }, { $project: { 'fullDocument.agency': 1 } }],
    { fullDocument: 'updateLookup' },
  )
  stream.on('change', (change: { fullDocument?: { agency?: unknown } }) => {
    if (change.fullDocument?.agency) broadcast(String(change.fullDocument.agency))
  })
  stream.on('error', (err: { code?: number; message?: string }) => {
    void stream.close()
    // 40573: change streams need a replica set.
    if (err.code === 40573) return console.warn('Live updates are off: MongoDB is not a replica set.')
    console.warn(`Live updates stopped (${err.message}); retrying in 5s.`)
    setTimeout(startLiveUpdates, 5000).unref()
  })
}
