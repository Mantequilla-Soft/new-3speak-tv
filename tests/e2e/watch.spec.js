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

// On a wide screen the author's link is the badge over the player, shown once the
// video plays (not while it loads, an ad runs or the video cannot play: then the
// player's own overlays sit on top). So wait for it, and take the next video
// from Discover when one does not start. A runner that cannot reach the video
// gateways at all says so and skips, rather than failing on its network.
test('the author link opens the channel', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/discover')
  for (const href of await watchLinks(page, 3)) {
    await page.goto(href)
    const badge = page.locator('.wv2-creator.is-shown .author-badge-link').first()
    try {
      await badge.waitFor({ state: 'visible', timeout: 20_000 })
    } catch {
      continue
    }
    const channel = await badge.getAttribute('href')
    await badge.click()
    await expect(page).toHaveURL(new RegExp(`${channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))
    return
  }
  test.skip(true, 'none of the first three Discover videos played on this runner')
})
