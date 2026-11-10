import { expect, test, type Browser, type Page } from '@playwright/test'
import { api, clientAdmin, headerPill, seedVersionFiles, signUpOwner, watchErrors } from '../helpers'

// The agency's content buttons, clicked in the browser: the create dialog, the list's tabs, search and filters,
// the detail page's next steps (internal review, send, schedule, publish, cancel), feedback and the checklist,
// and the review queue and feedback inbox. R2 isn't available, so version files are seeded into the database.

const newClient = (page: Page, brandName = 'Velvet Oven') =>
  api(page, 'POST', '/clients', { name: `${brandName} Foods`, brandName, timezone: 'Asia/Kolkata' }).then((r) => r.client as { _id: string })

/** Content with V01 uploaded (seeded files), still in production. */
async function withVersion(page: Page, clientId: string, title = 'Diwali menu carousel') {
  const { content } = await api(page, 'POST', '/content', { client: clientId, title, platform: 'instagram', format: 'carousel' })
  await api(page, 'POST', `/content/${content._id}/versions`, { files: await seedVersionFiles(clientId), caption: 'Light up your Diwali' })
  return content._id as string
}

/** Opens the "More actions" menu in the page header and picks an item. */
async function more(page: Page, item: string) {
  await page.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: item }).click()
}

test('content list: create from the dialog, edit details, search, tabs, filters, cancel and restore', async ({ page }) => {
  const done = watchErrors(page)
  await signUpOwner(page)
  const client = await newClient(page)

  // Empty list → the empty state's own button opens the same dialog.
  await page.goto('/app/content')
  await expect(page.getByText('No content yet')).toBeVisible()
  await page.getByRole('button', { name: 'New content' }).last().click()
  const dialog = page.getByRole('dialog')
  // Create stays disabled until a client is picked.
  await expect(dialog.getByRole('button', { name: 'Create' })).toBeDisabled()
  await page.selectOption('#ct-client', client._id)
  await page.fill('#ct-title', 'Navratri reel')
  await page.selectOption('#ct-platform', 'facebook')
  await page.selectOption('#ct-format', 'video')
  await page.selectOption('#ct-priority', 'high')
  await page.fill('#ct-brief', 'Nine nights, nine dishes.')
  await dialog.getByRole('button', { name: 'Create' }).click()
  await page.waitForURL(/\/app\/content\/[0-9a-f]{24}$/)
  await expect(page.getByRole('heading', { name: 'Navratri reel' })).toBeVisible()
  await expect(page.getByText('Nine nights, nine dishes.')).toBeVisible()
  await expect(headerPill(page, 'In production')).toBeVisible()

  // Edit details from the menu: the title, idea and revision limit change.
  await more(page, 'Edit details')
  await page.fill('#ct-title', 'Navratri reel: nine dishes')
  await page.fill('#ct-idea', 'One dish per night')
  await page.fill('#ct-revisions', '3')
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Navratri reel: nine dishes' })).toBeVisible()
  await expect(page.getByText('One dish per night')).toBeVisible()

  // A second item, so search and filters have something to tell apart.
  await withVersion(page, client._id, 'Diwali menu carousel')
  await page.goto('/app/content')
  const table = page.getByRole('table')
  await expect(table.getByText('Navratri reel: nine dishes')).toBeVisible()
  await expect(table.getByText('Diwali menu carousel')).toBeVisible()

  await page.getByPlaceholder('Search titles…').fill('diwali')
  await expect(table.getByText('Navratri reel: nine dishes')).toHaveCount(0)
  await expect(table.getByText('Diwali menu carousel')).toBeVisible()
  await page.getByPlaceholder('Search titles…').fill('')
  await expect(table.getByText('Navratri reel: nine dishes')).toBeVisible()

  // Platform filter.
  await page.getByRole('button', { name: 'Filters' }).click()
  await page.getByRole('dialog', { name: 'Filters' }).getByLabel('Facebook').check()
  await page.keyboard.press('Escape')
  await expect(table.getByText('Diwali menu carousel')).toHaveCount(0)
  await expect(table.getByText('Navratri reel: nine dishes')).toBeVisible()
  await page.getByRole('button', { name: /Clear all/ }).click()
  await expect(table.getByText('Diwali menu carousel')).toBeVisible()

  // Sort menu.
  await page.getByRole('button', { name: /^Sort:/ }).click()
  await page.getByRole('menuitem', { name: 'Title A–Z' }).click()
  await expect(page).toHaveURL(/sort=title/)
  await expect(table.locator('tbody tr').first()).toContainText('Diwali menu carousel')

  // Tabs: both are in production; nothing with the client yet.
  await page.getByRole('tab', { name: /With client/ }).click()
  await expect(page.getByText('Nothing here')).toBeVisible()
  await page.getByRole('button', { name: 'Show everything' }).click()
  await expect(table.getByText('Diwali menu carousel')).toBeVisible()

  // Row click opens the detail; cancel it from the menu, find it under Cancelled, restore it.
  await table.getByText('Navratri reel: nine dishes').click()
  await page.waitForURL(/\/app\/content\/[0-9a-f]{24}$/)
  await more(page, 'Cancel content')
  await page.fill('#note-text', 'Client dropped Navratri')
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel content' }).click()
  await expect(headerPill(page, 'Cancelled')).toBeVisible()
  await page.goto('/app/content')
  await page.getByRole('tab', { name: /Cancelled/ }).click()
  await table.getByText('Navratri reel: nine dishes').click()
  await page.getByRole('button', { name: 'Restore' }).click()
  await expect(headerPill(page, 'In production')).toBeVisible()
  done()
})

