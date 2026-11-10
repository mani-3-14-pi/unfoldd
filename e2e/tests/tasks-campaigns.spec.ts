import { expect, test, type Browser, type Page } from '@playwright/test'
import { api, clientAdmin, headerPill, inviteToken, seedVersionFiles, signUpOwner, unique, watchErrors } from '../helpers'

// Tasks and campaigns, clicked through in the browser. The API only sets up what isn't under test.

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)

/** A team member (role Member) with access to the client, signed in in their own browser. */
async function teamMember(browser: Browser, owner: Page, clientId: string) {
  const email = `member-${unique()}@e2e.test`
  await api(owner, 'POST', '/agency/invitations', { email, role: 'member' })
  const token = await inviteToken(email)
  const page = await (await browser.newContext()).newPage()
  await page.goto(`/invite/${token}`)
  await page.fill('#invite-name', 'Ravi Member')
  await page.fill('#invite-password', 'member-pass-123')
  await page.getByRole('button', { name: 'Accept and create account' }).click()
  await page.waitForURL('**/app')
  const me = await api(page, 'GET', '/auth/me')
  await api(owner, 'POST', `/clients/${clientId}/access`, { userId: me.user.id ?? me.user._id })
  return page
}

/** Creates a task from the New task dialog and returns its id (the page lands on the task). */
async function newTask(page: Page, clientId: string, title: string, extra?: (page: Page) => Promise<void>) {
  await page.goto('/app/tasks')
  await page.getByRole('button', { name: 'New task' }).first().click()
  await page.selectOption('#tk-client', clientId)
  await page.fill('#tk-title', title)
  await extra?.(page)
  await page.getByRole('button', { name: 'Create task' }).click()
  await page.waitForURL(/\/app\/tasks\/[0-9a-f]{24}$/)
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  return page.url().split('/').pop()!
}

test('tasks: create, edit, status, comments, dependencies, block, delete', async ({ page, browser }) => {
  test.setTimeout(120_000)
  const done = watchErrors(page)
  await signUpOwner(page)
  const { client } = await api(page, 'POST', '/clients', { name: 'Velvet Oven Foods', brandName: 'Velvet Oven', timezone: 'Asia/Kolkata' })
  const member = await teamMember(browser, page, client._id)
  const memberDone = watchErrors(member)
  const due = inDays(5)

  // Create, assigned to the member, with a due date and priority.
  const id = await newTask(page, client._id, 'Shoot the hero dish', async (p) => {
    await expect(p.locator('#tk-owner option', { hasText: 'Ravi Member' })).toHaveCount(1)
    await p.selectOption('#tk-owner', { label: 'Ravi Member' })
    await p.fill('#tk-due', due)
    await p.selectOption('#tk-priority', 'high')
    await p.fill('#tk-description', 'Golden hour, top-down.')
  })
  await expect(page.getByText('Golden hour, top-down.')).toBeVisible()
  await expect(page.getByText('Ravi Member')).toBeVisible()
  await expect(page.getByText('High', { exact: true })).toBeVisible()

  // Edit.
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.fill('#tk-title', 'Shoot the hero dish again')
  await page.selectOption('#tk-priority', 'urgent')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Task saved')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Shoot the hero dish again' })).toBeVisible()
  await expect(page.getByText('Urgent', { exact: true })).toBeVisible()

  // Status from the header.
  await page.getByLabel('Status').selectOption('in_progress')
  await expect(page.getByText('Moved to In progress')).toBeVisible()
  await expect(headerPill(page, 'In progress')).toBeVisible()

  // Comments.
  await page.getByLabel('Comment').fill('Props are in the studio.')
  await page.getByRole('button', { name: 'Comment', exact: true }).click()
  await expect(page.getByText('Props are in the studio.')).toBeVisible()
  await expect(page.getByLabel('Comment')).toHaveValue('')

  // Manual block, then unblock.
  await page.getByRole('button', { name: 'Task actions' }).click()
  await page.getByRole('menuitem', { name: 'Mark blocked…' }).click()
  await page.fill('#block-reason', 'Waiting for product photos')
  await page.getByRole('dialog').getByRole('button', { name: 'Mark blocked' }).click()
  await expect(page.getByText('Blocked: Waiting for product photos')).toBeVisible()
  await page.getByRole('button', { name: 'Task actions' }).click()
  await page.getByRole('menuitem', { name: 'Unblock' }).click()
  await expect(page.getByText('Blocked: Waiting for product photos')).toHaveCount(0)

  // A second task waits on the first: blocked until the first is done.
  const second = await newTask(page, client._id, 'Write the captions')
  await page.getByRole('button', { name: 'Change' }).click()
  await page.getByRole('dialog').getByLabel('Shoot the hero dish again').check()
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Blocked until what it waits on is finished.', { exact: false })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Shoot the hero dish again' })).toBeVisible()

  // The first task lists what waits on it; finishing it unblocks the second.
  await page.goto(`/app/tasks/${id}`)
  await expect(page.getByText('Waiting on this')).toBeVisible()
  await page.getByLabel('Status').selectOption('done')
  await expect(headerPill(page, 'Done')).toBeVisible()
  await page.goto(`/app/tasks/${second}`)
  await expect(page.getByText('Blocked until what it waits on is finished.', { exact: false })).toHaveCount(0)

  // The member sees the task assigned to them.
  await member.goto('/app/tasks?status=done')
  await expect(member.getByRole('link', { name: 'Shoot the hero dish again' })).toBeVisible()
  await member.goto('/app/notifications')
  await expect(member.getByText(/assigned you/).first()).toBeVisible()

  // Delete.
  await page.getByRole('button', { name: 'Task actions' }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
  await page.waitForURL(/\/app\/tasks$/)
  await expect(page.getByText('Task deleted')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Write the captions' })).toHaveCount(0)
  done()
  memberDone()
})

