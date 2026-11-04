import type { Types } from 'mongoose'
import { AgencyAccessModel } from '../clients/agencyAccess.model.ts'
import { ClientMemberModel, type ClientRole } from '../clients/clientMember.model.ts'
import { ClientModel } from '../clients/client.model.ts'
import { MembershipModel } from '../users/membership.model.ts'

type ContentLike = {
  agency: Types.ObjectId
  client: Types.ObjectId
  owner?: Types.ObjectId | null
  reviewer?: Types.ObjectId | null
  collaborators?: Types.ObjectId[]
}

/** Agency people with access to the client (admins see every client). */
async function withAccess(agency: Types.ObjectId, client: Types.ObjectId, users: Types.ObjectId[]) {
  if (!users.length) return []
  const [members, access] = await Promise.all([
    MembershipModel.find({ agency, user: { $in: users }, status: 'active' }, { user: 1, role: 1 }).lean(),
    AgencyAccessModel.find({ client, user: { $in: users } }, { user: 1 }).lean(),
  ])
  const assigned = new Set(access.map((a) => String(a.user)))
  return members.filter((m) => m.role === 'owner' || m.role === 'admin' || assigned.has(String(m.user))).map((m) => m.user)
}

/** The people working on a piece of content: owner, collaborators, reviewer and the client's account manager. */
export async function contentTeam(content: ContentLike) {
  const client = await ClientModel.findById(content.client, { accountManager: 1 }).lean()
  const users = [content.owner, content.reviewer, client?.accountManager, ...(content.collaborators ?? [])].filter(Boolean) as Types.ObjectId[]
  return withAccess(content.agency, content.client, users)
}

/** Who may do internal review (D46): the assigned reviewer, else every Manager+ with access. */
export async function internalReviewers(content: ContentLike) {
  if (content.reviewer) return withAccess(content.agency, content.client, [content.reviewer])
  const managers = await MembershipModel.find(
    { agency: content.agency, role: { $in: ['owner', 'admin', 'manager'] }, status: 'active' },
    { user: 1 },
  ).lean()
  return withAccess(
    content.agency,
    content.client,
    managers.map((m) => m.user),
  )
}

/** D25: who may publish this client's content — Owner/Admin, plus anyone with `canPublish` and access. */
export async function publishers(content: ContentLike) {
  const members = await MembershipModel.find(
    { agency: content.agency, status: 'active', $or: [{ role: { $in: ['owner', 'admin'] } }, { canPublish: true }] },
    { user: 1 },
  ).lean()
  return withAccess(
    content.agency,
    content.client,
    members.map((m) => m.user),
  )
}

/** The client's own people, optionally only some roles. */
export async function clientPeople(client: Types.ObjectId, roles?: ClientRole[]) {
  const rows = await ClientMemberModel.find({ client, status: 'active', ...(roles ? { role: { $in: roles } } : {}) }, { user: 1 }).lean()
  return rows.map((r) => r.user)
}
