import { expect, test, type Page } from '@playwright/test'
import { api, clientAdmin, inviteToken, signUpOwner, unique, watchErrors } from '../helpers'

// The agency's client and team setup, clicked through in the browser: add and edit a client, every client tab,
// and managing the team. API calls only set up what isn't under test.

/** The toast for a finished action. */
const toast = (page: Page, text: string | RegExp) => page.getByRole('status').filter({ hasText: text }).first()

/** Opens a row's "…" menu and picks an item. */
async function menu(page: Page, label: string | RegExp, item: string) {
  await page.getByRole('button', { name: label }).click()
  await page.getByRole('menuitem', { name: item, exact: true }).click()
}

/** A teammate who joined through an invitation, with the given role. */
async function teammate(page: Page, browser: import('@playwright/test').Browser, role: 'member' | 'manager', name: string) {
  const email = `${role}-${unique()}@e2e.test`
  await api(page, 'POST', '/agency/invitations', { email, role })
  const token = await inviteToken(email)
  const them = await (await browser.newContext()).newPage()
  await them.goto(`/invite/${token}`)
  await them.fill('#invite-name', name)
  await them.fill('#invite-password', `${role}-pass-123`)
  await them.getByRole('button', { name: 'Accept and create account' }).click()
  await them.waitForURL('**/app')
  return { email, page: them }
}

test('clients: add from the list, search, edit details and contract, change status, archive and restore', async ({ page }) => {
  const done = watchErrors(page)
  await signUpOwner(page)

  await page.goto('/app/clients')
  await expect(page.getByText('No clients yet')).toBeVisible()
  await page.getByRole('button', { name: 'Add client' }).click()
  const form = page.getByRole('dialog', { name: 'Add a client' })
  await form.locator('#client-brand').fill('Velvet Oven')
  await form.locator('#client-company').fill('Velvet Oven Foods Pvt Ltd')
  await form.locator('#client-services').fill('Social media')
  await form.locator('#client-services').press('Enter')
  await form.locator('#client-contact-name').fill('Ritu Rao')
  await form.locator('#client-contact-email').fill('ritu@velvet.test')
  await form.locator('#client-revisions').fill('3')
  await form.locator('#client-notes').fill('Prefers WhatsApp updates.')
  await form.getByRole('button', { name: 'Add client' }).click()

  // Saving opens the new client.
  await page.waitForURL(/\/app\/clients\/[0-9a-f]{24}$/)
  await expect(toast(page, 'Velvet Oven added')).toBeVisible()
  await expect(page.locator('main h1')).toContainText('Velvet Oven')
  await expect(page.getByText('Prefers WhatsApp updates.')).toBeVisible()
  await expect(page.getByText('3 rounds per post')).toBeVisible()
  await expect(page.getByText('Social media')).toBeVisible()

  // A second client, so search has something to rule out.
  await api(page, 'POST', '/clients', { name: 'Blue Lotus Spa', brandName: 'Blue Lotus', timezone: 'Asia/Kolkata' })
  // (Made behind the page's back, so load the list fresh.)
  await page.goto('/app/clients')
  const rows = page.getByRole('table', { name: 'Clients' }).locator('tbody tr')
  await expect(rows).toHaveCount(2)
  await page.getByRole('searchbox', { name: /Search brands/ }).fill('velvet')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('Velvet Oven')
  await page.getByRole('searchbox', { name: /Search brands/ }).fill('nothing-like-this')
  await expect(page.getByText('No clients match')).toBeVisible()
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await expect(rows).toHaveCount(2)
  // Status tabs: both are new, so both are onboarding.
  await page.getByRole('tab', { name: /Active/ }).click()
  await expect(page.getByText('No clients match')).toBeVisible()
  await page.getByRole('tab', { name: /Onboarding/ }).click()
  await expect(rows).toHaveCount(2)

  // Open it from the row and edit details and contract.
  await rows.filter({ hasText: 'Velvet Oven' }).click()
  await page.getByRole('button', { name: 'Edit details' }).click()
  const edit = page.getByRole('dialog', { name: 'Edit Velvet Oven' })
  await edit.locator('#client-contact-phone').fill('+91 98765 43210')
  await edit.locator('#client-lead').fill('48')
  await edit.getByRole('switch', { name: 'Internal review' }).click()
  await edit.getByRole('button', { name: 'Save changes' }).click()
  await expect(toast(page, 'Velvet Oven saved')).toBeVisible()
  await expect(edit).toBeHidden()
  await expect(page.getByText('+91 98765 43210')).toBeVisible()
  await expect(page.getByText('48 hours before publishing')).toBeVisible()
  await expect(page.getByText('Off: work goes straight to the client')).toBeVisible()

  // Status: activate, pause, then archive (read-only) and restore.
  const more = page.getByRole('button', { name: 'More actions for Velvet Oven' })
  await more.click()
  await page.getByRole('menuitem', { name: 'Mark active' }).click()
  await expect(toast(page, 'Velvet Oven is active')).toBeVisible()
  await expect(page.locator('header').getByText('Active', { exact: true })).toBeVisible()
  await more.click()
  await page.getByRole('menuitem', { name: 'Pause' }).click()
  await expect(page.locator('header').getByText('Paused', { exact: true })).toBeVisible()
  await more.click()
  await page.getByRole('menuitem', { name: 'Archive' }).click()
  await page.getByRole('dialog', { name: 'Archive Velvet Oven?' }).getByRole('button', { name: 'Archive' }).click()
  await expect(toast(page, 'Velvet Oven was archived')).toBeVisible()
  await expect(page.getByText('This client is archived')).toBeVisible()
  await more.click()
  await page.getByRole('menuitem', { name: 'Restore' }).click()
  await expect(toast(page, 'Velvet Oven was restored')).toBeVisible()
  await expect(page.getByText('This client is archived')).toBeHidden()

  // Delete the other one.
  await page.goto('/app/clients')
  await rows.filter({ hasText: 'Blue Lotus' }).click()
  await menu(page, 'More actions for Blue Lotus', 'Delete client')
  await page.getByRole('dialog', { name: 'Delete Blue Lotus?' }).getByRole('button', { name: 'Delete client' }).click()
  await page.waitForURL('**/app/clients')
  await expect(rows).toHaveCount(1)
  done()
})

