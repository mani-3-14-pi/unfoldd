import { randomBytes, scryptSync } from 'node:crypto'
import { expect, test, type Browser, type Page } from '@playwright/test'
import { api, signUpOwner, unique, watchErrors, withDb } from '../helpers'

// Agency onboarding, the platform admin and agency sign-in, clicked through in the browser.
//
// The test server approves new agencies at once so the other files' signUpOwner() is quick. The first test here
// turns auto-approve (and signups) off from the admin Settings page for a few seconds. It's race-free for the
// other files because signUpOwner() approves a signup that came back pending and retries a closed signup page,
// and the tests here that change platform settings run one after another (serial) and put them back afterwards.

const PASSWORD = 'correct-horse-battery'

/** A platform admin straight in the database, hashed like backend/src/lib/password.ts. */
async function createPlatformAdmin() {
  const username = `admin-${unique()}`
  const password = 'admin-password-123'
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 })
  await withDb((db) =>
    db.collection('platformadmins').insertOne({
      username,
      name: 'Pat Platform',
      passwordHash: `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`,
      status: 'active',
      twoFactor: { enabledAt: null, lastStep: null },
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  )
  return { username, password }
}

/** A fresh browser with a platform admin signed in at /admin/login. */
async function adminPage(browser: Browser) {
  const { username, password } = await createPlatformAdmin()
  const page = await (await browser.newContext()).newPage()
  await page.goto('/admin/login')
  await page.fill('#admin-username', username)
  await page.fill('#admin-password', password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.waitForURL('**/admin')
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
  return page
}

/** Fills the agency login form and submits it. */
async function logIn(page: Page, email: string, password = PASSWORD) {
  await page.goto('/login')
  await page.fill('#login-email', email)
  await page.fill('#login-password', password)
  await page.getByRole('button', { name: 'Log in' }).click()
}

const toast = (page: Page, text: string | RegExp) => page.getByRole('status').filter({ hasText: text })

/** Turns a platform setting switch to `on` and saves, from the admin Settings page. */
async function setSwitch(page: Page, label: string, on: boolean) {
  await page.goto('/admin/settings')
  const sw = page.getByRole('switch', { name: label })
  if ((await sw.getAttribute('aria-checked')) !== String(on)) {
    await sw.click()
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(toast(page, 'Settings saved')).toBeVisible()
  }
  await expect(sw).toHaveAttribute('aria-checked', String(on))
}

/** Puts the platform settings back the way e2e/server.mjs set them. */
const restoreSettings = () =>
  withDb((db) =>
    db.collection('settings').updateOne({ key: 'platform' }, { $set: { signups: { enabled: true, autoApprove: true }, supportSessionMinutes: 60 } }),
  )

/** Signs up through the form with auto-approve off: the "waiting for approval" screen. */
async function signUpPending(browser: Browser, label: string) {
  const id = unique()
  const email = `${label}-${id}@e2e.test`
  const agencyName = `${label === 'approve' ? 'Bright' : 'Gloomy'} Studio ${id}`
  const page = await (await browser.newContext()).newPage()
  await page.goto('/signup')
  await page.fill('#su-name', 'Nia Newcomer')
  await page.fill('#su-email', email)
  await page.fill('#su-agency', agencyName)
  await page.fill('#su-country', 'India')
  await page.selectOption('#su-team', '6-15')
  await page.fill('#su-password', PASSWORD)
  await page.getByRole('button', { name: 'Create agency' }).click()
  await expect(page.getByRole('heading', { name: 'Thanks, we’ve got it' })).toBeVisible()
  await expect(page.getByText(agencyName)).toBeVisible()
  return { page, email, agencyName }
}

test.describe.serial('platform settings', () => {
  test.afterAll(restoreSettings)

  test('signup with auto-approve off waits for approval; admin approves one and rejects another', async ({ browser }) => {
    test.setTimeout(180_000)
    const admin = await adminPage(browser)
    const done = watchErrors(admin)

    // Auto-approve off for just the two signups, then straight back on.
    let a!: Awaited<ReturnType<typeof signUpPending>>, b!: typeof a
    try {
      await setSwitch(admin, 'Auto-approve new agencies', false)
      a = await signUpPending(browser, 'approve')
      b = await signUpPending(browser, 'reject')
    } finally {
      await setSwitch(admin, 'Auto-approve new agencies', true)
    }
    const doneA = watchErrors(a.page)

    // Logging in before approval explains why.
    await a.page.getByRole('link', { name: 'Back to log in' }).click()
    await logIn(a.page, a.email)
    await expect(a.page.getByText('Your agency is waiting for approval.')).toBeVisible()
    expect(new URL(a.page.url()).pathname).toBe('/login')

    // Both wait in Approvals (and on the Overview).
    await admin.goto('/admin')
    await expect(admin.getByRole('link', { name: a.agencyName })).toBeVisible()
    await admin.getByRole('link', { name: 'Approvals' }).click()
    await expect(admin.getByRole('heading', { name: 'Approvals' })).toBeVisible()
    await admin.getByLabel('Search agencies, owners, emails…').fill(a.agencyName.split(' ').pop()!)
    const rowA = admin.getByRole('row', { name: new RegExp(a.agencyName) })
    await expect(rowA).toBeVisible()
    await expect(rowA).toContainText('6-15')
    await rowA.getByRole('button', { name: 'Approve' }).click()
    await admin.getByRole('dialog').getByRole('button', { name: 'Approve agency' }).click()
    await expect(toast(admin, `${a.agencyName} approved`)).toBeVisible()
    await expect(rowA).toHaveCount(0)

    // Reject needs a reason, which the agency then sees.
    await admin.getByLabel('Search agencies, owners, emails…').fill(b.agencyName.split(' ').pop()!)
    const rowB = admin.getByRole('row', { name: new RegExp(b.agencyName) })
    await rowB.getByRole('button', { name: 'Reject' }).click()
    const dialog = admin.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Reject signup' }).click()
    await expect(dialog.getByText('Add a reason')).toBeVisible()
    await dialog.getByLabel('Reason').fill('Not a creative agency')
    await dialog.getByRole('button', { name: 'Reject signup' }).click()
    await expect(toast(admin, `${b.agencyName} rejected`)).toBeVisible()
    await expect(rowB).toHaveCount(0)

    // The approved owner lands in their own workspace.
    await logIn(a.page, a.email)
    await a.page.waitForURL('**/app')
    await expect(a.page.getByRole('heading', { name: 'Welcome, Nia' })).toBeVisible()
    await expect(a.page.locator('main').getByText(a.agencyName, { exact: true })).toBeVisible()
    await expect(a.page.getByText('Something went wrong on this page')).toHaveCount(0)

    // The rejected one is told why.
    await b.page.getByRole('link', { name: 'Back to log in' }).click()
    await logIn(b.page, b.email)
    await expect(b.page.getByText('Your agency’s signup wasn’t approved.')).toBeVisible()
    await expect(b.page.getByText('Reason: Not a creative agency')).toBeVisible()

    // The audit trail has both decisions.
    await admin.goto('/admin/activity')
    await expect(admin.getByText(`approved ${a.agencyName}`).first()).toBeVisible()
    await expect(admin.getByText(`rejected ${b.agencyName}: Not a creative agency`).first()).toBeVisible()
    doneA()
    done()
  })

  test('settings: close signups, change the support session length', async ({ browser }) => {
    const admin = await adminPage(browser)
    const done = watchErrors(admin)
    const visitor = await (await browser.newContext()).newPage()

    try {
      await setSwitch(admin, 'Accept new signups', false)
      // Auto-approve only applies while signups are open.
      await expect(admin.getByRole('switch', { name: 'Auto-approve new agencies' })).toBeDisabled()
      await visitor.goto('/signup')
      await expect(visitor.getByRole('heading', { name: 'Signups are closed' })).toBeVisible()
    } finally {
      await setSwitch(admin, 'Accept new signups', true)
    }
    await visitor.reload()
    await expect(visitor.getByRole('heading', { name: 'Create your agency' })).toBeVisible()

    // Discard puts unsaved changes back.
    await admin.selectOption('#support-minutes', '30')
    await admin.getByRole('button', { name: 'Discard' }).click()
    await expect(admin.locator('#support-minutes')).toHaveValue('60')

    await admin.selectOption('#support-minutes', '120')
    await admin.getByRole('button', { name: 'Save changes' }).click()
    await expect(toast(admin, 'Settings saved')).toBeVisible()
    await admin.reload()
    await expect(admin.locator('#support-minutes')).toHaveValue('120')
    await admin.selectOption('#support-minutes', '60')
    await admin.getByRole('button', { name: 'Save changes' }).click()
    await expect(toast(admin, 'Settings saved')).toBeVisible()

    await admin.goto('/admin/activity')
    await expect(admin.getByText(/updated platform settings: signups closed/).first()).toBeVisible()
    done()
  })
})

test('admin: agencies list, suspend and reactivate, agency detail, subscription, support view', async ({ browser, page }) => {
  test.setTimeout(180_000)
  const doneOwner = watchErrors(page)
  const { email, agencyName } = await signUpOwner(page)
  const admin = await adminPage(browser)
  const done = watchErrors(admin)
  const key = agencyName.split(' ').pop()!

  // Agencies: search, a status tab, a sort.
  await admin.getByRole('link', { name: 'Agencies' }).click()
  await expect(admin.getByRole('heading', { name: 'Agencies' })).toBeVisible()
  await admin.getByLabel('Search agencies, owners, emails…').fill(key)
  const row = admin.getByRole('row', { name: new RegExp(agencyName) })
  await expect(row).toBeVisible()
  await expect(row).toContainText('Active')
  await admin.getByRole('tab', { name: /^Suspended/ }).click()
  await expect(row).toHaveCount(0)
  await admin.getByRole('tab', { name: /^Active/ }).click()
  await expect(row).toBeVisible()
  await admin.getByRole('button', { name: /^Sort:/ }).click()
  await admin.getByRole('menuitem', { name: 'Name A–Z' }).click()
  await expect(admin).toHaveURL(/sort=name/)
  await expect(row).toBeVisible()

  // Suspend from the row menu: the owner is signed out and can't log back in.
  await row.getByRole('button', { name: `Actions for ${agencyName}` }).click()
  await admin.getByRole('menuitem', { name: 'Suspend' }).click()
  await admin.getByRole('dialog').getByLabel('Reason').fill('Payment overdue')
  await admin.getByRole('dialog').getByRole('button', { name: 'Suspend agency' }).click()
  await expect(toast(admin, `${agencyName} suspended`)).toBeVisible()
  await page.goto('/app/clients')
  await page.waitForURL('**/login**')
  await logIn(page, email)
  await expect(page.getByText('Your agency’s account is suspended.')).toBeVisible()
  await expect(page.getByText('Reason: Payment overdue')).toBeVisible()

  // Reactivate: they're back in.
  await admin.getByRole('tab', { name: /^Suspended/ }).click()
  await row.getByRole('button', { name: `Actions for ${agencyName}` }).click()
  await admin.getByRole('menuitem', { name: 'Reactivate' }).click()
  await admin.getByRole('dialog').getByRole('button', { name: 'Reactivate agency' }).click()
  await expect(toast(admin, `${agencyName} reactivated`)).toBeVisible()
  await logIn(page, email)
  await page.waitForURL('**/app')

  // Agency detail: overview, members, subscription, activity.
  await admin.getByRole('tab', { name: /^All agencies/ }).click()
  await row.getByRole('link', { name: agencyName }).click()
  await expect(admin.getByRole('heading', { name: agencyName })).toBeVisible()
  await expect(admin.getByText('Asha Owner').first()).toBeVisible()
  await admin.getByRole('navigation', { name: 'Agency sections' }).getByRole('link', { name: /Members/ }).click()
  await expect(admin.getByRole('row', { name: /Asha Owner/ })).toContainText('Owner')

  await admin.getByRole('navigation', { name: 'Agency sections' }).getByRole('link', { name: 'Subscription' }).click()
  await admin.getByRole('button', { name: 'Edit' }).click()
  const sub = admin.getByRole('dialog', { name: 'Edit subscription' })
  await sub.getByLabel('Plan').selectOption('growth')
  await sub.getByLabel('Status').selectOption('active')
  await sub.getByLabel('Seats').fill('12')
  await sub.getByLabel('Internal notes').fill('Annual deal')
  await sub.getByRole('button', { name: 'Save subscription' }).click()
  await expect(toast(admin, `Updated ${agencyName}’s subscription`)).toBeVisible()
  await expect(sub).toHaveCount(0)
  await expect(admin.getByText('Growth')).toBeVisible()
  await expect(admin.getByText('12 (1 in use)')).toBeVisible()
  await expect(admin.getByText('Annual deal')).toBeVisible()

  await admin.getByRole('navigation', { name: 'Agency sections' }).getByRole('link', { name: 'Activity' }).click()
  await expect(admin.getByText(`suspended ${agencyName}: Payment overdue`).first()).toBeVisible()
  await admin.getByText(`updated ${agencyName}’s subscription`).first().click()
  await expect(admin.getByRole('dialog')).toContainText('agency.subscription_updated')
  await admin.getByRole('dialog').getByRole('button', { name: 'Close' }).first().click()

  // Subscriptions page: the new plan, filtered, and editable from the row.
  await admin.getByRole('link', { name: 'Subscriptions' }).click()
  await admin.getByLabel('Search agencies…').fill(key)
  const subRow = admin.getByRole('row', { name: new RegExp(agencyName) })
  await expect(subRow).toContainText('Growth')
  await subRow.getByRole('button', { name: `Edit ${agencyName}’s subscription` }).click()
  await admin.getByRole('dialog').getByLabel('Seats').fill('15')
  await admin.getByRole('dialog').getByRole('button', { name: 'Save subscription' }).click()
  await expect(subRow).toContainText('15')

  // Support view: opens the portal in a new tab with a banner; exiting ends it.
  await admin.goto('/admin/agencies')
  await admin.getByLabel('Search agencies, owners, emails…').fill(key)
  await row.getByRole('link', { name: agencyName }).click()
  await admin.getByRole('button', { name: 'Open admin portal' }).click()
  const [tab] = await Promise.all([
    admin.context().waitForEvent('page'),
    admin.getByRole('dialog').getByRole('button', { name: 'Open support view' }).click(),
  ])
  const doneTab = watchErrors(tab)
  await tab.waitForURL('**/app')
  const banner = tab.getByRole('status').filter({ hasText: 'Support view.' })
  await expect(banner).toContainText(`Pat Platform is signed in to ${agencyName} as Asha Owner`)
  await expect(tab.getByRole('heading', { name: 'Welcome, Asha' })).toBeVisible()
  const closed = tab.waitForEvent('close')
  await banner.getByRole('button', { name: 'Exit support view' }).click()
  await closed
  // The admin's own session is untouched, and the support view is logged.
  await admin.goto('/admin/activity')
  await expect(admin.getByText(`left the support view of ${agencyName}`).first()).toBeVisible()
  await expect(admin.getByText(`opened ${agencyName}’s admin portal`).first()).toBeVisible()

  doneTab()
  doneOwner()
  done()
})

test('admin: answer a support ticket, reset a member’s two-factor sign-in', async ({ browser, page }) => {
  test.setTimeout(150_000)
  const doneOwner = watchErrors(page)
  const { email, agencyName } = await signUpOwner(page)
  const subject = `Upload stuck ${unique()}`
  const { ticket } = await api(page, 'POST', '/support/tickets', { category: 'bug', subject, message: 'The progress bar stops at 90%' })
  const admin = await adminPage(browser)
  const done = watchErrors(admin)

  // Support inbox: find the ticket, reply, change its status.
  await admin.getByRole('navigation').getByRole('link', { name: /^Support/ }).click()
  await expect(admin.getByRole('heading', { name: 'Support', exact: true })).toBeVisible()
  await admin.getByLabel('Search subjects, names, emails…').fill(subject)
  await admin.getByRole('button', { name: new RegExp(subject) }).click()
  const thread = admin.locator('main')
  await expect(thread.getByText('The progress bar stops at 90%')).toBeVisible()
  await expect(thread.getByRole('link', { name: agencyName })).toBeVisible()
  await thread.getByLabel('Reply').fill('Try a smaller file while we look.')
  await thread.getByRole('button', { name: 'Send reply' }).click()
  await expect(toast(admin, 'Reply sent')).toBeVisible()
  await expect(thread.getByText('Pat Platform · Unfoldd support')).toBeVisible()
  await thread.getByLabel('Ticket status').selectOption('in_progress')
  await expect(toast(admin, 'Marked in progress')).toBeVisible()
  // The agency sees the reply and the new status, and got it by email.
  const mine = await api(page, 'GET', `/support/tickets/${ticket._id}`)
  expect(mine.ticket).toMatchObject({ status: 'in_progress', messages: [{ from: 'user' }, { from: 'support', body: 'Try a smaller file while we look.' }] })
  expect(await withDb((db) => db.collection('outboxemails').countDocuments({ to: email, subject: `Re: ${subject}` }))).toBe(1)

  // Reset 2FA from the agency's Members tab (set up in the database: 2FA is off in these tests).
  await withDb((db) => db.collection('users').updateOne({ email }, { $set: { 'twoFactor.enabledAt': new Date() } }))
  await admin.getByRole('navigation').getByRole('link', { name: 'Agencies', exact: true }).click()
  await admin.getByLabel('Search agencies, owners, emails…').fill(agencyName.split(' ').pop()!)
  await admin.getByRole('row', { name: new RegExp(agencyName) }).getByRole('link', { name: agencyName }).click()
  await admin.getByRole('navigation', { name: 'Agency sections' }).getByRole('link', { name: /Members/ }).click()
  const member = admin.getByRole('row', { name: /Asha Owner/ })
  await expect(member).toContainText('On')
  await member.getByRole('button', { name: 'Actions for Asha Owner' }).click()
  await admin.getByRole('menuitem', { name: 'Reset two-factor sign-in' }).click()
  await admin.getByRole('dialog').getByRole('button', { name: 'Reset two-factor' }).click()
  await expect(toast(admin, 'Two-factor sign-in reset for Asha Owner')).toBeVisible()
  await expect(member).toContainText('Not set up')
  // They're signed out everywhere.
  await page.goto('/app/clients')
  await page.waitForURL('**/login**')
  doneOwner()
  done()
})

test('admin: sign-in errors and log out', async ({ page }) => {
  const done = watchErrors(page)
  const { username, password } = await createPlatformAdmin()
  await page.goto('/admin')
  await page.waitForURL('**/admin/login')
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByText('Enter your username')).toBeVisible()
  await page.fill('#admin-username', username)
  await page.fill('#admin-password', 'not-the-password')
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByText('That username and password don’t match.')).toBeVisible()
  await page.fill('#admin-password', password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.waitForURL('**/admin')

  for (const [link, heading] of [
    ['Agencies', 'Agencies'],
    ['Approvals', 'Approvals'],
    ['Subscriptions', 'Subscriptions'],
    ['Activity log', 'Activity log'],
    ['Settings', 'Settings'],
    ['Overview', 'Overview'],
  ]) {
    await page.getByRole('navigation').getByRole('link', { name: link, exact: true }).first().click()
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
  }

  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('menuitem', { name: 'Log out' }).click()
  await page.waitForURL('**/admin/login')
  await page.goto('/admin/agencies')
  await page.waitForURL('**/admin/login?next=*')
  done()
})

test('agency sign-in: wrong password, log out, change password, switch agency', async ({ page, browser }) => {
  test.setTimeout(150_000)
  const done = watchErrors(page)
  const { email, agencyName } = await signUpOwner(page)

  // Log out from the account menu.
  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('menuitem', { name: 'Log out' }).click()
  await page.waitForURL('**/login')
  await page.goto('/app')
  await page.waitForURL('**/login')

  // A wrong password says so; the right one gets back in.
  await logIn(page, email, 'wrong-password-1')
  await expect(page.getByText('That email and password don’t match.')).toBeVisible()
  await page.fill('#login-password', PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.waitForURL('**/app')

  // Change the password on Your account.
  await page.goto('/app/account')
  await page.fill('#pw-current', 'not-my-password')
  await page.fill('#pw-new', 'brand-new-password-9')
  await page.fill('#pw-confirm', 'brand-new-password-9')
  await page.getByRole('button', { name: 'Change password' }).click()
  await expect(page.getByText('That’s not your current password')).toBeVisible()
  await page.fill('#pw-current', PASSWORD)
  await page.fill('#pw-confirm', 'something-else-entirely')
  await page.getByRole('button', { name: 'Change password' }).click()
  await expect(page.getByText('Passwords don’t match')).toBeVisible()
  await page.fill('#pw-confirm', 'brand-new-password-9')
  await page.getByRole('button', { name: 'Change password' }).click()
  await expect(toast(page, 'Password changed')).toBeVisible()

  // Still signed in here; the new password works after logging out and the old one doesn't.
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible()
  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('menuitem', { name: 'Log out' }).click()
  await page.waitForURL('**/login')
  await logIn(page, email, PASSWORD)
  await expect(page.getByText('That email and password don’t match.')).toBeVisible()
  await logIn(page, email, 'brand-new-password-9')
  await page.waitForURL('**/app')

  // A second agency for the same person (as if they'd accepted an invite to it): the switcher appears.
  const other = await (await browser.newContext()).newPage()
  const second = await signUpOwner(other)
  await withDb(async (db) => {
    const user = await db.collection('users').findOne({ email })
    const agency = await db.collection('agencies').findOne({ email: second.email })
    await db.collection('memberships').insertOne({
      agency: agency!._id,
      user: user!._id,
      role: 'manager',
      status: 'active',
      canPublish: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  })
  await page.reload()
  await page.getByRole('button', { name: /Switch workspace/ }).click()
  await page.getByRole('menuitem', { name: new RegExp(second.agencyName) }).click()
  await expect(page.getByRole('button', { name: new RegExp(`${second.agencyName}.*Switch workspace`) })).toBeVisible()
  await expect(page.locator('main').getByText(second.agencyName, { exact: true })).toBeVisible()
  expect((await page.request.get('/api/auth/me').then((r) => r.json())).role).toBe('manager')

  // And back.
  await page.getByRole('button', { name: /Switch workspace/ }).click()
  await page.getByRole('menuitem', { name: new RegExp(agencyName) }).click()
  await expect(page.locator('main').getByText(agencyName, { exact: true })).toBeVisible()
  done()
})
