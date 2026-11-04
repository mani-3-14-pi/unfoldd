import type { Request } from 'express'
import type { ClientSession, Types } from 'mongoose'
import { z } from 'zod'
import { logActivity } from '../../lib/activity.ts'
import { objectId } from '../../lib/ids.ts'
import { notify } from '../../lib/notify.ts'
import { currentUser } from '../../lib/scope.ts'
import { AppError, invalid, notFound } from '../../utils/AppError.ts'
import { AgencyAccessModel } from '../clients/agencyAccess.model.ts'
import { ClientMemberModel } from '../clients/clientMember.model.ts'
import { contentTeam } from '../content/content.recipients.ts'
import { ContentModel, type Content } from '../content/content.model.ts'
import { VersionModel, versionLabel } from '../content/version.model.ts'
import { FileModel } from '../files/file.model.ts'
import { MembershipModel } from '../users/membership.model.ts'
import { MessageModel } from './message.model.ts'
import { ThreadModel } from './thread.model.ts'

type ContentDoc = Content & { _id: Types.ObjectId }

// ── Input ────────────────────────────────────────────────────────────────────

/** D12: a shape in 0–1 normalised coordinates, so it fits any screen and aspect ratio. */
const point = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
const shapeSchema = z.object({
  type: z.enum(['pen', 'circle', 'rect', 'arrow', 'highlight', 'text']),
  points: z.array(point).max(2000),
  color: z.string().max(20).optional(),
  width: z.number().min(0).max(1).optional(),
  text: z.string().max(500).optional(),
})

export const anchorSchema = z.object({
  versionFile: z.string().optional(),
  timeMs: z.number().int().min(0).optional(),
  shapes: z.array(shapeSchema).max(50).optional(),
  snapshot: z.string().optional(),
})

export const messageInput = {
  body: z.string().trim().max(5000).default(''),
  voice: z.object({ file: z.string(), durationMs: z.number().int().min(0).max(30 * 60_000) }).optional(),
  attachments: z.array(z.string()).max(10).default([]),
  mentions: z.array(z.string()).max(20).default([]),
}

export type MessageInput = { body: string; voice?: { file: string; durationMs: number }; attachments: string[]; mentions: string[] }

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Files a message may carry: uploaded to this client, and no more private than the thread. */
async function attachableFiles(content: { agency: Types.ObjectId; client: Types.ObjectId }, ids: string[], visibility: 'internal' | 'client') {
  if (!ids.length) return []
  const oids = ids.map((id) => objectId(id, 'File not found.'))
  const files = await FileModel.find({
    _id: { $in: oids },
    agency: content.agency,
    client: content.client,
    deletedAt: null,
    ...(visibility === 'client' ? { visibility: 'client' } : {}),
  }).lean()
  if (files.length !== oids.length) throw invalid('attachments', 'Upload the files first')
  return oids
}

/** Mentions must be people who can read the thread. Client people can't be mentioned in internal threads. */
async function validMentions(content: { agency: Types.ObjectId; client: Types.ObjectId }, ids: string[], visibility: 'internal' | 'client') {
  if (!ids.length) return []
  const oids = ids.map((id) => objectId(id, 'Person not found.'))
  const [agencyPeople, access, clientPeople] = await Promise.all([
    MembershipModel.find({ agency: content.agency, user: { $in: oids }, status: 'active' }, { user: 1, role: 1 }).lean(),
    AgencyAccessModel.find({ client: content.client, user: { $in: oids } }, { user: 1 }).lean(),
    visibility === 'client' ? ClientMemberModel.find({ client: content.client, user: { $in: oids }, status: 'active' }, { user: 1 }).lean() : [],
  ])
  const assigned = new Set(access.map((a) => String(a.user)))
  const ok = new Set([
    ...agencyPeople.filter((m) => m.role === 'owner' || m.role === 'admin' || assigned.has(String(m.user))).map((m) => String(m.user)),
    ...clientPeople.map((c) => String(c.user)),
  ])
  return oids.filter((id) => ok.has(String(id)))
}

export async function buildMessage(
  req: Request,
  content: { agency: Types.ObjectId; client: Types.ObjectId },
  input: MessageInput,
  visibility: 'internal' | 'client',
) {
  const voiceFile = input.voice ? (await attachableFiles(content, [input.voice.file], visibility))[0] : null
  if (!input.body && !voiceFile && !input.attachments.length) throw invalid('body', 'Write a comment or record a voice note')
  const author = currentUser(req)
  return {
    agency: content.agency,
    client: content.client,
    visibility,
    author: { id: author._id, name: author.name, side: author.side },
    body: input.body,
    voice: voiceFile ? { file: voiceFile, durationMs: input.voice!.durationMs, transcriptStatus: 'pending' as const } : undefined,
    attachments: await attachableFiles(content, input.attachments, visibility),
    mentions: await validMentions(content, input.mentions, visibility),
  }
}