test('client brand DNA: edit sections, guidelines, references and ask the client', async ({ page }) => {
  const done = watchErrors(page)
  await signUpOwner(page)
  const { client } = await api(page, 'POST', '/clients', { name: 'Velvet Oven Foods', brandName: 'Velvet Oven', timezone: 'Asia/Kolkata' })
  await page.goto(`/app/clients/${client._id}/brand`)

  // A client section (intro).
  const intro = page.locator('section', { has: page.getByRole('heading', { name: 'From the client' }) })
  await intro.getByRole('button', { name: 'Edit' }).first().click()
  let dialog = page.getByRole('dialog')
  await dialog.locator('#b-what').fill('Small-batch bakery for festive boxes.')
  await dialog.getByRole('button', { name: 'Add offering' }).click()
  await dialog.getByRole('textbox', { name: 'Offering name' }).fill('Diwali box')
  await dialog.locator('#b-web').fill('https://velvet.test')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText('Small-batch bakery for festive boxes.')).toBeVisible()
  await expect(page.getByText('Diwali box')).toBeVisible()
  // Edit it again: the second save carries the new revision.
  await intro.getByRole('button', { name: 'Edit' }).first().click()
  dialog = page.getByRole('dialog')
  await dialog.locator('#b-stand').fill('Joy in every bite.')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText('Joy in every bite.')).toBeVisible()

  // An agency-layer section.
  const layer = page.locator('section', { has: page.getByRole('heading', { name: 'Your professional layer' }) })
  await layer.getByRole('button', { name: 'Edit' }).nth(1).click()
  dialog = page.getByRole('dialog', { name: 'Edit positioning' })
  await dialog.locator('#b-text').fill('Warm, generous, a little cheeky.')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText('Warm, generous, a little cheeky.')).toBeVisible()

  // Ask the client to update a section, and for an asset.
  await page.getByRole('button', { name: /Ask the client to update/ }).first().click()
  dialog = page.getByRole('dialog')
  await dialog.locator('#ru-note').fill('Please add your new store address.')
  await dialog.getByRole('button', { name: 'Send request' }).click()
  await expect(toast(page, 'Request sent to the client')).toBeVisible()
  await page.getByRole('button', { name: 'Ask for an asset' }).click()
  dialog = page.getByRole('dialog', { name: 'Ask for an asset' })
  await dialog.locator('#ar-title').fill('Logo in SVG')
  await dialog.getByRole('button', { name: 'Request' }).click()
  await expect(toast(page, 'Asset requested')).toBeVisible()
  await expect(page.getByText('1 remaining')).toBeVisible()

  // A link reference, filtered and removed.
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Add a reference' })
  await dialog.getByRole('radio', { name: 'Dislike' }).click()
  await dialog.locator('#ref-link').fill('https://example.test/moodboard')
  await dialog.locator('#ref-note').fill('Too corporate')
  await dialog.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(toast(page, 'Reference added')).toBeVisible()
  const refs = page.getByRole('tablist', { name: 'Filter references' })
  await refs.getByRole('tab', { name: 'Likes', exact: true }).click()
  await expect(page.getByText('Too corporate')).toBeHidden()
  await refs.getByRole('tab', { name: 'Dislikes' }).click()
  await expect(page.getByText('Too corporate')).toBeVisible()
  await page.getByRole('button', { name: 'Remove reference' }).click()
  await expect(page.getByText('Too corporate')).toBeHidden()

  // Internal guidelines.
  const guidelines = page.locator('section, article, div').filter({ has: page.getByRole('heading', { name: 'Creative guidelines' }) }).last()
  await guidelines.getByRole('button', { name: 'Edit' }).click()
  dialog = page.getByRole('dialog', { name: 'Creative guidelines' })
  await dialog.locator('#g-dos').fill('Show the product in hand')
  await dialog.locator('#g-dos').press('Enter')
  await dialog.locator('#g-tone').fill('Friendly, never salesy.')
  await dialog.locator('#g-instagram').fill('Max 3 hashtags')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(toast(page, 'Guidelines saved')).toBeVisible()
  await expect(page.getByText('• Show the product in hand')).toBeVisible()
  await expect(page.getByText('Max 3 hashtags')).toBeVisible()

  // The history lists the edits.
  await expect(page.getByRole('heading', { name: 'Change history' })).toBeVisible()
  await expect(page.getByText('No changes yet.')).toBeHidden()
  done()
})

