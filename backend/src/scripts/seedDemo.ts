// Fills a development database with demo agencies so lists, filters and pagination have something to show.
//   npm run seed:demo             add 64 demo agencies (skips if they already exist)
//   npm run seed:demo -- --clear  remove every demo agency, its people and its activity
// Demo people all use the password "demo-password" and emails ending in @demo.unfoldd.test.
import { Types } from 'mongoose'
import { connectDb, disconnectDb } from '../config/db.ts'
import { hashPassword } from '../lib/password.ts'
import { ActivityModel } from '../modules/activity/activity.model.ts'
import { PLANS, SUBSCRIPTION_STATUSES, TEAM_SIZES } from '../modules/agencies/agency.constants.ts'
import { AgencyModel } from '../modules/agencies/agency.model.ts'
import { SessionModel } from '../modules/sessions/session.model.ts'
import { MembershipModel } from '../modules/users/membership.model.ts'
import { UserModel } from '../modules/users/user.model.ts'

const DOMAIN = '@demo.unfoldd.test'
const DAY = 86_400_000

const prefixes = ['Velvet', 'North', 'Bright', 'Paper', 'Copper', 'Studio', 'Maple', 'Orbit', 'Lumen', 'Kite', 'Saffron', 'Indigo', 'Juniper', 'Echo', 'Atlas', 'Fable']
const suffixes = ['Creative', 'Media', 'Collective', 'Social', 'Labs', 'Studio', 'Digital', 'House']
const firstNames = ['Aarav', 'Priya', 'Rohan', 'Meera', 'Kabir', 'Ananya', 'Ishaan', 'Sara', 'Leo', 'Maya', 'Noah', 'Zara', 'Arjun', 'Tara']
const lastNames = ['Shah', 'Iyer', 'Kapoor', 'Menon', 'Rao', 'Patel', 'Fernandes', 'Khan', 'Bose', 'Singh']
const countries = ['India', 'India', 'India', 'United Arab Emirates', 'Singapore', 'United Kingdom', 'United States']

// Deterministic, so re-running produces the same data.
let seed = 42
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
const pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)]

await connectDb()

const demoUsers = await UserModel.find({ email: { $regex: `${DOMAIN.replace('.', '\\.')}$` } }, { _id: 1 }).lean()
const demoAgencies = await AgencyModel.find({ email: { $regex: `${DOMAIN.replace('.', '\\.')}$` } }, { _id: 1 }).lean()

if (process.argv.includes('--clear')) {
  const agencyIds = demoAgencies.map((a) => a._id)
  await Promise.all([
    ActivityModel.deleteMany({ agency: { $in: agencyIds } }),
    SessionModel.deleteMany({ agency: { $in: agencyIds } }),
    MembershipModel.deleteMany({ agency: { $in: agencyIds } }),
    UserModel.deleteMany({ _id: { $in: demoUsers.map((u) => u._id) } }),
    AgencyModel.deleteMany({ _id: { $in: agencyIds } }),
  ])
  console.log(`Removed ${agencyIds.length} demo agencies and ${demoUsers.length} demo people.`)
} else if (demoAgencies.length) {
  console.log(`${demoAgencies.length} demo agencies already exist. Run with --clear first to recreate them.`)
} else {
  const passwordHash = await hashPassword('demo-password')
  const users = []
  const memberships = []
  const agencies = []
  const activity = []

  for (let i = 0; i < 64; i++) {
    const name = `${prefixes[i % prefixes.length]} ${suffixes[Math.floor(i / prefixes.length) % suffixes.length]}`
    const slug = name.toLowerCase().replace(/\s+/g, '-')
    const createdAt = new Date(Date.now() - Math.floor(rand() * 180) * DAY - Math.floor(rand() * DAY))
    const status = i < 9 ? 'pending' : i < 13 ? 'suspended' : i < 16 ? 'rejected' : 'active'
    const agencyId = new Types.ObjectId()
    const live = status === 'active' || status === 'suspended'
    const plan = live ? pick(PLANS) : 'trial'

    const team = 1 + Math.floor(rand() * 6)
    let ownerId: Types.ObjectId | undefined
    for (let m = 0; m < team; m++) {
      const person = `${pick(firstNames)} ${pick(lastNames)}`
      const userId = new Types.ObjectId()
      ownerId ??= userId
      users.push({
        _id: userId,
        name: person,
        email: `${person.toLowerCase().replace(/\s+/g, '.')}.${i}.${m}${DOMAIN}`,
        passwordHash,
        lastLoginAt: live && rand() > 0.3 ? new Date(Date.now() - Math.floor(rand() * 20) * DAY) : undefined,
        createdAt,
      })
      memberships.push({
        agency: agencyId,
        user: userId,
        role: m === 0 ? 'owner' : m === 1 ? 'admin' : m === 2 ? 'manager' : 'member',
        status: m > 4 ? 'disabled' : 'active',
        createdAt: new Date(createdAt.getTime() + m * DAY),
      })
    }

    const approvedAt = live ? new Date(createdAt.getTime() + DAY) : undefined
    agencies.push({
      _id: agencyId,
      name,
      slug,
      email: users.find((u) => u._id === ownerId)!.email,
      phone: `+91 98${String(10000000 + i * 7919).slice(0, 8)}`,
      website: `https://${slug}.example.com`,
      country: pick(countries),
      teamSize: pick(TEAM_SIZES),
      status,
      statusReason: status === 'suspended' ? 'Payment overdue' : status === 'rejected' ? 'Not an agency' : '',
      statusChangedAt: status === 'pending' ? undefined : approvedAt ?? createdAt,
      approvedAt,
      owner: ownerId,
      subscription: {
        plan,
        status: !live ? 'trialing' : plan === 'trial' ? 'trialing' : pick(SUBSCRIPTION_STATUSES.filter((s) => s !== 'trialing')),
        seats: plan === 'enterprise' ? 50 : plan === 'scale' ? 25 : 5 + Math.floor(rand() * 10),
        startedAt: approvedAt,
        renewsAt: approvedAt ? new Date(Date.now() + Math.floor(rand() * 60 - 10) * DAY) : undefined,
      },
      createdAt,
      updatedAt: createdAt,
    })

    const actor = { type: 'agency_user', id: ownerId, name: users.find((u) => u._id === ownerId)!.name }
    activity.push({ action: 'agency.signup', actor, agency: agencyId, target: { type: 'agency', id: agencyId, label: name }, message: `${name} signed up`, createdAt })
    if (approvedAt) {
      activity.push({
        action: 'agency.approved',
        actor: { type: 'system', name: 'Demo seed' },
        agency: agencyId,
        target: { type: 'agency', id: agencyId, label: name },
        message: `${name} was approved`,
        createdAt: approvedAt,
      })
    }
  }

  await UserModel.insertMany(users)
  await AgencyModel.insertMany(agencies)
  await MembershipModel.insertMany(memberships)
  await ActivityModel.insertMany(activity)
  console.log(`Created ${agencies.length} demo agencies, ${users.length} demo people and ${activity.length} activity entries.`)
}

await disconnectDb()
