import { connectDb, disconnectDb } from './config/db.ts'
import { env } from './config/env.ts'
import { createApp } from './app.ts'
import { startWorker, stopWorker } from './lib/jobs.ts'
import { startLiveUpdates } from './lib/live.ts'
import './worker.ts'

await connectDb()
startLiveUpdates()

const server = createApp().listen(env.PORT, () => {
  console.log(`Unfoldd API listening on http://localhost:${env.PORT}`)
})

// The job worker runs in the API process unless turned off (e.g. when a separate worker process runs).
if (!env.JOBS_DISABLED) await startWorker()

const shutdown = () => {
  stopWorker()
  server.close(async () => {
    await disconnectDb()
    process.exit(0)
  })
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
