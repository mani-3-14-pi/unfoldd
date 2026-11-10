// Creates logins with a password directly, instead of emailing an invitation.
//
//   npm run users                                   list agency team members and client users (add --all to include demo data)
//   npm run users -- agency <email> <password> [role] [agency name]
//        agency team member. role: owner | admin | manager | member (default member). Default agency: the first one.
//   npm run users -- client <email> <password> [role] [client name]
//        client user. role: admin | approver | contributor | viewer (default admin). Default client: the first one.
//   npm run users -- password <email> <password>    set a new password for an existing login
//
// Passwords need at least 10 characters. Running `agency` or `client` for an email that already exists
// keeps that person, sets the new password, and adds or updates the access.
import { connectDb, disconnectDb } from '../config/db.ts'
import { hashPassword } from '../lib/password.ts'
import { AgencyModel } from '../modules/agencies/agency.model.ts'
import { ClientModel } from '../modules/clients/client.model.ts'
import { CLIENT_ROLES, ClientMemberModel, type ClientRole } from '../modules/clients/clientMember.model.ts'
import { MEMBER_ROLES, MembershipModel } from '../modules/users/membership.model.ts'
import { UserModel } from '../modules/users/user.model.ts'

/** Accounts made by `npm run seed:demo`; hidden from the list and never picked as the default agency. */
const DEMO = /@demo\.unfoldd\.test$/

const [command, rawEmail, password, role, placeName] = process.argv.slice(2)

function need(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message)
}

/** Finds the login or creates it, and sets the password either way. */
async function upsertUser(email: string, pw: string) {
  need(pw && pw.length >= 10, 'Password must be at least 10 characters.')
  const passwordHash = await hashPassword(pw)
  const existing = await UserModel.findOne({ email })
  if (existing) {
    existing.passwordHash = passwordHash
    await existing.save()
    return existing
  }
  return UserModel.create({ name: email.split('@')[0], email, passwordHash })
}

await connectDb()
try {
  const email = rawEmail?.toLowerCase().trim()

  if (command === 'agency') {
    need(email, 'Usage: agency <email> <password> [role] [agency name]')
    const r = (role ?? 'member') as (typeof MEMBER_ROLES)[number]
    need(MEMBER_ROLES.includes(r), `Role must be one of: ${MEMBER_ROLES.join(', ')}`)
    const agency = placeName ? await AgencyModel.findOne({ name: placeName }) : await AgencyModel.findOne({ status: 'active', email: { $not: DEMO } }).sort({ createdAt: -1 })
    need(agency, placeName ? `No agency named ${placeName}` : 'No active agency exists.')
    const user = await upsertUser(email, password)
    await MembershipModel.updateOne({ agency: agency._id, user: user._id }, { $set: { role: r, status: 'active' } }, { upsert: true })
    console.log(`${user.email} can now log in to ${agency.name} as ${r}.`)
  } else if (command === 'client') {
    need(email, 'Usage: client <email> <password> [role] [client name]')
    const r = (role ?? 'admin') as ClientRole
    need(CLIENT_ROLES.includes(r), `Role must be one of: ${CLIENT_ROLES.join(', ')}`)
    const client = placeName
      ? await ClientModel.findOne({ name: placeName, deletedAt: null })
      : await ClientModel.findOne({ deletedAt: null }).sort({ createdAt: 1 })
    need(client, placeName ? `No client named ${placeName}` : 'No clients exist yet. Create one in the agency portal first.')
    const user = await upsertUser(email, password)
    await ClientMemberModel.updateOne({ agency: client.agency, client: client._id, user: user._id }, { $set: { role: r, status: 'active' } }, { upsert: true })
    console.log(`${user.email} can now log in to ${client.name} as ${r}.`)
  } else if (command === 'password') {
    need(email, 'Usage: password <email> <password>')
    const user = await UserModel.findOne({ email })
    need(user, `No login with email ${email}`)
    need(password && password.length >= 10, 'Password must be at least 10 characters.')
    user.passwordHash = await hashPassword(password)
    await user.save()
    console.log(`Password set for ${user.email}.`)
  } else {
    const [memberships, clientMembers] = await Promise.all([MembershipModel.find().lean(), ClientMemberModel.find().lean()])
    const [users, agencies, clients] = await Promise.all([
      UserModel.find({ _id: { $in: [...memberships.map((m) => m.user), ...clientMembers.map((m) => m.user)] } }, { email: 1 }).lean(),
      AgencyModel.find({ _id: { $in: memberships.map((m) => m.agency) } }, { name: 1 }).lean(),
      ClientModel.find({ _id: { $in: clientMembers.map((m) => m.client) } }, { name: 1, deletedAt: 1 }).lean(),
    ])
    const emailOf = (id: unknown) => users.find((u) => String(u._id) === String(id))?.email ?? '?'
    const showAll = command === '--all'
    const rows = [
      ...memberships.map((m) => ({ type: 'agency', email: emailOf(m.user), place: agencies.find((a) => String(a._id) === String(m.agency))?.name ?? '?', role: m.role, status: m.status })),
      ...clientMembers.map((m) => {
        const c = clients.find((x) => String(x._id) === String(m.client))
        return { type: 'client', email: emailOf(m.user), place: c ? `${c.name}${c.deletedAt ? ' (deleted)' : ''}` : '?', role: m.role, status: m.status }
      }),
    ].filter((r) => showAll || !DEMO.test(r.email))
    if (rows.length) console.table(rows)
    else console.log('No logins yet.')
  }
} finally {
  await disconnectDb()
}
