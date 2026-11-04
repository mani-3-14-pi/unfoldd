import { expect, test, type Page } from '@playwright/test'
import { api, clientAdmin, contentInReview, signUpOwner, watchErrors } from '../helpers'

/** Opens a page and checks it rendered: a heading, and never the error screen. */
async function opens(page: Page, path: string) {
  await page.goto(path)
  await expect(page.locator('main h1, main h2').first(), path).toBeVisible()
  await expect(page.getByText('Something went wrong on this page'), path).toHaveCount(0)
}

test('every agency portal page renders', async ({ page }) => {
  test.setTimeout(120_000)
  const done = watchErrors(page)
  await signUpOwner(page)
  const { clientId, contentId } = await contentInReview(page)
  const { task } = await api(page, 'POST', '/tasks', { client: clientId, title: 'Shoot the hero dish' })
  const { campaign } = await api(page, 'POST', '/campaigns', { client: clientId, name: 'Diwali 2026' })
  const { request } = await api(page, 'POST', '/requests', { client: clientId, title: 'Logo in SVG', status: 'open' })

  for (const path of [
    '/app', '/app/notifications', '/app/clients', '/app/content', '/app/review', '/app/feedback', '/app/tasks', '/app/tasks?view=board',
    '/app/calendar', '/app/campaigns', '/app/plans', '/app/requests', '/app/meetings', '/app/analytics', '/app/reports', '/app/team',
    '/app/banners', '/app/templates', '/app/activity', '/app/settings', '/app/account', '/app/support',
    `/app/content/${contentId}`, `/app/tasks/${task._id}`, `/app/campaigns/${campaign._id}`, `/app/requests/${request._id}`,
  ]) {
    await opens(page, path)
  }
  for (const tab of ['', '/content', '/brand', '/campaigns', '/plans', '/requests', '/meetings', '/conversations', '/library', '/integrations', '/team', '/members', '/activity']) {
    await opens(page, `/app/clients/${clientId}${tab}`)
  }
  done()
})

test('every client app page renders', async ({ page, browser }) => {
  test.setTimeout(120_000)
  await signUpOwner(page)
  const { clientId, contentId } = await contentInReview(page)
  const client = await clientAdmin(browser, page, clientId)
  const done = watchErrors(client)

  for (const path of [
    '/c', '/c/content', `/c/content/${contentId}`, '/c/calendar', '/c/requests', '/c/plans', '/c/campaigns', '/c/brand', '/c/library',
    '/c/meetings', '/c/conversations', '/c/analytics', '/c/notifications', '/c/more', '/c/people', '/c/profile', '/c/help',
  ]) {
    await opens(client, path)
  }
  done()
})

test('search finds what you can open, from Ctrl+K', async ({ page }) => {
  const done = watchErrors(page)
  await signUpOwner(page)
  await contentInReview(page)
  await page.goto('/app')
  // The shortcut is registered once the portal has loaded the session and shows the search button.
  await expect(page.getByRole('button', { name: /Search/ })).toBeVisible()
  await page.keyboard.press('Control+k')
  await page.getByRole('combobox', { name: 'Search' }).fill('Diwali')
  await expect(page.getByRole('dialog').getByText('Diwali menu carousel')).toBeVisible()
  done()
})
