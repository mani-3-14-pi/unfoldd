import type { Types } from 'mongoose'
import { AgencyModel } from '../agencies/agency.model.ts'
import { ClientMemberModel } from '../clients/clientMember.model.ts'
import { ClientModel } from '../clients/client.model.ts'
import { MembershipModel } from '../users/membership.model.ts'

/**
 * Where one login can go (D43): its active agency memberships and client memberships,
 * in agencies that are active. Used by login, `/me` and the switchers.
 */
export interface AgencyContext {
  agencyId: Types.ObjectId
  name: string
  role: string
}
export interface ClientContext {
  clientId: Types.ObjectId
  agencyId: Types.ObjectId
  brandName: string
  name: string
  agencyName: string
  role: string
  status: string
}

export async function listContexts(user: Types.ObjectId): Promise<{ agencies: AgencyContext[]; clients: ClientContext[] }> {
  const [memberships, clientMembers] = await Promise.all([
    MembershipModel.find({ user, status: 'active' }).sort({ createdAt: 1 }).lean(),
    ClientMemberModel.find({ user, status: 'active' }).sort({ createdAt: 1 }).lean(),
  ])
  const agencyIds = [...memberships.map((m) => m.agency), ...clientMembers.map((c) => c.agency)]
  const [agencies, clients] = await Promise.all([
    AgencyModel.find({ _id: { $in: agencyIds }, status: 'active' }, { name: 1, slug: 1, logo: 1 }).lean(),
    ClientModel.find({ _id: { $in: clientMembers.map((c) => c.client) }, deletedAt: null }, { name: 1, brandName: 1, logo: 1, status: 1, agency: 1 }).lean(),
  ])
  const agencyById = new Map(agencies.map((a) => [String(a._id), a]))

  return {
    agencies: memberships
      .filter((m) => agencyById.has(String(m.agency)))
      .map((m) => ({ agencyId: m.agency, name: agencyById.get(String(m.agency))!.name, role: m.role })),
    clients: clientMembers.flatMap((m) => {
      const client = clients.find((c) => String(c._id) === String(m.client))
      const agency = client && agencyById.get(String(client.agency))
      if (!client || !agency) return []
      return [{ clientId: client._id, agencyId: agency._id, brandName: client.brandName, name: client.name, agencyName: agency.name, role: m.role, status: client.status }]
    }),
  }
}
