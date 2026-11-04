import { Router, type Request } from 'express'
import type { Types } from 'mongoose'
import { z } from 'zod'
import { objectId } from '../../lib/ids.ts'
import { notify } from '../../lib/notify.ts'
import { clientCan, currentUser, loadClient, scopeFilter } from '../../lib/scope.ts'
import { forbidden, notFound } from '../../utils/AppError.ts'
import { ClientModel } from '../clients/client.model.ts'
import { clientPeople } from '../content/content.recipients.ts'
import { buildMessage, messageInput } from './feedback.service.ts'
import { MessageModel } from './message.model.ts'
import { ThreadModel } from './thread.model.ts'

/**
 * Communication (Flow 11, D18–D20): one General thread per client shared with the client, one internal General
 * thread for the agency, plus every contextual discussion. Internal and client threads are separate, never one
 * toggle (D20). The account manager is always subscribed (D19).
 */
export const conversationsRouter = Router()
export const clientConversationsRouter = Router()

type Vis = 'internal' | 'client'

/** The client's General thread for a visibility, created the first time it's needed. */
async function generalThread(client: { _id: Types.ObjectId; agency: Types.ObjectId }, visibility: Vis, author: { _id: Types.ObjectId; name: string; side: string }) {
  return ThreadModel.findOneAndUpdate(
    { 'context.type': 'client_general', 'context.id': client._id, visibility },
    {
      $setOnInsert: {
        agency: client.agency,
        client: client._id,
        context: { type: 'client_general', id: client._id },
        kind: 'discussion',
        visibility,
        author: { id: author._id, name: author.name, side: author.side },
        submittedAt: new Date(),
      },
    },
    { upsert: true, returnDocument: 'after' },
  ).lean()
}

/** Conversations the person can see: General first, then contextual discussions, most recent first. */
async function listConversations(client: Types.ObjectId, clientOnly: boolean) {
  const threads = await ThreadModel.find({
    client,
    kind: 'discussion',
    submittedAt: { $ne: null },
    deletedAt: null,
    ...(clientOnly ? { visibility: 'client' } : {}),
  })
    .sort({ lastMessageAt: -1 })
    .limit(200)
    .lean()
  const last = await MessageModel.aggregate([
    { $match: { thread: { $in: threads.map((t) => t._id) }, deletedAt: null } },
    { $sort: { createdAt: -1 } },
    { $group: { _id: '$thread', body: { $first: '$body' }, author: { $first: '$author' }, at: { $first: '$createdAt' } } },
  ])
  return threads
    .map((t) => ({ id: t._id, context: t.context, visibility: t.visibility, messageCount: t.messageCount, lastMessageAt: t.lastMessageAt, last: last.find((l) => String(l._id) === String(t._id)) ?? null }))
    .sort((a, b) => Number(b.context?.type === 'client_general') - Number(a.context?.type === 'client_general'))
}

async function post(req: Request, client: { _id: Types.ObjectId; agency: Types.ObjectId; brandName: string }, threadId: Types.ObjectId, input: any) {
  const thread = await ThreadModel.findOne({ _id: threadId, client: client._id, kind: 'discussion', deletedAt: null })
  if (!thread) throw notFound('Conversation not found.')
  if (req.clientAuth && thread.visibility !== 'client') throw notFound('Conversation not found.')
  const now = new Date()
  const message = await MessageModel.create({ ...(await buildMessage(req, { agency: client.agency, client: client._id }, input, thread.visibility as Vis)), thread: thread._id, submittedAt: now })
  await ThreadModel.updateOne({ _id: thread._id }, { $inc: { messageCount: 1 }, $set: { lastMessageAt: now } })

  const me = currentUser(req)
  const c = await ClientModel.findById(client._id, { accountManager: 1 }).lean()
  const agencyParticipants = (await MessageModel.distinct('author.id', { thread: thread._id, 'author.side': 'agency' })) as Types.ObjectId[]
  const agencyRecipients = [...agencyParticipants, ...(c?.accountManager ? [c.accountManager] : [])]
  const link = (side: 'agency' | 'client') => (side === 'client' ? `/c/conversations/${thread._id}` : `/app/clients/${client._id}/conversations/${thread._id}`)
  await notify({ recipients: agencyRecipients, audience: 'agency', agency: client.agency, client: client._id, category: 'clients', event: 'conversation.message', title: `${me.name} in ${client.brandName}`, body: input.body?.slice(0, 200), entity: { type: 'thread', id: thread._id }, link: link('agency'), except: me._id })
  if (thread.visibility === 'client') {
    await notify({ recipients: await clientPeople(client._id), audience: 'client', agency: client.agency, client: client._id, category: 'clients', event: 'conversation.message', title: `New message from ${me.name}`, body: input.body?.slice(0, 200), entity: { type: 'thread', id: thread._id }, link: link('client'), except: me._id })
  }
  return message
}

