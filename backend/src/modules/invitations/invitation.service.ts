import { randomBytes } from 'node:crypto'
import type { Request } from 'express'
import mongoose, { type Types } from 'mongoose'
import { logActivity } from '../../lib/activity.ts'
import { transition } from '../../lib/concurrency.ts'
import { appLink, clientAppLink, sendEmail } from '../../lib/mailer.ts'
import { hashToken } from '../../lib/session.ts'
import { AppError, notFound } from '../../utils/AppError.ts'
import { AgencyModel } from '../agencies/agency.model.ts'
import { AgencyAccessModel } from '../clients/agencyAccess.model.ts'
import { ClientMemberModel } from '../clients/clientMember.model.ts'
import { ClientModel } from '../clients/client.model.ts'
import { MembershipModel } from '../users/membership.model.ts'
import { UserModel } from '../users/user.model.ts'
import { INVITATION_TRANSITIONS, INVITE_TTL_DAYS, InvitationModel, type Invitation } from './invitation.model.ts'

type InvitationDoc = Invitation & { _id: Types.ObjectId; createdAt: Date }

/** `pending` past its expiry is `expired`, even before anything has written that down. */
export const effectiveStatus = (inv: Pick<Invitation, 'status' | 'expiresAt'>) =>
  inv.status === 'pending' && inv.expiresAt.getTime() <= Date.now() ? 'expired' : inv.status

/** What list endpoints return. Never includes the token hash. */
export const presentInvitation = (inv: InvitationDoc) => ({
  id: inv._id,
  kind: inv.kind,
  client: inv.client,
  email: inv.email,
  role: inv.role,
  message: inv.message,
  invitedBy: inv.invitedBy,
  status: effectiveStatus(inv),
  invitedAt: inv.createdAt,
  expiresAt: inv.expiresAt,
  reinviteRequestedAt: inv.reinviteRequestedAt ?? null,
  respondedAt: inv.respondedAt ?? null,
})

export interface InviteInput {
  kind: 'agency' | 'client'
  agency: Types.ObjectId
  client?: Types.ObjectId
  email: string
  role: string
  message?: string
  replaces?: Types.ObjectId
}

async function alreadyMember(input: InviteInput) {
  const user = await UserModel.findOne({ email: input.email }, { _id: 1 }).lean()
  if (!user) return false
  return input.kind === 'agency'
    ? !!(await MembershipModel.exists({ agency: input.agency, user: user._id, status: 'active' }))
    : !!(await ClientMemberModel.exists({ client: input.client, user: user._id, status: 'active' }))
}

/** Creates an invitation and emails the link. Only one pending invitation per person per agency or client. */
export async function createInvitation(req: Request, input: InviteInput) {
  const by = req.agencyAuth?.user ?? req.clientAuth!.user
  if (await alreadyMember(input)) {
    throw new AppError(409, 'already_member', 'Some fields are invalid.', { email: ['This person already has access'] })
  }
  const target = { kind: input.kind, agency: input.agency, client: input.client ?? null, email: input.email }
  const pending = await InvitationModel.findOne({ ...target, status: 'pending', expiresAt: { $gt: new Date() } }).lean()
  if (pending && String(pending._id) !== String(input.replaces)) {
    throw new AppError(409, 'already_invited', 'This person already has a pending invitation. Resend it instead.', { invitationId: pending._id })
  }

  const token = randomBytes(32).toString('base64url')
  const invitation = await InvitationModel.create({
    ...target,
    role: input.role,
    message: input.message ?? '',
    invitedBy: { id: by._id, name: by.name, side: req.agencyAuth ? 'agency' : 'client' },
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000),
    replaces: input.replaces,
  })

  const [agency, client] = await Promise.all([
    AgencyModel.findById(input.agency, { name: 1 }).lean(),
    input.client ? ClientModel.findById(input.client, { brandName: 1 }).lean() : null,
  ])
  const place = client ? `${client.brandName} on Unfoldd (with ${agency?.name})` : `${agency?.name} on Unfoldd`
  await sendEmail({
    to: input.email,
    subject: `${by.name} invited you to ${place}`,
    text: [
      `${by.name} invited you to join ${place} as ${input.role}.`,
      input.message ? `“${input.message}”` : '',
      `Accept the invitation: ${(input.kind === 'client' ? clientAppLink : appLink)(`/invite/${token}`)}`,
      `This link works only for ${input.email} and expires in ${INVITE_TTL_DAYS} days.`,
    ]
      .filter(Boolean)
      .join('\n\n'),
    kind: 'invitation',
  })

  await logActivity(req, {
    action: input.replaces ? 'invitation.resent' : 'invitation.sent',
    message: `${by.name} ${input.replaces ? 're-sent an invitation to' : 'invited'} ${input.email} as ${input.role}`,
    agency: input.agency,
    client: input.client,
    // Client-side colleagues can see who was invited to their own space.
    visibility: input.kind === 'client' ? 'client' : 'internal',
    target: { type: 'invitation', id: invitation._id, label: input.email },
    meta: { kind: input.kind, role: input.role },
  })
  return invitation
}