test('internal review: request changes, approve, continue editing, send from the queue', async ({ page }) => {
  const done = watchErrors(page)
  await signUpOwner(page)
  const client = await newClient(page)
  const id = await withVersion(page, client._id)

  await page.goto(`/app/content/${id}`)
  await page.getByRole('button', { name: 'Submit V01 for review' }).click()
  await expect(headerPill(page, 'Internal review')).toBeVisible()

  // The review queue lists it; the row opens the content.
  await page.goto('/app/review')
  const awaiting = page.locator('section, div').filter({ has: page.getByRole('heading', { name: 'Waiting for internal review' }) }).last()
  await expect(awaiting.getByText('Diwali menu carousel')).toBeVisible()
  await awaiting.getByText('Diwali menu carousel').click()
  await page.waitForURL(`**/app/content/${id}`)

  // Request changes needs a note, then it's back in production.
  await page.getByRole('button', { name: 'Request changes' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: 'Send back to production' })).toBeDisabled()
  await page.fill('#note-text', 'Logo is too small.')
  await dialog.getByRole('button', { name: 'Send back to production' }).click()
  await expect(headerPill(page, 'In production')).toBeVisible()
  await expect(page.getByText('“Logo is too small.”')).toBeVisible()

  // Submit again and approve without sending: ready for the client.
  await page.getByRole('button', { name: 'Submit V01 for review' }).click()
  await expect(headerPill(page, 'Internal review')).toBeVisible()
  await page.getByRole('button', { name: 'Approve', exact: true }).click()
  await expect(headerPill(page, 'Ready for client')).toBeVisible()

  // Continue editing goes back to production; then approve again.
  await page.getByRole('button', { name: 'Continue editing' }).click()
  await expect(headerPill(page, 'In production')).toBeVisible()
  await page.getByRole('button', { name: 'Submit V01 for review' }).click()
  await page.getByRole('button', { name: 'Approve', exact: true }).click()
  await expect(headerPill(page, 'Ready for client')).toBeVisible()

  // "Ready to send" in the queue; send from the dialog with a message.
  await page.goto('/app/review')
  const ready = page.locator('section, div').filter({ has: page.getByRole('heading', { name: 'Ready to send' }) }).last()
  await ready.getByText('Diwali menu carousel').click()
  await page.getByRole('button', { name: 'Send to client' }).click()
  await page.fill('#send-note', 'Here is V01, as briefed.')
  await page.getByRole('dialog').getByRole('button', { name: 'Send now' }).click()
  await expect(headerPill(page, 'With client')).toBeVisible()
  await expect(page.getByText('Sent. Waiting for the client to open it.')).toBeVisible()

  await page.goto('/app/review')
  const waiting = page.locator('section, div').filter({ has: page.getByRole('heading', { name: 'Waiting on the client' }) }).last()
  await expect(waiting.getByText('Diwali menu carousel')).toBeVisible()
  done()
})

