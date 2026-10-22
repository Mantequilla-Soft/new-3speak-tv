// Every public page opens without a JavaScript error and shows its content.
import { test, expect } from './fixtures.js'

const withVideos = ['/', '/discover', '/new', '/trend']
for (const path of withVideos) {
  test(`${path} lists videos`, async ({ page }) => {
    await page.goto(path)
    await expect(page.locator('a[href*="/watch?v="]').first()).toBeVisible()
    await expect(page).toHaveTitle(/^3S/)
  })
}

const pages = [
  ['/shorts', 'video'],
  ['/audio', 'h1, h2'],
  ['/groups', 'h3'],
  ['/leaderboard', 'a[href^="/user/"]'],
  ['/advertise', 'h1, h2'],
  ['/faq', 'h1, h2'],
  ['/about', 'h1, h2'],
  ['/p/threespeak', 'a[href*="/watch?v="]'],
]
for (const [path, selector] of pages) {
  test(`${path} opens`, async ({ page }) => {
    await page.goto(path)
    await expect(page.locator(selector).first()).toBeVisible()
  })
}

test('an unknown page shows the not-found page', async ({ page }) => {
  await page.goto('/this-page-does-not-exist-e2e')
  await expect(page.locator('.not-found-container')).toBeVisible()
})

test('Hive-style links lead to the profile', async ({ page }) => {
  await page.goto('/@threespeak')
  await expect(page).toHaveURL(/\/p\/threespeak$/)
})