/** D49: resending issues a new link and revokes the old one. Works from pending, expired or declined. */
export async function resendInvitation(req: Request, inv: InvitationDoc) {
  if (!['pending', 'expired', 'declined'].includes(effectiveStatus(inv))) {
    throw new AppError(409, 'invalid_state', `This invitation is ${effectiveStatus(inv)}, so it can’t be resent.`)
  }
  await InvitationModel.updateOne({ _id: inv._id, status: { $in: ['pending', 'expired', 'declined'] } }, { $set: { status: 'revoked' } })
  return createInvitation(req, {
    kind: inv.kind as 'agency' | 'client',
    agency: inv.agency,
    client: inv.client ?? undefined,
    email: inv.email,
    role: inv.role,
    message: inv.message,
    replaces: inv._id,
  })
}

export async function revokeInvitation(req: Request, inv: InvitationDoc) {
  const revoked = await transition(InvitationModel, { _id: inv._id }, INVITATION_TRANSITIONS.revoke, { label: 'invitation' })
  await logActivity(req, {
    action: 'invitation.revoked',
    message: `${(req.agencyAuth ?? req.clientAuth)!.user.name} cancelled the invitation to ${inv.email}`,
    agency: inv.agency,
    client: inv.client ?? undefined,
    visibility: inv.kind === 'client' ? 'client' : 'internal',
    target: { type: 'invitation', id: inv._id, label: inv.email },
  })
  return revoked
}

export async function findByToken(token: string) {
  const inv = await InvitationModel.findOne({ tokenHash: hashToken(token) }).lean()
  if (!inv) throw notFound('This invitation link isn’t valid.')
  return inv as InvitationDoc
}

/**
 * Who hears about an invitation's outcome: the inviter if they still have access; otherwise, for a client
 * invite, the account manager and agency admins; for an agency invite, the agency admins (D74).
 */
export async function inviteWatchers(inv: InvitationDoc) {
  const inviter = inv.invitedBy?.id
  if (inviter) {
    const stillThere =
      inv.invitedBy?.side === 'client'
        ? await ClientMemberModel.exists({ client: inv.client, user: inviter, status: 'active' })
        : await MembershipModel.exists({ agency: inv.agency, user: inviter, status: 'active' })
    if (stillThere) return { users: [inviter], audience: (inv.invitedBy?.side ?? 'agency') as 'agency' | 'client' }
  }
  const admins = await MembershipModel.find({ agency: inv.agency, role: { $in: ['owner', 'admin'] }, status: 'active' }, { user: 1 }).lean()
  const users = admins.map((m) => m.user)
  if (inv.client) {
    const client = await ClientModel.findById(inv.client, { accountManager: 1 }).lean()
    if (client?.accountManager) users.push(client.accountManager)
  }
  return { users, audience: 'agency' as const }
}

/**
 * Accepts an invitation for the invited email's account. An existing account must give its password: accepting
 * never signs anyone in on the strength of the link alone. A new account is created with the given name and password.
 * Everything happens in one transaction, so a failure leaves the invitation pending.
 */
export async function acceptInvitation(inv: InvitationDoc, userId: Types.ObjectId) {
  await mongoose.connection.transaction(async (session) => {
    const accepted = await InvitationModel.findOneAndUpdate(
      { _id: inv._id, status: 'pending', expiresAt: { $gt: new Date() } },
      { $set: { status: 'accepted', acceptedBy: userId, respondedAt: new Date() } },
      { session, returnDocument: 'after' },
    )
    if (!accepted) throw new AppError(409, 'invalid_state', 'This invitation is no longer pending.')

    if (inv.kind === 'agency') {
      await MembershipModel.updateOne(
        { agency: inv.agency, user: userId },
        { $set: { role: inv.role, status: 'active' }, $unset: { disabledAt: 1 } },
        { session, upsert: true },
      )
    } else {
      const client = await ClientModel.findOne({ _id: inv.client, deletedAt: null, status: { $ne: 'archived' } }, { _id: 1 }, { session })
      if (!client) throw new AppError(409, 'client_unavailable', 'This client space is no longer available.')
      await ClientMemberModel.updateOne(
        { agency: inv.agency, client: inv.client, user: userId },
        { $set: { role: inv.role, status: 'active', invitedBy: inv.invitedBy?.id } },
        { session, upsert: true },
      )
    }
  })
}

/** Gives an agency person access to a client, if they don't have it already. */
export const grantAccess = (agency: Types.ObjectId, client: Types.ObjectId, user: Types.ObjectId, addedBy?: Types.ObjectId) =>
  AgencyAccessModel.updateOne({ client, user }, { $setOnInsert: { agency, client, user, addedBy } }, { upsert: true })
