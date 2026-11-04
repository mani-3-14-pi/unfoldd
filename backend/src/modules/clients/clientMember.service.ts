import type { Request } from 'express'
import mongoose, { type PipelineStage, type Types } from 'mongoose'
import { logActivity } from '../../lib/activity.ts'
import { revokeClientMemberSessions } from '../../lib/session.ts'
import { AppError, notFound } from '../../utils/AppError.ts'
import { UserModel } from '../users/user.model.ts'
import { InvitationModel } from '../invitations/invitation.model.ts'
import { ClientMemberModel, type ClientRole } from './clientMember.model.ts'
import { ClientModel } from './client.model.ts'

export const clientMembersPipeline = (client: Types.ObjectId): PipelineStage[] => [
  { $match: { client } },
  { $lookup: { from: 'users', localField: 'user', foreignField: '_id', as: 'user', pipeline: [{ $project: { name: 1, email: 1, lastLoginAt: 1 } }] } },
  { $set: { user: { $first: '$user' } } },
  { $sort: { role: 1, 'user.name': 1 } },
]

const lastAdmin = () =>
  new AppError(409, 'last_admin', 'A client always needs at least one admin. Make someone else an admin first.')

/**
 * Changes or removes a client member, keeping at least one active Admin (D47). Runs in a transaction that also
 * bumps the client's `memberRev`, so two concurrent changes conflict instead of both passing the check.
 */
export async function changeClientMember(
  req: Request,
  client: { _id: Types.ObjectId; agency: Types.ObjectId; brandName: string },
  userId: Types.ObjectId,
  change: { role: ClientRole } | { remove: true },
) {
  const before = await ClientMemberModel.findOne({ client: client._id, user: userId }).lean()
  if (!before) throw notFound('Member not found.')

  await mongoose.connection.transaction(async (session) => {
    if ('remove' in change) await ClientMemberModel.deleteOne({ _id: before._id }, { session })
    else await ClientMemberModel.updateOne({ _id: before._id }, { $set: { role: change.role } }, { session })
    await ClientModel.updateOne({ _id: client._id }, { $inc: { memberRev: 1 } }, { session })
    const admins = await ClientMemberModel.countDocuments({ client: client._id, role: 'admin', status: 'active' }, { session })
    if (admins === 0) throw lastAdmin()
  })

  const user = await UserModel.findById(userId, { name: 1 }).lean()
  const by = (req.agencyAuth ?? req.clientAuth)!.user.name
  if ('remove' in change) {
    await revokeClientMemberSessions(userId, client._id)
    await logActivity(req, {
      action: 'client_member.removed',
      message: `${by} removed ${user?.name} from ${client.brandName}`,
      agency: client.agency,
      client: client._id,
      visibility: 'client',
      target: { type: 'user', id: userId, label: user?.name },
      before: { role: before.role },
    })
  } else if (change.role !== before.role) {
    await logActivity(req, {
      action: 'client_member.role_changed',
      message: `${by} changed ${user?.name}’s role to ${change.role}`,
      agency: client.agency,
      client: client._id,
      visibility: 'client',
      target: { type: 'user', id: userId, label: user?.name },
      before: { role: before.role },
      after: { role: change.role },
    })
  }
}

/** The first person invited to a client must be an Admin, so the client can always approve (Flow 2). */
export async function assertAdminWillExist(clientId: Types.ObjectId, role: ClientRole) {
  if (role === 'admin') return
  const [admins, pendingAdmins] = await Promise.all([
    ClientMemberModel.countDocuments({ client: clientId, role: 'admin', status: 'active' }),
    InvitationModel.countDocuments({ client: clientId, role: 'admin', status: 'pending', expiresAt: { $gt: new Date() } }),
  ])
  if (!admins && !pendingAdmins) {
    throw new AppError(400, 'invalid_input', 'Some fields are invalid.', { role: ['Invite the client’s first person as an admin'] })
  }
}
