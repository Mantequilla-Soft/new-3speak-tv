// The phone layout: the bottom navigation, and no page that scrolls sideways (the
// usual cause when a fixed button or popup ends up off-screen).
import { test, expect, watchLinks } from './fixtures.js'

test('the bottom navigation is there and opens Shorts', async ({ page }) => {
  await page.goto('/')
  const nav = page.locator('nav.bottom-nav')
  await expect(nav).toBeVisible()
  await expect(nav.locator('a, button')).toHaveCount(5)
  await nav.locator('.bottom-nav-icon--shorts').click()
  await expect(page).toHaveURL(/\/shorts/)
})

async function expectNoSidewaysScroll(page) {
  const { scroll, width } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    width: window.innerWidth,
  }))
  expect(scroll, 'page is wider than the screen').toBeLessThanOrEqual(width)
}

for (const path of ['/', '/discover', '/shorts', '/audio', '/groups', '/advertise']) {
  test(`${path} fits the screen`, async ({ page }) => {
    await page.goto(path)
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
    await expectNoSidewaysScroll(page)
  })
}

test('the watch page fits the screen', async ({ page }) => {
  await page.goto('/discover')
  const [first] = await watchLinks(page, 1)
  await page.goto(first)
  await expect(page.locator('video').first()).toBeAttached()
  await expectNoSidewaysScroll(page)
})