/** Reserves `n` pin numbers for a content and visibility in one atomic step (D75). Returns the first. */
async function reservePins(contentId: Types.ObjectId, visibility: 'internal' | 'client', n: number, session?: ClientSession) {
  const field = visibility === 'client' ? 'counters.clientPin' : 'counters.internalPin'
  const after = await ContentModel.findOneAndUpdate({ _id: contentId }, { $inc: { [field]: n } }, { returnDocument: 'after', session }).lean()
  const last = visibility === 'client' ? after!.counters!.clientPin : after!.counters!.internalPin
  return last - n + 1
}

/** A feedback anchor must point at a file of the version the feedback is on. */
async function checkAnchor(versionId: Types.ObjectId, anchor: z.infer<typeof anchorSchema> | undefined, content: ContentDoc) {
  if (!anchor) return undefined
  const version = await VersionModel.findById(versionId, { files: 1 }).lean()
  const versionFile = anchor.versionFile ? objectId(anchor.versionFile, 'Slide not found.') : null
  if (versionFile && !version?.files.some((f) => String(f._id) === String(versionFile))) throw invalid('anchor', 'That slide isn’t part of this version')
  const snapshot = anchor.snapshot ? (await attachableFiles(content, [anchor.snapshot], 'internal'))[0] : null
  return { anchor: { versionFile, timeMs: anchor.timeMs ?? null, shapes: anchor.shapes }, snapshot }
}

// ── Creating feedback ─────────────────────────────────────────────────────────

export interface NewThread {
  content: ContentDoc
  versionId: Types.ObjectId
  versionNumber: number
  visibility: 'internal' | 'client'
  kind: 'feedback' | 'discussion'
  anchor?: z.infer<typeof anchorSchema>
  message: MessageInput
  /** Client feedback starts as a pending draft (D14); agency feedback is submitted at once. */
  draft: boolean
  assignee?: Types.ObjectId | null
}

export async function createThread(req: Request, input: NewThread) {
  const { content } = input
  const anchored = await checkAnchor(input.versionId, input.anchor, content)
  const message = await buildMessage(req, content, input.message, input.visibility)
  const now = new Date()
  const submittedAt = input.draft ? null : now
  const pin = input.draft || input.kind !== 'feedback' ? null : await reservePins(content._id, input.visibility, 1)

  const thread = await ThreadModel.create({
    agency: content.agency,
    client: content.client,
    context: { type: 'content', id: content._id },
    content: content._id,
    version: input.versionId,
    versionNumber: input.versionNumber,
    kind: input.kind,
    visibility: input.visibility,
    pin,
    anchor: anchored?.anchor,
    snapshot: anchored?.snapshot ?? null,
    assignee: input.assignee ?? null,
    status: input.kind === 'feedback' ? 'open' : null,
    author: message.author,
    submittedAt,
    messageCount: 1,
    lastMessageAt: now,
  })
  await MessageModel.create({ ...message, thread: thread._id, submittedAt })
  if (!input.draft) await afterSubmit(req, content, [thread._id])
  return thread
}

/**
 * Submits the caller's pending drafts on a version ("Send feedback", D14). Pins are given now, in creation
 * order. Returns how many were submitted.
 */
export async function submitDrafts(req: Request, content: ContentDoc, versionId: Types.ObjectId, opts: { session?: ClientSession; notify?: boolean } = {}) {
  const me = currentUser(req)._id
  const drafts = await ThreadModel.find(
    { content: content._id, version: versionId, 'author.id': me, submittedAt: null, deletedAt: null },
    { _id: 1, kind: 1, visibility: 1 },
    { session: opts.session },
  )
    .sort({ createdAt: 1 })
    .lean()
  if (!drafts.length) return 0

  const now = new Date()
  const feedback = drafts.filter((d) => d.kind === 'feedback')
  if (feedback.length) {
    const first = await reservePins(content._id, feedback[0].visibility as 'internal' | 'client', feedback.length, opts.session)
    await ThreadModel.bulkWrite(
      feedback.map((d, i) => ({ updateOne: { filter: { _id: d._id, submittedAt: null }, update: { $set: { submittedAt: now, pin: first + i } } } })),
      { session: opts.session },
    )
  }
  const discussions = drafts.filter((d) => d.kind !== 'feedback').map((d) => d._id)
  if (discussions.length) await ThreadModel.updateMany({ _id: { $in: discussions }, submittedAt: null }, { $set: { submittedAt: now } }, { session: opts.session })
  const ids = drafts.map((d) => d._id)
  await MessageModel.updateMany({ thread: { $in: ids }, submittedAt: null }, { $set: { submittedAt: now } }, { session: opts.session })
  if (opts.notify !== false) await afterSubmit(req, content, ids)
  return drafts.length
}