test('tasks: board moves, list filters and search', async ({ page }) => {
  test.setTimeout(90_000)
  const done = watchErrors(page)
  await signUpOwner(page)
  const { client: a } = await api(page, 'POST', '/clients', { name: 'Velvet Oven Foods', brandName: 'Velvet Oven', timezone: 'Asia/Kolkata' })
  const { client: b } = await api(page, 'POST', '/clients', { name: 'Lumen Labs', brandName: 'Lumen', timezone: 'Asia/Kolkata' })
  await api(page, 'POST', '/tasks', { client: a._id, title: 'Plan the shoot' })
  await api(page, 'POST', '/tasks', { client: a._id, title: 'Book the studio', owner: null })
  await api(page, 'POST', '/tasks', { client: b._id, title: 'Draft the launch post' })

  // Board: the card menu moves a card.
  await page.goto('/app/tasks')
  await page.getByRole('tab', { name: 'Board' }).click()
  await expect(page).toHaveURL(/view=board/)
  const column = (name: string) => page.getByRole('region', { name, exact: true })
  await expect(column('To do').getByText('Plan the shoot')).toBeVisible()
  await page.getByRole('button', { name: 'Move Plan the shoot' }).click()
  await page.getByRole('menuitem', { name: 'In review' }).click()
  await expect(column('In review').getByText('Plan the shoot')).toBeVisible()
  await page.reload()
  await expect(column('In review').getByText('Plan the shoot')).toBeVisible()

  // Board: drag a card to another column.
  await page.getByRole('article').filter({ hasText: 'Book the studio' }).dragTo(column('In progress'))
  await expect(column('In progress').getByText('Book the studio')).toBeVisible()
  await page.reload()
  await expect(column('In progress').getByText('Book the studio')).toBeVisible()

  // List: status tabs, client and owner filters, Mine, search.
  await page.getByRole('tab', { name: 'List' }).click()
  const rows = page.getByRole('table', { name: 'Tasks' }).locator('tbody tr')
  await expect(rows).toHaveCount(3)
  await page.getByRole('tab', { name: 'In review' }).click()
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('Plan the shoot')
  await page.getByRole('tab', { name: 'All', exact: true }).click()
  await expect(rows).toHaveCount(3)
  await page.getByLabel('Client').selectOption(b._id)
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('Draft the launch post')
  await page.getByLabel('Client').selectOption('')
  await page.getByLabel('Owner').selectOption({ label: 'Asha Owner' })
  await expect(rows).toHaveCount(2)
  await page.getByLabel('Owner').selectOption('')
  await page.getByRole('searchbox', { name: 'Search tasks…' }).fill('studio')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('Book the studio')
  await page.getByRole('searchbox', { name: 'Search tasks…' }).fill('nothing like this')
  await expect(page.getByText('No tasks match')).toBeVisible()
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await expect(rows).toHaveCount(3)
  done()
})
