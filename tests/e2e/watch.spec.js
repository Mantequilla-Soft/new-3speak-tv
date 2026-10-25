// The watch page, reached the way a visitor does: from a video card on Discover.
import { test, expect, watchLinks, PROFILE_LINK } from './fixtures.js'

test.beforeEach(async ({ page }) => {
  await page.goto('/discover')
  const [first] = await watchLinks(page, 1)
  await page.goto(first)
})

test('shows the title, the author and the player', async ({ page }) => {
  await expect(page).toHaveURL(/\/@[^/]+\/[^/]+/)
  await expect(page).toHaveTitle(/^3S \| .{3,}/)
  await expect(page.locator(`${PROFILE_LINK} >> visible=true`).first()).toBeVisible()
  await expect(page.locator('video').first()).toBeAttached()
})

test('the Share menu offers the link and the embed code', async ({ page }) => {
  await page.getByRole('button', { name: /^share$/i }).first().click()
  await expect(page.getByText(/embed/i).first()).toBeVisible()
})

test('the author link opens the channel', async ({ page }) => {
  const author = page.locator(`${PROFILE_LINK} >> visible=true`).first()
  const href = await author.getAttribute('href')
  await author.click()
  await expect(page).toHaveURL(new RegExp(href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
})