test('send later: a scheduled send shows on the content and can still be sent now', async ({ page }) => {
  const done = watchErrors(page)
  await signUpOwner(page)
  const client = await newClient(page)
  const id = await withVersion(page, client._id)
  await api(page, 'POST', `/content/${id}/submit`)
  await api(page, 'POST', `/content/${id}/internal-review`, { decision: 'approve' })

  await page.goto(`/app/content/${id}`)
  await page.getByRole('button', { name: 'Send to client' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('radio', { name: 'Send later' }).click()
  await expect(dialog.getByRole('button', { name: 'Schedule send' })).toBeDisabled()
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
  await page.fill('#send-at', `${tomorrow}T10:00`)
  await dialog.getByRole('button', { name: 'Schedule send' }).click()
  await expect(page.getByText(/Sending to the client/)).toBeVisible()
  await expect(headerPill(page, 'Ready for client')).toBeVisible()

  await page.getByRole('button', { name: 'Send to client' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Send now' }).click()
  await expect(headerPill(page, 'With client')).toBeVisible()
  done()
})

/** Content in review with one comment from the client admin, sent with changes requested. */
async function changesRequested(page: Page, browser: Browser) {
  const client = await newClient(page)
  const id = await withVersion(page, client._id)
  await api(page, 'POST', `/content/${id}/submit`)
  await api(page, 'POST', `/content/${id}/internal-review`, { decision: 'approve_and_send' })
  const brand = await clientAdmin(browser, page, client._id)
  const { content } = await api(brand, 'GET', `/client/content/${id}`)
  await api(brand, 'POST', `/client/content/${id}/threads`, { versionId: content.version._id, body: 'Please make the diya brighter.' })
  await api(brand, 'POST', `/client/content/${id}/request-changes`, { versionId: content.version._id, expectedState: content.state, note: 'One fix' })
  return { clientId: client._id, id, brand }
}

test('feedback: inbox, reply, start, assign, resolve, reopen, make a task; checklist without AI', async ({ page, browser }) => {
  const done = watchErrors(page)
  await signUpOwner(page)
  const { id } = await changesRequested(page, browser)

  // The inbox shows the client's comment; the row opens the content.
  await page.goto('/app/feedback')
  const table = page.getByRole('table')
  await expect(table.getByText('Please make the diya brighter.')).toBeVisible()
  await table.getByText('Please make the diya brighter.').click()
  await page.waitForURL(`**/app/content/${id}`)
  await expect(headerPill(page, 'Changes requested')).toBeVisible()

  const thread = page.locator('article').filter({ hasText: 'Please make the diya brighter.' })
  // Reply to the client.
  await thread.getByRole('button', { name: 'Reply' }).click()
  await thread.getByPlaceholder('Reply to the client').fill('On it, brighter diya in V02.')
  await thread.getByRole('button', { name: 'Reply' }).last().click()
  await expect(thread.getByText('On it, brighter diya in V02.')).toBeVisible()

  // Start, then assign to me.
  await thread.getByRole('button', { name: 'Start' }).click()
  await expect(thread.getByText('In progress')).toBeVisible()
  await thread.getByLabel('Assignee').selectOption({ label: 'Asha Owner' })
  await expect(thread.getByLabel('Assignee')).toHaveValue(/[0-9a-f]{24}/)

  // In progress + assigned to me in the inbox.
  await page.goto('/app/feedback')
  await page.getByRole('tab', { name: 'In progress' }).click()
  await expect(table.getByText('Please make the diya brighter.')).toBeVisible()
  await page.getByRole('switch', { name: 'Assigned to me' }).click()
  await expect(table.getByText('Please make the diya brighter.')).toBeVisible()
  await page.goto(`/app/content/${id}`)

  // Make a task from it.
  await thread.getByRole('button', { name: 'Make task' }).click()
  await expect(page.getByText(/Task created:/)).toBeVisible()

  // Resolve with a note, then the resolved view and reopen.
  await thread.getByRole('button', { name: 'Resolve' }).click()
  await thread.getByPlaceholder(/Your response to the client/).fill('Brightened in the next version.')
  await thread.getByRole('button', { name: 'Mark resolved' }).click()
  await expect(page.getByText('Everything here is resolved.')).toBeVisible()
  await page.getByRole('button', { name: 'Show 1 resolved' }).click()
  await expect(thread.getByText('“Brightened in the next version.”')).toBeVisible()
  await thread.getByRole('button', { name: 'Reopen' }).click()
  await expect(thread.getByRole('button', { name: 'Resolve' })).toBeVisible()

  // The checklist: no AI configured, so no AI button, just your own items.
  const checklist = page.locator('section, div').filter({ has: page.getByRole('heading', { name: 'Revision checklist' }) }).last()
  await expect(checklist.getByText('Add the changes you’ll make.')).toBeVisible()
  await expect(checklist.getByRole('button', { name: /AI/ })).toHaveCount(0)
  await checklist.getByLabel('New checklist item').fill('Brighten the diya')
  await checklist.getByRole('button', { name: 'Add' }).click()
  await expect(checklist.getByText('Brighten the diya')).toBeVisible()
  await checklist.getByRole('button', { name: 'Edit' }).click()
  await checklist.locator('li input').fill('Brighten the diya by 20%')
  await checklist.getByRole('button', { name: 'Save' }).click()
  await expect(checklist.getByText('Brighten the diya by 20%')).toBeVisible()
  await checklist.getByLabel('New checklist item').fill('Bigger logo')
  await checklist.getByRole('button', { name: 'Add' }).click()
  await checklist.locator('li', { hasText: 'Bigger logo' }).getByRole('button', { name: 'Remove' }).click()
  await expect(checklist.getByText('Bigger logo')).toHaveCount(0)
  await checklist.locator('li', { hasText: 'Brighten the diya by 20%' }).getByRole('button', { name: 'Make a task' }).click()
  await expect(checklist.getByText('· task')).toBeVisible()

  // The client sees the accepted item.
  const { items } = await api(page, 'GET', `/content/${id}/checklist`)
  expect(items.filter((i: { status: string }) => i.status === 'accepted').map((i: { text: string }) => i.text)).toEqual(['Brighten the diya by 20%'])

  // Internal note: never on the client's side.
  await page.getByRole('tab', { name: /Internal/ }).click()
  await page.getByLabel('Internal note').fill('Use the warmer LUT.')
  await page.getByRole('button', { name: 'Add note' }).click()
  await expect(page.getByText('Use the warmer LUT.')).toBeVisible()
  done()
})

test('changes requested: re-send with a reply, then V02, compare versions', async ({ page, browser }) => {
  const done = watchErrors(page)
  await signUpOwner(page)
  const { clientId, id } = await changesRequested(page, browser)

  await page.goto(`/app/content/${id}`)
  await page.getByRole('button', { name: /Re-send V01 with a reply/ }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: 'Re-send' })).toBeDisabled()
  await page.fill('#note-text', 'The guidelines keep the diya this warm.')
  await dialog.getByRole('button', { name: 'Re-send' }).click()
  await expect(headerPill(page, 'With client')).toBeVisible()

  // V02 (seeded), then the version tabs and compare.
  await api(page, 'POST', `/content/${id}/versions`, { files: await seedVersionFiles(clientId), caption: 'Light up your Diwali, V2' })
  await page.reload()
  await expect(page.getByRole('tab', { name: /V02/ })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: /V01/ }).click()
  await expect(page.getByText('Older version · read only')).toBeVisible()
  await expect(page.getByText('You’re looking at an older version. Comments go on the current version.')).toBeVisible()
  await page.getByRole('tab', { name: /V02/ }).click()
  await page.locator('label', { hasText: 'Compare with' }).locator('select').selectOption({ label: 'V01' })
  await expect(page.getByText('V01', { exact: true })).toBeVisible()
  await expect(page.getByText('V02', { exact: true })).toBeVisible()
  done()
})

test('approved: unschedule, mark published straight from approved, view post', async ({ page, browser }) => {
  const done = watchErrors(page)
  await signUpOwner(page)
  const client = await newClient(page)
  const id = await withVersion(page, client._id)
  await api(page, 'POST', `/content/${id}/submit`)
  await api(page, 'POST', `/content/${id}/internal-review`, { decision: 'approve_and_send' })
  const brand = await clientAdmin(browser, page, client._id)
  const { content } = await api(brand, 'GET', `/client/content/${id}`)
  await api(brand, 'POST', `/client/content/${id}/approve`, { versionId: content.version._id, expectedState: content.state })

  await page.goto('/app/review')
  const toSchedule = page.locator('section, div').filter({ has: page.getByRole('heading', { name: 'Ready to schedule' }) }).last()
  await toSchedule.getByText('Diwali menu carousel').click()
  await expect(headerPill(page, 'Approved')).toBeVisible()

  // Schedule needs a time; then unschedule.
  await page.getByRole('button', { name: 'Schedule', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Schedule' })).toBeDisabled()
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
  await page.fill('#sch-at', `${tomorrow}T19:00`)
  await page.getByRole('dialog').getByRole('button', { name: 'Schedule' }).click()
  await expect(headerPill(page, 'Scheduled')).toBeVisible()
  await expect(page.getByText(/via manual publishing/)).toBeVisible()
  await page.getByRole('button', { name: 'Unschedule' }).click()
  await expect(headerPill(page, 'Approved')).toBeVisible()

  // Mark as published right away; a bad link is refused in place.
  await page.getByRole('button', { name: 'Mark as published' }).click()
  await page.fill('#pub-url', 'not a link')
  await page.getByRole('dialog').getByRole('button', { name: 'Mark published' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.fill('#pub-url', 'https://www.instagram.com/p/e2e-direct/')
  await page.getByRole('dialog').getByRole('button', { name: 'Mark published' }).click()
  await expect(headerPill(page, 'Published')).toBeVisible()
  await expect(page.getByRole('link', { name: 'View post' })).toHaveAttribute('href', 'https://www.instagram.com/p/e2e-direct/')
  // Published content can't be edited or cancelled.
  await expect(page.getByRole('button', { name: 'More actions' })).toHaveCount(0)
  done()
})

test('apply a task list from a template', async ({ page }) => {
  const done = watchErrors(page)
  await signUpOwner(page)
  const client = await newClient(page)
  const id = await withVersion(page, client._id)

  await page.goto(`/app/content/${id}`)
  await more(page, 'Apply a task list')
  await expect(page.getByText('No task-list templates yet. Create one under Templates.')).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Back' }).click()

  await api(page, 'POST', '/templates', { type: 'task_list', name: 'Carousel production', body: { tasks: [{ title: 'Shoot', dueOffsetDays: -3 }, { title: 'Edit', dueOffsetDays: -1 }] } })
  await more(page, 'Apply a task list')
  await page.selectOption('#tl-template', { label: 'Carousel production' })
  await page.getByRole('dialog').getByRole('button', { name: 'Add tasks' }).click()
  await expect(page.getByText('Added 2 tasks')).toBeVisible()
  done()
})