test('client library, integrations, conversations and activity tabs', async ({ page }) => {
  const done = watchErrors(page)
  await signUpOwner(page)
  const { client } = await api(page, 'POST', '/clients', { name: 'Velvet Oven Foods', brandName: 'Velvet Oven', timezone: 'Asia/Kolkata' })

  // Library: collections work without storage; an upload fails politely without R2.
  await page.goto(`/app/clients/${client._id}/library`)
  await expect(page.getByText('No files yet')).toBeVisible()
  await page.getByRole('button', { name: 'New collection' }).click()
  let dialog = page.getByRole('dialog', { name: 'New collection' })
  await dialog.locator('#col-name').fill('Diwali shoot')
  await dialog.getByRole('button', { name: 'Save' }).click()
  const collections = page.getByRole('navigation', { name: 'Collections' })
  await expect(collections.getByText('Diwali shoot')).toBeVisible()
  await menu(page, 'Actions for Diwali shoot', 'Edit')
  dialog = page.getByRole('dialog', { name: 'Edit collection' })
  await dialog.locator('#col-name').fill('Diwali shoot 2026')
  await dialog.locator('#col-vis').selectOption('internal')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(collections.getByText('Diwali shoot 2026')).toBeVisible()
  await collections.getByText('Diwali shoot 2026').click()
  await expect(page.getByText('Nothing here')).toBeVisible()
  await page.getByRole('navigation', { name: 'Categories' }).getByRole('button', { name: /^Brand/ }).click()
  await page.getByRole('navigation', { name: 'Categories' }).getByRole('button', { name: /^All files/ }).click()
  await page.getByRole('searchbox', { name: 'Search file names…' }).fill('logo')
  await expect(page.getByText('Nothing here')).toBeVisible()
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Upload' }).click()])
  await chooser.setFiles({ name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from('not really a png') })
  await expect(page.locator('main').getByText(/storage|upload|isn’t set up|unavailable/i).first()).toBeVisible()
  await menu(page, 'Actions for Diwali shoot 2026', 'Delete')
  await page.getByRole('dialog', { name: 'Delete Diwali shoot 2026?' }).getByRole('button', { name: 'Delete collection' }).click()
  await expect(collections.getByText('No collections yet.')).toBeVisible()

  // Integrations: nothing is configured on the test server, and that's said plainly.
  await page.getByRole('navigation', { name: 'Client sections' }).getByRole('link', { name: 'Integrations' }).click()
  await expect(page.getByText('No accounts connected')).toBeVisible()
  await expect(page.getByText('Not set up on this server yet').first()).toBeVisible()

  // Conversations: write to the client, and post an internal note.
  await page.getByRole('navigation', { name: 'Client sections' }).getByRole('link', { name: 'Conversations' }).click()
  await page.getByRole('textbox', { name: 'Message to the client' }).fill('Hi Ritu, the Diwali plan is on its way.')
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.locator('article').getByText('Hi Ritu, the Diwali plan is on its way.')).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Message to the client' })).toHaveValue('')
  await page.getByRole('navigation', { name: 'Conversations' }).getByRole('button', { name: /Team notes/ }).click()
  await page.getByRole('textbox', { name: 'Internal message' }).fill('They pay late, chase early.')
  await page.getByRole('button', { name: 'Post note' }).click()
  await expect(page.locator('article').getByText('They pay late, chase early.')).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Conversations' }).getByText(/They pay late/)).toBeVisible()

  // Activity: the client's own feed, filtered.
  await page.getByRole('navigation', { name: 'Client sections' }).getByRole('link', { name: 'Activity' }).click()
  await expect(page.getByRole('table', { name: 'Activity' }).getByText(/Velvet Oven/).first()).toBeVisible()
  await page.locator('main select').first().selectOption('client')
  await expect(page).toHaveURL(/action=client/)
  await expect(page.getByRole('table', { name: 'Activity' }).locator('tbody tr').first()).toBeVisible()
  await page.locator('main select').first().selectOption('invitation')
  await expect(page.getByText('Nothing here yet')).toBeVisible()
  done()
})

