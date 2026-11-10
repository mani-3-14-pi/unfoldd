import nodemailer, { type Transporter } from 'nodemailer'
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
 * job, so a slow or failing provider never slows a request and failures are retried. With SMTP_HOST the
 * job sends through SMTP (Nodemailer); without it the dev mailer just prints the message.
 */
export async function sendEmail(email: Email) {
  const row = await OutboxModel.create({ ...email, from: env.EMAIL_FROM, provider: env.SMTP_HOST ? 'smtp' : 'dev', status: 'queued' })
  await enqueue('email.send', { outboxId: String(row._id) }, { maxAttempts: 8 })
  return row
}

let transporter: Transporter | null = null
function smtp() {
  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  })
  return transporter
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
  if (!env.SMTP_HOST) {
    if (!isProd && !isTest) console.log(`\n✉️  To: ${mail.to}\n   Subject: ${mail.subject}\n   ${mail.text.replace(/\n/g, '\n   ')}\n`)
    await OutboxModel.updateOne({ _id: mail._id }, { $set: { status: 'sent', provider: 'dev', sentAt: new Date() } })
    return
  }
  try {
    await smtp().sendMail({
      from: mail.from,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html ?? toHtml(mail.text),
      // Lets a mail server spot a retried job as the same message.
      messageId: `<outbox-${mail._id}@unfoldd>`,
    })
    await OutboxModel.updateOne({ _id: mail._id }, { $set: { status: 'sent', provider: 'smtp', sentAt: new Date(), error: '' } })
  } catch (err) {
    const e = err as { code?: string; responseCode?: number; message?: string }
    await OutboxModel.updateOne({ _id: mail._id }, { $set: { error: `${e.responseCode ?? e.code ?? ''} ${e.message ?? err}`.slice(0, 300) } })
    // Wrong login or a rejected address won't fix itself; connection problems and 4xx SMTP replies are retried.
    if (e.code === 'EAUTH' || e.code === 'EENVELOPE' || (e.responseCode && e.responseCode >= 500)) {
      await OutboxModel.updateOne({ _id: mail._id }, { $set: { status: 'failed' } })
      throw new PermanentJobError(`SMTP refused the email: ${e.responseCode ?? e.code}`)
    }
    throw err
  }
})

export const appLink = (path: string) => `${env.APP_URL.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`

/** A link into the client app when CLIENT_APP_URL is set, else into the main app. */
export const clientAppLink = (path: string) =>
  env.CLIENT_APP_URL ? `${env.CLIENT_APP_URL.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}` : appLink(path)
