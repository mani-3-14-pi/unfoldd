// Creates the first platform (super) admin and the platform settings document.
//   npm run seed                      create the admin from SEED_SUPERADMIN_* if it doesn't exist
//   npm run seed -- --reset-password  also reset that admin's password to SEED_SUPERADMIN_PASSWORD
import { connectDb, disconnectDb } from '../config/db.ts'
import { hashPassword } from '../lib/password.ts'
import { PlatformAdminModel } from '../modules/platform-admins/platformAdmin.model.ts'
import { getSettings } from '../modules/settings/settings.model.ts'

const username = process.env.SEED_SUPERADMIN_USERNAME?.trim().toLowerCase()
const password = process.env.SEED_SUPERADMIN_PASSWORD
const name = process.env.SEED_SUPERADMIN_NAME?.trim() || 'Platform Admin'

if (!username || !password) {
  console.error('Set SEED_SUPERADMIN_USERNAME and SEED_SUPERADMIN_PASSWORD in backend/.env first.')
  process.exit(1)
}
if (password.length < 10) {
  console.error('SEED_SUPERADMIN_PASSWORD must be at least 10 characters.')
  process.exit(1)
}

await connectDb()
await getSettings()

const existing = await PlatformAdminModel.findOne({ username })
if (!existing) {
  await PlatformAdminModel.create({ username, name, passwordHash: await hashPassword(password) })
  console.log(`Created platform admin “${username}”.`)
} else if (process.argv.includes('--reset-password')) {
  existing.passwordHash = await hashPassword(password)
  existing.status = 'active'
  await existing.save()
  console.log(`Reset the password for platform admin “${username}”.`)
} else {
  console.log(`Platform admin “${username}” already exists; nothing changed. Use --reset-password to reset it.`)
}

await disconnectDb()