const messagesOf = (threadId: Types.ObjectId, before?: string) =>
  MessageModel.find({ thread: threadId, deletedAt: null, submittedAt: { $ne: null }, ...(before ? { createdAt: { $lt: new Date(before) } } : {}) })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean()
    .then((m) => m.reverse())

const pageSchema = z.object({ before: z.iso.datetime().optional() })

// ── Agency ──────────────────────────────────────────────────────────────────

conversationsRouter.get('/:id/conversations', async (req, res) => {
  const client = await loadClient(req, objectId(req.params.id, 'Client not found.'))
  const me = { ...req.agencyAuth!.user, side: 'agency' }
  await Promise.all([generalThread(client, 'client', me), generalThread(client, 'internal', me)])
  res.json({ items: await listConversations(client._id, false) })
})

conversationsRouter.get('/:id/conversations/:threadId/messages', async (req, res) => {
  const client = await loadClient(req, objectId(req.params.id, 'Client not found.'))
  const thread = await ThreadModel.findOne({ _id: objectId(req.params.threadId, 'Conversation not found.'), client: client._id, kind: 'discussion' }, { _id: 1 }).lean()
  if (!thread) throw notFound('Conversation not found.')
  res.json({ items: await messagesOf(thread._id, pageSchema.parse(req.query).before) })
})

conversationsRouter.post('/:id/conversations/:threadId/messages', async (req, res) => {
  const client = await loadClient(req, objectId(req.params.id, 'Client not found.'), 'write')
  res.status(201).json({ message: await post(req, client, objectId(req.params.threadId, 'Conversation not found.'), z.object(messageInput).parse(req.body)) })
})

// ── Client ("Contact agency" opens General, D67) ─────────────────────────────

clientConversationsRouter.get('/', async (req, res) => {
  const client = (await ClientModel.findById(req.clientAuth!.client._id).lean())!
  await generalThread(client, 'client', { ...req.clientAuth!.user, side: 'client' })
  res.json({ items: await listConversations(client._id, true) })
})

clientConversationsRouter.get('/:threadId/messages', async (req, res) => {
  const thread = await ThreadModel.findOne({ ...(await scopeFilter(req, { visibility: true })), _id: objectId(req.params.threadId, 'Conversation not found.'), kind: 'discussion' }, { _id: 1 }).lean()
  if (!thread) throw notFound('Conversation not found.')
  res.json({ items: await messagesOf(thread._id, pageSchema.parse(req.query).before) })
})

clientConversationsRouter.post('/:threadId/messages', async (req, res) => {
  if (!clientCan(req.clientAuth!.role, 'feedback')) throw forbidden('Your role can read but not post.')
  const client = (await ClientModel.findById(req.clientAuth!.client._id).lean())!
  res.status(201).json({ message: await post(req, client, objectId(req.params.threadId, 'Conversation not found.'), z.object(messageInput).parse(req.body)) })
})