test('client agency team and client people: assign, invite, change role, remove', async ({ page, browser }) => {
  const done = watchErrors(page)
  await signUpOwner(page)
  const { client } = await api(page, 'POST', '/clients', { name: 'Velvet Oven Foods', brandName: 'Velvet Oven', timezone: 'Asia/Kolkata' })
  await teammate(page, browser, 'member', 'Ravi Member')

  // Agency team: assign Ravi, then take him off.
  // The creator is the account manager, so already on it.
  await page.goto(`/app/clients/${client._id}/team`)
  await expect(page.getByRole('button', { name: 'Remove Asha Owner' })).toBeVisible()
  await page.getByRole('combobox', { name: 'Team member to add' }).selectOption({ label: 'Ravi Member' })
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByRole('listitem').filter({ hasText: 'Ravi Member' })).toContainText('Member')
  await expect(page.getByRole('combobox', { name: 'Team member to add' })).toBeDisabled()
  await page.getByRole('button', { name: 'Remove Ravi Member' }).click()
  await expect(toast(page, 'Ravi Member no longer has access')).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: 'Ravi Member' })).toHaveCount(0)

  // Client people: one admin who joined, one pending invite.
  const admin = await clientAdmin(browser, page, client._id)
  await admin.context().close()
  await page.getByRole('link', { name: 'Client people' }).click()
  const people = page.getByRole('table', { name: 'Velvet Oven people' })
  await expect(people.getByText('Priya Client')).toBeVisible()
  const email = `approver-${unique()}@e2e.test`
  await page.getByRole('button', { name: 'Invite client' }).click()
  await page.fill('#invite-email', email)
  await page.getByRole('button', { name: 'Send invitation' }).click()
  await expect(toast(page, `Invitation sent to ${email}`)).toBeVisible()
  const invitations = page.getByRole('table', { name: 'Invitations' })
  await expect(invitations.getByText(email)).toBeVisible()

  // The last admin can't be downgraded: the server says no and the role stays.
  await people.getByRole('combobox', { name: 'Role for Priya Client' }).selectOption('approver')
  await expect(page.getByRole('status').filter({ hasText: /admin/i }).first()).toBeVisible()
  await expect(people.getByRole('combobox', { name: 'Role for Priya Client' })).toHaveValue('admin')

  // Resend and revoke the pending invitation.
  await menu(page, `Actions for the invitation to ${email}`, 'Resend invitation')
  await expect(toast(page, `New invitation sent to ${email}`)).toBeVisible()
  await menu(page, `Actions for the invitation to ${email}`, 'Revoke')
  await expect(toast(page, `Invitation to ${email} revoked`)).toBeVisible()
  await expect(invitations.getByText(email)).toBeHidden()

  // A second person, whose role can change and who can be removed.
  const second = `contrib-${unique()}@e2e.test`
  await api(page, 'POST', `/clients/${client._id}/invitations`, { email: second, role: 'contributor' })
  const token = await inviteToken(second)
  const them = await (await browser.newContext()).newPage()
  await them.goto(`/invite/${token}`)
  await them.fill('#invite-name', 'Kabir Contributor')
  await them.fill('#invite-password', 'client-pass-123')
  await them.getByRole('button', { name: 'Accept and create account' }).click()
  await them.waitForURL('**/c')
  await page.reload()
  await people.getByRole('combobox', { name: 'Role for Kabir Contributor' }).selectOption('approver')
  await expect(toast(page, 'Kabir Contributor is now approver')).toBeVisible()
  await page.getByRole('button', { name: 'Remove Kabir Contributor' }).click()
  await page.getByRole('dialog', { name: 'Remove Kabir Contributor?' }).getByRole('button', { name: 'Remove' }).click()
  await expect(toast(page, 'Kabir Contributor was removed')).toBeVisible()
  await expect(people.getByText('Kabir Contributor')).toBeHidden()
  done()
})

