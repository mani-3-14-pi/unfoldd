import { env, isProd, isTest } from '../config/env.ts'
import { OutboxModel } from '../modules/notifications/outbox.model.ts'
import { enqueue, PermanentJobError, registerJob } from './jobs.ts'

export interface Email {
  to: string
  subject: string
  text: string
  html?: string
  kind: 'invitation' | 'notification' | 'digest' | 'security' | 'support'
}

/**
 * The only way the app sends email. Every message is written to the outbox first, then sent by a background
 * job, so a slow or failing provider never slows a request and failures are retried. With RESEND_API_KEY the
 * job sends through Resend; without it the dev mailer just prints the message.
 */
export async function sendEmail(email: Email) {
  const row = await OutboxModel.create({ ...email, from: env.EMAIL_FROM, provider: env.RESEND_API_KEY ? 'resend' : 'dev', status: 'queued' })
  await enqueue('email.send', { outboxId: String(row._id) }, { maxAttempts: 8 })
  return row
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
/** Plain text → simple HTML: paragraphs, and links made clickable. */
const toHtml = (text: string) =>
  text
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')}</p>`)
    .join('')

registerJob('email.send', async ({ outboxId }) => {
  const mail = await OutboxModel.findOne({ _id: outboxId, status: { $ne: 'sent' } })
  if (!mail) return
  if (!env.RESEND_API_KEY) {
    if (!isProd && !isTest) console.log(`\n✉️  To: ${mail.to}\n   Subject: ${mail.subject}\n   ${mail.text.replace(/\n/g, '\n   ')}\n`)
    await OutboxModel.updateOne({ _id: mail._id }, { $set: { status: 'sent', provider: 'dev', sentAt: new Date() } })
    return
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      // A retried job never sends the same email twice.
      'Idempotency-Key': `outbox-${mail._id}`,
    },
    body: JSON.stringify({ from: mail.from, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html ?? toHtml(mail.text) }),
  })
  if (res.ok) {
    await OutboxModel.updateOne({ _id: mail._id }, { $set: { status: 'sent', provider: 'resend', sentAt: new Date(), error: '' } })
    return
  }
  const body = await res.text()
  await OutboxModel.updateOne({ _id: mail._id }, { $set: { error: `${res.status} ${body.slice(0, 300)}` } })
  // 4xx (bad address, unverified domain) won't fix itself; 429 and 5xx are retried.
  if (res.status >= 400 && res.status < 500 && res.status !== 429) {
    await OutboxModel.updateOne({ _id: mail._id }, { $set: { status: 'failed' } })
    throw new PermanentJobError(`Resend refused the email: ${res.status}`)
  }
  throw new Error(`Resend error ${res.status}`)
})

export const appLink = (path: string) => `${env.APP_URL.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`
