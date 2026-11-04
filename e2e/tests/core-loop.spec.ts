import { expect, test } from '@playwright/test'
import { api, clientAdmin, contentInReview, headerPill, seedVersionFiles, signUpOwner, watchErrors } from '../helpers'

test('agency: create content, upload V01, review internally and send', async ({ page }) => {
  const done = watchErrors(page)
  await signUpOwner(page)
  const { client } = await api(page, 'POST', '/clients', { name: 'Velvet Oven Foods', brandName: 'Velvet Oven', timezone: 'Asia/Kolkata' })

  await page.goto('/app/content')
  await page.getByRole('button', { name: 'New content' }).first().click()
  await page.selectOption('#ct-client', client._id)
  await page.fill('#ct-title', 'Diwali menu carousel')
  await page.selectOption('#ct-format', 'carousel')
  await page.getByRole('button', { name: 'Create' }).click()
  await page.waitForURL(/\/app\/content\/[0-9a-f]{24}$/)
  await expect(page.getByText('No creative yet')).toBeVisible()

  // R2 isn't available in tests: the version's files go straight into the database.
  const id = page.url().split('/').pop()!
  await api(page, 'POST', `/content/${id}/versions`, { files: await seedVersionFiles(client._id, 3), caption: 'Light up your Diwali' })
  await page.reload()
  await page.getByRole('button', { name: 'Submit V01 for review' }).click()
  await expect(headerPill(page, 'Internal review')).toBeVisible()
  await page.getByRole('button', { name: 'Approve & send' }).click()
  await expect(headerPill(page, 'With client')).toBeVisible()

  // An internal note never shows on the client's side.
  await page.getByRole('tab', { name: /Internal/ }).click()
  await page.getByLabel('Internal note').fill('Logo is a little small.')
  await page.getByRole('button', { name: 'Add note' }).click()
  await expect(page.getByText('Logo is a little small.')).toBeVisible()
  done()
})

test('client: comments, requests changes, then approves V02; agency schedules and publishes', async ({ page, browser }) => {
  const done = watchErrors(page)
  await signUpOwner(page)
  const { clientId, contentId } = await contentInReview(page)
  const client = await clientAdmin(browser, page, clientId)
  const clientDone = watchErrors(client)

  // Home shows the review in Needs Attention.
  await expect(client.getByText('Diwali menu carousel').first()).toBeVisible()
  await client.goto(`/c/content/${contentId}`)
  await client.getByLabel('Your comment').fill('Please make the diya brighter.')
  await client.getByRole('button', { name: 'Add comment' }).click()
  await expect(client.getByText('Please make the diya brighter.')).toBeVisible()
  await client.getByRole('button', { name: /^(Changes|Request changes)$/ }).click()
  await client.getByRole('dialog').getByRole('button', { name: 'Request changes' }).click()
  await expect(client.getByText('Changes Requested').first()).toBeVisible()

  // The agency sees it, answers with V02 and sends it.
  await page.goto(`/app/content/${contentId}`)
  await expect(headerPill(page, 'Changes requested')).toBeVisible()
  await expect(page.getByText('Please make the diya brighter.')).toBeVisible()
  await api(page, 'POST', `/content/${contentId}/versions`, { files: await seedVersionFiles(clientId, 2), caption: 'Light up your Diwali ✨' })
  await api(page, 'POST', `/content/${contentId}/submit`)
  await api(page, 'POST', `/content/${contentId}/internal-review`, { decision: 'approve_and_send' })

  // The client approves the exact version.
  await client.goto(`/c/content/${contentId}`)
  await client.getByRole('button', { name: 'Approve', exact: true }).click()
  await client.getByRole('dialog').getByRole('button', { name: /^Approve V02/ }).click()
  await expect(client.getByText(/Approved/).first()).toBeVisible()

  // Schedule (manual account), then mark it published.
  await page.reload()
  await expect(headerPill(page, 'Approved')).toBeVisible()
  await page.getByRole('button', { name: 'Schedule', exact: true }).click()
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
  await page.fill('#sch-at', `${tomorrow}T19:00`)
  await page.getByRole('dialog').getByRole('button', { name: 'Schedule' }).click()
  await expect(headerPill(page, 'Scheduled')).toBeVisible()
  await page.getByRole('button', { name: 'Mark as published' }).click()
  await page.fill('#pub-url', 'https://www.instagram.com/p/e2e/')
  await page.getByRole('button', { name: 'Mark published' }).click()
  await expect(headerPill(page, 'Published')).toBeVisible()
  done()
  clientDone()
})

test('client: approves a monthly content plan', async ({ page, browser }) => {
  const done = watchErrors(page)
  await signUpOwner(page)
  const { client } = await api(page, 'POST', '/clients', { name: 'Velvet Oven Foods', brandName: 'Velvet Oven', timezone: 'Asia/Kolkata' })
  const month = new Date(Date.now() + 32 * 86_400_000).toISOString().slice(0, 7)
  const { plan } = await api(page, 'POST', '/plans', { client: client._id, month })
  await api(page, 'POST', `/plans/${plan._id}/items/bulk`, { groups: [{ platform: 'instagram', format: 'feed_4x5', count: 3 }] })
  await api(page, 'POST', `/plans/${plan._id}/send`)

  const c = await clientAdmin(browser, page, client._id)
  const clientDone = watchErrors(c)
  await c.goto(`/c/plans/${plan._id}`)
  await c.getByRole('button', { name: /^Approve/ }).first().click()
  const confirm = c.getByRole('dialog').getByRole('button', { name: /^Approve/ })
  if (await confirm.count()) await confirm.click()
  await expect(c.getByText(/Approved/).first()).toBeVisible()

  await page.goto(`/app/plans/${plan._id}`)
  await expect(page.getByText(/Approved/).first()).toBeVisible()
  done()
  clientDone()
})
