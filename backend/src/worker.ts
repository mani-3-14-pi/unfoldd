import { every, registerJob } from './lib/jobs.ts'
import './lib/mailer.ts'
import { sendDigests } from './lib/notify.ts'
import { runContentJobs } from './modules/content/content.jobs.ts'
import './modules/analytics/analytics.service.ts'
import { remindMeetings } from './modules/meetings/meetings.routes.ts'
import './modules/publishing/publish.worker.ts'

/*
 * Every background job type, in one place. Importing this file registers the handlers; `startWorker()` in
 * server.ts runs them. One-off jobs (email.send, publish.run …) are registered by their own modules.
 */

// D68: non-urgent notifications go out as one email digest.
registerJob('notifications.digest', () => sendDigests())
every('notifications.digest', 15 * 60_000)

// Send-later, manual publish reminders, missed-slot alerts and the AI checklist.
registerJob('content.tick', () => runContentJobs())
every('content.tick', 60_000)

// D68: "meeting in 15 min" reminders.
registerJob('meetings.remind', () => remindMeetings())
every('meetings.remind', 60_000)

// D27: connections that publish in the next 24 hours are checked, so there's time to reconnect.
every('connections.health', 60 * 60_000)

// D58: fresh numbers for recently published posts.
every('analytics.collect', 6 * 60 * 60_000)
