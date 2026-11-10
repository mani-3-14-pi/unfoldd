import { expect, test, type Page } from '@playwright/test'
import { api, CLIENT_APP, signUpOwner, unique, WEB, watchErrors, withDb } from '../helpers'

// Every invite button, clicked in the browser: the frontend sends the request, the backend saves the
// invitation and queues the email, and the link in that email lets the person in.
// The test backend uses the dev mailer, so the email is read from the outbox instead of an inbox.

/** The invite email sent to `email`: waits for it, checks the subject, returns the link in it. */
async function inviteEmail(email: string) {
  for (let i = 0; i < 40; i++) {
    const mail = await withDb((db) => db.collection('outboxemails').find({ to: email }).sort({ _id: -1 }).limit(1).next())
    const link = mail?.text.match(/https?:\/\/\S+\/invite\/[A-Za-z0-9_-]+/)?.[0]
    if (mail && link) {
      expect(mail.kind).toBe('invitation')
      expect(mail.subject).toContain('invited you to')
      return { link, token: link.split('/invite/')[1], status: mail.status as string }
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`No invitation email for ${email}`)
}

/** Fills and sends the shared invite dialog, and waits for the success toast. */
async function sendInvite(page: Page, email: string, role: string) {
  await page.fill('#invite-email', email)
  await page.locator('label', { hasText: new RegExp(`^${role}`) }).click()
  const request = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/invitations'))
  const response = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/invitations'))
  await page.getByRole('button', { name: 'Send invitation' }).click()
  // The frontend really sent it, with the role picked in the dialog, and the backend created it.
  expect((await request).postDataJSON()).toMatchObject({ email, role: role.toLowerCase() })
  expect((await response).status()).toBe(201)
  await expect(page.getByText(`Invitation sent to ${email}`)).toBeVisible()
}

test('agency team member: invite from Team, email sent, accept the link', async ({ page, browser }) => {
  const done = watchErrors(page)
  await signUpOwner(page)
  const email = `member-${unique()}@e2e.test`

  await page.goto('/app/team')
  await page.getByRole('button', { name: 'Invite people' }).click()
  await sendInvite(page, email, 'Member')

  const mail = await inviteEmail(email)
  expect(mail.link.startsWith(`${WEB}/invite/`)).toBeTruthy()

  // The invited person opens the link in their own browser, creates the account and lands in the portal.
  const them = await (await browser.newContext()).newPage()
  await them.goto(`/invite/${mail.token}`)
  await them.fill('#invite-name', 'Ravi Member')
  await them.fill('#invite-password', 'member-pass-123')
  await them.getByRole('button', { name: 'Accept and create account' }).click()
  await them.waitForURL('**/app')
  const me = await api(them, 'GET', '/auth/me')
  expect(me).toMatchObject({ context: 'agency', role: 'member', user: { email } })
  done()
})

test('agency manager: invite from Team, email sent, accept the link', async ({ page, browser }) => {
  const done = watchErrors(page)
  await signUpOwner(page)
  const email = `manager-${unique()}@e2e.test`

  await page.goto('/app/team')
  await page.getByRole('button', { name: 'Invite people' }).click()
  await sendInvite(page, email, 'Manager')

  const mail = await inviteEmail(email)
  const them = await (await browser.newContext()).newPage()
  await them.goto(`/invite/${mail.token}`)
  await them.fill('#invite-name', 'Meera Manager')
  await them.fill('#invite-password', 'manager-pass-123')
  await them.getByRole('button', { name: 'Accept and create account' }).click()
  await them.waitForURL('**/app')
  expect(await api(them, 'GET', '/auth/me')).toMatchObject({ context: 'agency', role: 'manager', user: { email } })
  done()
})

test('client people: agency invites a client admin, who registers in the client app and invites a colleague', async ({ page, browser }) => {
  const done = watchErrors(page)
  await signUpOwner(page)
  const { client } = await api(page, 'POST', '/clients', { name: 'Velvet Oven Foods', brandName: 'Velvet Oven', timezone: 'Asia/Kolkata' })

  // 1. Agency → client: the client's People tab.
  const adminEmail = `client-admin-${unique()}@e2e.test`
  await page.goto(`/app/clients/${client._id}/members`)
  await page.getByRole('button', { name: /Invite (their first admin|client)/ }).first().click()
  await sendInvite(page, adminEmail, 'Admin')

  // Client invite links open the client app.
  const mail = await inviteEmail(adminEmail)
  expect(mail.link.startsWith(`${CLIENT_APP}/invite/`)).toBeTruthy()

  // 2. The client registers from the link in the client app.
  const context = await browser.newContext()
  const them = await context.newPage()
  await them.goto(mail.link)
  await expect(them.getByText('invited you to')).toBeVisible()
  await them.fill('#reg-name', 'Priya Client')
  await them.fill('#reg-password', 'client-pass-123')
  await them.fill('#reg-confirm', 'client-pass-123')
  await them.getByRole('button', { name: 'Create account' }).click()
  await expect(them.getByRole('button', { name: 'Sign out' })).toBeVisible()
  await expect(them.getByText('Velvet Oven')).toBeVisible()

  // 3. Client admin → colleague: People in the client portal. Cookies ignore the port, so the session carries over.
  const colleagueEmail = `colleague-${unique()}@e2e.test`
  await them.goto(`${WEB}/c/people`)
  await them.getByRole('button', { name: 'Invite', exact: true }).click()
  await sendInvite(them, colleagueEmail, 'Contributor')
  const colleagueMail = await inviteEmail(colleagueEmail)
  expect(colleagueMail.link.startsWith(`${CLIENT_APP}/invite/`)).toBeTruthy()

  // 4. The colleague registers too, then signs out and back in with the password they chose.
  const colleague = await (await browser.newContext()).newPage()
  await colleague.goto(colleagueMail.link)
  await colleague.fill('#reg-name', 'Kabir Colleague')
  await colleague.fill('#reg-password', 'colleague-pass-123')
  await colleague.fill('#reg-confirm', 'colleague-pass-123')
  await colleague.getByRole('button', { name: 'Create account' }).click()
  await colleague.getByRole('button', { name: 'Sign out' }).click()
  await colleague.fill('#email', colleagueEmail)
  await colleague.fill('#password', 'colleague-pass-123')
  await colleague.getByRole('button', { name: 'Sign in' }).click()
  await expect(colleague.getByRole('button', { name: 'Sign out' })).toBeVisible()
  expect(await api(colleague, 'GET', '/auth/me')).toMatchObject({ context: 'client', role: 'contributor', user: { email: colleagueEmail } })
  done()
})
