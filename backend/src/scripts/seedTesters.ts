// Adds a team and some clients with logins to one agency, for trying every role by hand.
//   npm run seed:testers                  use the agency named "test"
//   npm run seed:testers -- "<agency>"    use another agency
// Safe to re-run: existing people and clients are kept and their passwords reset to PASSWORD.
import { connectDb, disconnectDb } from '../config/db.ts'
import { hashPassword } from '../lib/password.ts'
import { AgencyModel } from '../modules/agencies/agency.model.ts'
import { AgencyAccessModel } from '../modules/clients/agencyAccess.model.ts'
import { ClientMemberModel, type ClientRole } from '../modules/clients/clientMember.model.ts'
import { ClientModel } from '../modules/clients/client.model.ts'
import { MembershipModel, type MemberRole } from '../modules/users/membership.model.ts'
import { UserModel } from '../modules/users/user.model.ts'

const PASSWORD = 'Test@123456'
const agencyName = process.argv[2] ?? 'test'

/** `clients` are the ones a manager or member can see; owner and admin see all of them anyway. */
const team: { name: string; email: string; role: MemberRole; clients: string[] }[] = [
  { name: 'Asha Admin', email: 'admin@test.com', role: 'admin', clients: [] },
  { name: 'Manoj Manager', email: 'manager@test.com', role: 'manager', clients: ['Bloom Cafe', 'Peak Fitness'] },
  { name: 'Meera Member', email: 'member1@test.com', role: 'member', clients: ['Bloom Cafe'] },
  { name: 'Mohan Member', email: 'member2@test.com', role: 'member', clients: ['Peak Fitness'] },
]

const clients: { name: string; people: { name: string; email: string; role: ClientRole }[] }[] = [
  {
    name: 'Bloom Cafe',
    people: [
      { name: 'Bina Bloom', email: 'bloom.admin@test.com', role: 'admin' },
      { name: 'Arun Approver', email: 'bloom.approver@test.com', role: 'approver' },
      { name: 'Chitra Contributor', email: 'bloom.contributor@test.com', role: 'contributor' },
      { name: 'Vikram Viewer', email: 'bloom.viewer@test.com', role: 'viewer' },
    ],
  },
  { name: 'Peak Fitness', people: [{ name: 'Pooja Peak', email: 'peak.admin@test.com', role: 'admin' }] },
  { name: 'Nova Tech', people: [{ name: 'Nikhil Nova', email: 'nova.admin@test.com', role: 'admin' }] },
]

await connectDb()
try {
  const agency = await AgencyModel.findOne({ name: agencyName })
  if (!agency) throw new Error(`No agency named ${agencyName}`)
  const owner = await MembershipModel.findOne({ agency: agency._id, role: 'owner' })
  const passwordHash = await hashPassword(PASSWORD)

  const upsertUser = (name: string, email: string) =>
    UserModel.findOneAndUpdate({ email }, { $set: { passwordHash }, $setOnInsert: { name, email } }, { upsert: true, returnDocument: 'after' })

  const teamUsers = new Map<string, Awaited<ReturnType<typeof upsertUser>>>()
  for (const t of team) {
    const user = await upsertUser(t.name, t.email)
    await MembershipModel.updateOne({ agency: agency._id, user: user._id }, { $set: { role: t.role, status: 'active' } }, { upsert: true })
    teamUsers.set(t.email, user)
  }
  const manager = teamUsers.get('manager@test.com')!

  for (const c of clients) {
    const client =
      (await ClientModel.findOne({ agency: agency._id, name: c.name, deletedAt: null })) ??
      (await ClientModel.create({
        agency: agency._id,
        name: c.name,
        brandName: c.name,
        contact: { name: c.people[0].name, email: c.people[0].email },
        accountManager: manager._id,
        timezone: agency.timezone || 'Asia/Kolkata',
        contract: { ...agency.toObject().clientDefaults },
        status: 'active',
        statusChangedAt: new Date(),
        createdBy: owner?.user,
      }))
    for (const t of team.filter((t) => t.clients.includes(c.name))) {
      const user = teamUsers.get(t.email)!
      await AgencyAccessModel.updateOne({ client: client._id, user: user._id }, { $setOnInsert: { agency: agency._id, client: client._id, user: user._id } }, { upsert: true })
    }
    for (const p of c.people) {
      const user = await upsertUser(p.name, p.email)
      await ClientMemberModel.updateOne({ agency: agency._id, client: client._id, user: user._id }, { $set: { role: p.role, status: 'active' } }, { upsert: true })
    }
  }

  console.log(`Seeded ${agency.name}. Every login below uses the password ${PASSWORD}`)
  console.table([
    ...team.map((t) => ({ app: 'agency', email: t.email, role: t.role, sees: t.clients.join(', ') || 'all clients' })),
    ...clients.flatMap((c) => c.people.map((p) => ({ app: 'client', email: p.email, role: p.role, sees: c.name }))),
  ])
} finally {
  await disconnectDb()
}