test('team: edit role, publishing and capacity, disable and enable, remove, and manage invitations', async ({ page, browser }) => {
  const done = watchErrors(page)
  await signUpOwner(page)
  await teammate(page, browser, 'member', 'Ravi Member')

  await page.goto('/app/team')
  const table = page.getByRole('table', { name: 'Team members' })
  await expect(table.getByText('Ravi Member')).toBeVisible()

  // Role, can publish, titles and capacity, from the row's menu.
  await menu(page, 'Actions for Ravi Member', 'Edit role and details')
  let dialog = page.getByRole('dialog', { name: 'Edit Ravi Member' })
  await dialog.locator('#member-role').selectOption('manager')
  await dialog.getByRole('switch', { name: 'Can publish' }).click()
  await dialog.locator('#member-titles').fill('Designer')
  await dialog.locator('#member-titles').press('Enter')
  await dialog.locator('#member-capacity').fill('12')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(toast(page, 'Ravi Member updated')).toBeVisible()
  const row = table.locator('tr', { hasText: 'Ravi Member' })
  await expect(row).toContainText('Manager')
  await expect(row).toContainText('Can publish')
  await expect(row).toContainText('Designer')
  // Clicking the row opens the same dialog, with what was saved.
  await row.getByText('Designer').click()
  dialog = page.getByRole('dialog', { name: 'Edit Ravi Member' })
  await expect(dialog.locator('#member-capacity')).toHaveValue('12')
  await expect(dialog.getByRole('switch', { name: 'Can publish' })).toHaveAttribute('aria-checked', 'true')
  await dialog.getByRole('button', { name: 'Cancel' }).click()

  // Filters.
  await page.getByRole('searchbox', { name: /Search names/ }).fill('ravi')
  await expect(table.locator('tbody tr')).toHaveCount(1)
  await page.getByRole('searchbox', { name: /Search names/ }).fill('')
  await expect(table.locator('tbody tr')).toHaveCount(2)

  // Disable and enable.
  await menu(page, 'Actions for Ravi Member', 'Disable')
  await page.getByRole('dialog', { name: 'Disable Ravi Member?' }).getByRole('button', { name: 'Disable' }).click()
  await expect(toast(page, 'Ravi Member is disabled')).toBeVisible()
  await expect(row).toContainText('Disabled')
  await menu(page, 'Actions for Ravi Member', 'Enable')
  await page.getByRole('dialog', { name: 'Enable Ravi Member?' }).getByRole('button', { name: 'Enable' }).click()
  await expect(row).toContainText('Active')

  // Remove.
  await menu(page, 'Actions for Ravi Member', 'Remove from team')
  await page.getByRole('dialog', { name: 'Remove Ravi Member from the team?' }).getByRole('button', { name: 'Remove' }).click()
  await expect(toast(page, 'Ravi Member was removed')).toBeVisible()
  await expect(table.getByText('Ravi Member')).toBeHidden()

  // Invitations tab: resend and revoke a pending one.
  const email = `pending-${unique()}@e2e.test`
  await api(page, 'POST', '/agency/invitations', { email, role: 'member' })
  await page.getByRole('link', { name: 'Invitations' }).click()
  await page.waitForURL('**/app/team/invitations')
  const invites = page.getByRole('table', { name: 'Invitations' })
  await expect(invites.getByText(email)).toBeVisible()
  await menu(page, `Actions for the invitation to ${email}`, 'Resend invitation')
  await expect(toast(page, `New invitation sent to ${email}`)).toBeVisible()
  await menu(page, `Actions for the invitation to ${email}`, 'Revoke')
  await expect(toast(page, `Invitation to ${email} revoked`)).toBeVisible()
  await expect(invites.getByText(email)).toBeHidden()
  done()
})
