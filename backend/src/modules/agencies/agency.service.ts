import type { Types } from 'mongoose'
import { revokeAgencySessions } from '../../lib/session.ts'
import { AppError, notFound } from '../../utils/AppError.ts'
import { TRIAL_DAYS, type AgencyStatus } from './agency.constants.ts'
import { AgencyModel } from './agency.model.ts'

/** Which status each action may start from. Anything else is a 409 with the current status. */
export const TRANSITIONS = {
  approve: { from: ['pending', 'rejected'], to: 'active' },
  reject: { from: ['pending'], to: 'rejected' },
  suspend: { from: ['active'], to: 'suspended' },
  reactivate: { from: ['suspended'], to: 'active' },
} as const satisfies Record<string, { from: readonly AgencyStatus[]; to: AgencyStatus }>

export type AgencyAction = keyof typeof TRANSITIONS

/** Changes an agency's status atomically: only if it is still in an allowed `from` state. */
export async function transitionAgency(id: Types.ObjectId | string, action: AgencyAction, reason = '') {
  const { from, to } = TRANSITIONS[action]
  const now = new Date()
  const set: Record<string, unknown> = { status: to, statusReason: reason, statusChangedAt: now }
  if (action === 'approve') set.approvedAt = now

  const agency = await AgencyModel.findOneAndUpdate({ _id: id, status: { $in: from } }, { $set: set }, { returnDocument: 'after' })
  if (!agency) {
    const current = await AgencyModel.findById(id, { status: 1 }).lean()
    if (!current) throw notFound('Agency not found.')
    throw new AppError(409, 'invalid_status', `This agency is ${current.status}, so it can’t be changed that way.`, {
      status: current.status,
    })
  }

  // The trial starts the first time an agency is approved.
  if (action === 'approve' && !agency.subscription?.startedAt) {
    agency.set('subscription.startedAt', now)
    agency.set('subscription.renewsAt', new Date(now.getTime() + TRIAL_DAYS * 86_400_000))
    await agency.save()
  }
  if (to !== 'active') await revokeAgencySessions(agency._id)
  return agency
}

export async function uniqueSlug(name: string) {
  const base =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'agency'
  let slug = base
  for (let i = 2; await AgencyModel.exists({ slug }); i++) slug = `${base}-${i}`
  return slug
}