/** One notification per batch, never one per comment, and the event log entry. */
async function afterSubmit(req: Request, content: ContentDoc, threadIds: Types.ObjectId[]) {
  const me = currentUser(req)
  const threads = await ThreadModel.find({ _id: { $in: threadIds } }, { visibility: 1, kind: 1, versionNumber: 1 }).lean()
  const shared = threads.filter((t) => t.visibility === 'client')
  const v = threads[0]?.versionNumber ? ` on ${versionLabel(threads[0].versionNumber)}` : ''
  const event = await logActivity(req, {
    action: 'feedback.submitted',
    message: `${me.name} left ${threads.length} comment${threads.length === 1 ? '' : 's'}${v} of ${content.title}`,
    agency: content.agency,
    client: content.client,
    visibility: shared.length ? 'client' : 'internal',
    target: { type: 'content', id: content._id, label: content.title },
    meta: { threads: threadIds },
  })
  if (me.side === 'client') {
    await notify({
      recipients: await contentTeam(content),
      audience: 'agency',
      agency: content.agency,
      client: content.client,
      category: 'feedback',
      event: 'feedback.submitted',
      title: `${me.name} left feedback on ${content.title}`,
      entity: { type: 'content', id: content._id },
      link: `/app/content/${content._id}`,
      activity: event?._id,
    })
  }
  // Mentions, once each.
  const mentioned = await MessageModel.distinct('mentions', { thread: { $in: threadIds } })
  await notifyMentions(req, content, mentioned as Types.ObjectId[])
}

async function notifyMentions(req: Request, content: ContentDoc, users: Types.ObjectId[]) {
  if (!users.length) return
  const me = currentUser(req)
  const clientUsers = new Set(
    (await ClientMemberModel.find({ client: content.client, user: { $in: users }, status: 'active' }, { user: 1 }).lean()).map((c) => String(c.user)),
  )
  for (const audience of ['agency', 'client'] as const) {
    const recipients = users.filter((u) => clientUsers.has(String(u)) === (audience === 'client'))
    await notify({
      recipients,
      audience,
      agency: content.agency,
      client: content.client,
      category: 'feedback',
      event: 'feedback.mentioned',
      title: `${me.name} mentioned you on ${content.title}`,
      entity: { type: 'content', id: content._id },
      link: audience === 'client' ? `/c/content/${content._id}` : `/app/content/${content._id}`,
      except: me._id,
    })
  }
}

// ── Replies, status, drafts ──────────────────────────────────────────────────

/** A reply posts at once: it's conversation, not a new review (Flow 6, step 2). */
export async function reply(req: Request, threadId: Types.ObjectId, content: ContentDoc, input: MessageInput) {
  const thread = await ThreadModel.findOne({ _id: threadId, content: content._id, deletedAt: null })
  if (!thread) throw notFound('Comment not found.')
  if (!thread.submittedAt) throw new AppError(409, 'draft', 'This comment is still a draft. Edit it instead of replying.')
  const now = new Date()
  const message = await MessageModel.create({
    ...(await buildMessage(req, content, input, thread.visibility as 'internal' | 'client')),
    thread: thread._id,
    submittedAt: now,
  })
  await ThreadModel.updateOne({ _id: thread._id }, { $inc: { messageCount: 1 }, $set: { lastMessageAt: now } })

  const me = currentUser(req)
  if (thread.visibility === 'client') {
    // The other side hears about it: the agency team, or the client people in the conversation.
    if (me.side === 'client') {
      await notify({
        recipients: await contentTeam(content),
        audience: 'agency',
        agency: content.agency,
        client: content.client,
        category: 'feedback',
        event: 'feedback.replied',
        title: `${me.name} replied on ${content.title}`,
        entity: { type: 'content', id: content._id },
        link: `/app/content/${content._id}`,
      })
    } else {
      const participants = await MessageModel.distinct('author.id', { thread: thread._id, 'author.side': 'client' })
      await notify({
        recipients: participants as Types.ObjectId[],
        audience: 'client',
        agency: content.agency,
        client: content.client,
        category: 'feedback',
        event: 'feedback.replied',
        title: `${me.name} replied to your comment on ${content.title}`,
        entity: { type: 'content', id: content._id },
        link: `/c/content/${content._id}`,
      })
    }
  }
  await notifyMentions(req, content, message.mentions as Types.ObjectId[])
  return message
}

/** D83: a draft left on a version that has since been replaced is moved to the current one (anchor dropped). */
export async function copyDraftToCurrent(req: Request, threadId: Types.ObjectId, content: ContentDoc) {
  const me = currentUser(req)._id
  const thread = await ThreadModel.findOne({ _id: threadId, content: content._id, 'author.id': me, submittedAt: null, deletedAt: null })
  if (!thread) throw notFound('Draft not found.')
  if (!content.currentVersion || String(thread.version) === String(content.currentVersion)) return thread
  const current = await VersionModel.findById(content.currentVersion, { number: 1 }).lean()
  thread.version = content.currentVersion
  thread.versionNumber = current!.number
  thread.anchor = { versionFile: null, timeMs: thread.anchor?.timeMs ?? null, shapes: undefined }
  thread.snapshot = null
  await thread.save()
  return thread
}
