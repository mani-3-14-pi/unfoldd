import { logActivity } from '../../lib/activity.ts'
import { processChecklistRuns } from '../checklist/checklist.service.ts'
import { notify } from '../../lib/notify.ts'
import { contentTeam, publishers } from './content.recipients.ts'
import { ContentModel } from './content.model.ts'
import { send, type ContentDoc } from './content.service.ts'
import { PublishJobModel } from './publishJob.model.ts'

/*
 * Background work for content. Each job claims its rows atomically, so it's safe to run on several servers.
 * It runs inside the API process for now; move it to a worker once there's a job queue.
 */

/** P52 "Send later": sends content whose `sendAt` has come, unless it has moved on in the meantime. */
export async function sendDue() {
  for (;;) {
    // Claim by clearing sendAt; if the send then fails, the content stays ready_for_client for a person to look at.
    const content = await ContentModel.findOneAndUpdate(
      { state: 'ready_for_client', sendAt: { $lte: new Date() }, deletedAt: null },
      { $set: { sendAt: null } },
      { returnDocument: 'before' },
    ).lean()
    if (!content) return
    try {
      await send(null, content as ContentDoc)
    } catch (err) {
      console.error(`Scheduled send of content ${content._id} failed`, err)
    }
  }
}

/** D26: a manual account's job only reminds the publisher at publish time; they post by hand and mark it published. */
export async function remindManualPublishes() {
  const due = await ContentModel.find({ state: 'scheduled', publishDate: { $lte: new Date() }, deletedAt: null }, { _id: 1 }).lean()
  for (const { _id } of due) {
    const job = await PublishJobModel.findOneAndUpdate(
      { content: _id, status: 'queued', 'account.kind': 'manual', remindedAt: null },
      { $set: { remindedAt: new Date() } },
    ).lean()
    if (!job) continue
    const content = (await ContentModel.findById(_id).lean()) as ContentDoc
    await notify({
      recipients: await publishers(content),
      audience: 'agency',
      agency: content.agency,
      client: content.client,
      category: 'publishing',
      event: 'publish.manual_due',
      title: `Time to publish ${content.title}`,
      body: 'Post it by hand, then tap “Mark as published” and paste the link.',
      entity: { type: 'content', id: content._id },
      link: `/app/content/${content._id}`,
      urgent: true,
    })
  }
}

/** D30: a publish date passed without the content being scheduled. Never auto-publish; alert once per date. */
export async function alertMissedSlots() {
  for (;;) {
    const content = (await ContentModel.findOneAndUpdate(
      {
        publishDate: { $lt: new Date() },
        state: { $in: ['planned', 'in_production', 'internal_review', 'ready_for_client', 'client_review', 'changes_requested', 'approved'] },
        deletedAt: null,
        $expr: { $ne: ['$missedSlotAlertedFor', '$publishDate'] },
      },
      [{ $set: { missedSlotAlertedFor: '$publishDate' } }],
      { returnDocument: 'after', updatePipeline: true },
    ).lean()) as ContentDoc | null
    if (!content) return
    const e = await logActivity(null, {
      action: 'content.slot_missed',
      message: `${content.title} missed its publish slot`,
      agency: content.agency,
      client: content.client,
      target: { type: 'content', id: content._id, label: content.title },
      meta: { publishDate: content.publishDate, state: content.state },
    })
    await notify({
      recipients: await contentTeam(content),
      audience: 'agency',
      agency: content.agency,
      client: content.client,
      category: 'publishing',
      event: 'content.slot_missed',
      title: `Slot missed: ${content.title}`,
      body: 'Its publish date passed before it was scheduled. Pick a new date.',
      entity: { type: 'content', id: content._id },
      link: `/app/content/${content._id}`,
      urgent: true,
      activity: e?._id,
    })
  }
}

export async function runContentJobs() {
  for (const job of [sendDue, remindManualPublishes, alertMissedSlots, processChecklistRuns]) {
    await job().catch((err) => console.error(`Content job ${job.name} failed`, err))
  }
}
