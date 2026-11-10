import { expect, test, type Browser, type Page } from '@playwright/test'
import { api, CLIENT_APP, signUpOwner, unique, watchErrors, withDb } from '../helpers'

// The simple client app (client/): sign in from an invitation, the overview, and filling in Brand DNA.

async function inviteLink(email: string) {
  for (let i = 0; i < 40; i++) {
    const mail = await withDb((db) => db.collection('outboxemails').find({ to: email }).sort({ _id: -1 }).limit(1).next())
    const link = mail?.text.match(/https?:\/\/\S+\/invite\/[A-Za-z0-9_-]+/)?.[0]
    if (link) return link
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`No invitation email for ${email}`)
}

/** Agency invites a client admin, who registers in the client app. Returns their page. */
async function clientAppAdmin(page: Page, browser: Browser) {
  const { client } = await api(page, 'POST', '/clients', { name: 'Velvet Oven Foods', brandName: 'Velvet Oven', timezone: 'Asia/Kolkata' })
  const email = `client-${unique()}@e2e.test`
  await page.goto(`/app/clients/${client._id}/members`)
  await page.getByRole('button', { name: /Invite (their first admin|client)/ }).first().click()
  await page.fill('#invite-email', email)
  await page.locator('label', { hasText: /^Admin/ }).click()
  await page.getByRole('button', { name: 'Send invitation' }).click()
  await expect(page.getByText(`Invitation sent to ${email}`)).toBeVisible()

  const them = await (await browser.newContext()).newPage()
  await them.goto(await inviteLink(email))
  await them.fill('#reg-name', 'Priya Client')
  await them.fill('#reg-password', 'client-pass-123')
  await them.fill('#reg-confirm', 'client-pass-123')
  await them.getByRole('button', { name: 'Create account' }).click()
  await expect(them.getByRole('button', { name: 'Sign out' })).toBeVisible()
  return { them, clientId: client._id as string }
}

test('client app: overview, sections, and the whole Brand DNA filled in', async ({ page, browser }) => {
  const done = watchErrors(page)
  await signUpOwner(page)
  const { them, clientId } = await clientAppAdmin(page, browser)
  const clientDone = watchErrors(them)

  // Home: greeting, the Brand DNA prompt, and empty lists.
  await expect(them.getByRole('heading', { name: 'Hi Priya' })).toBeVisible()
  await expect(them.getByText('Tell us about your brand')).toBeVisible()
  await expect(them.getByText('0 of 6 sections done')).toBeVisible()
  await expect(them.getByText('Nothing to review. You’re all caught up.')).toBeVisible()

  // The nav moves between sections.
  await them.getByRole('link', { name: 'Content', exact: true }).click()
  await expect(them.getByRole('heading', { name: 'Content' })).toBeVisible()
  await expect(them.getByRole('tab', { name: /To review/ })).toHaveAttribute('aria-selected', 'true')
  await them.getByRole('link', { name: 'Tasks', exact: true }).click()
  await expect(them.getByText('Your agency hasn’t asked you for anything.')).toBeVisible()

  // Brand DNA, from the card on Home. The first step opens by itself.
  await them.getByRole('link', { name: 'Home', exact: true }).click()
  await them.getByRole('button', { name: 'Get started' }).click()
  await expect(them.getByRole('heading', { name: 'Brand DNA' })).toBeVisible()
  await them.fill('#b-what', 'Small-batch breads and festive sweets.')
  await them.fill('#b-aud', 'Families in Bengaluru.')
  await them.getByRole('button', { name: '+ Add a product or service' }).click()
  await them.getByLabel('Name', { exact: true }).fill('Diwali hampers')
  await them.fill('#b-web', 'velvetoven.in')
  await them.getByLabel('Instagram').fill('@velvetoven')
  await them.getByRole('button', { name: 'Save and continue' }).click()
  await expect(them.getByText('1 of 6 sections done')).toBeVisible()

  // Personality opens next.
  await expect(them.locator('#b-kw')).toBeVisible()
  await them.getByLabel('Playful to Serious').fill('20')
  await them.fill('#b-kw', 'Warm, honest, homemade')
  await them.getByRole('button', { name: 'Save and continue' }).click()
  await expect(them.getByText('2 of 6 sections done')).toBeVisible()

  // Styles: tap chips.
  await them.getByRole('button', { name: 'Warm', exact: true }).click()
  await them.getByRole('button', { name: 'Natural', exact: true }).click()
  await them.getByRole('button', { name: 'Save and continue' }).click()
  await expect(them.getByText('3 of 6 sections done')).toBeVisible()
  await them.getByRole('button', { name: 'Bold', exact: true }).click()
  await them.getByRole('button', { name: 'Save and continue' }).click()
  await expect(them.getByText('4 of 6 sections done')).toBeVisible()

  // References: add a link, then done.
  await them.fill('#r-link', 'instagram.com/p/abc')
  await them.fill('#r-note', 'Love the calm feel')
  await them.getByRole('button', { name: 'Add reference' }).click()
  await expect(them.getByText('instagram.com/p/abc')).toBeVisible()
  await them.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(them.getByText('5 of 6 sections done')).toBeVisible()

  // Assets: nothing asked for yet.
  await them.getByRole('button', { name: 'Mark as done' }).click()
  await expect(them.getByText('All sections done')).toBeVisible()

  // Saved for real: a reload shows the answers, and the agency sees them.
  await them.reload()
  await them.getByRole('button', { name: /About your brand/ }).click()
  await expect(them.locator('#b-what')).toHaveValue('Small-batch breads and festive sweets.')
  await expect(them.locator('#b-web')).toHaveValue('https://velvetoven.in')
  const { brand } = await api(page, 'GET', `/clients/${clientId}/brand`)
  expect(brand.sections.likes.data.tags).toEqual(['warm', 'natural'])
  expect(brand.sections.personality.data).toMatchObject({ keywords: 'Warm, honest, homemade', axes: { playful_serious: 20 } })
  expect(brand.onboarding.done).toBe(6)

  await them.getByRole('link', { name: 'Home', exact: true }).click()
  await expect(them.getByText('Your Brand DNA is complete')).toBeVisible()
  done()
  clientDone()
})
