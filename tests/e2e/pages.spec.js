// Every public page opens without a JavaScript error and shows its content.
import { test, expect, VIDEO_LINK, PROFILE_LINK } from './fixtures.js'

const withVideos = ['/', '/discover', '/new', '/trend']
for (const path of withVideos) {
  test(`${path} lists videos`, async ({ page }) => {
    await page.goto(path)
    await expect(page.locator(VIDEO_LINK).first()).toBeVisible()
    await expect(page).toHaveTitle(/^3S/)
  })
}

const pages = [
  ['/shorts', 'video'],
  ['/audio', 'h1, h2'],
  ['/groups', 'h3'],
  ['/leaderboard', PROFILE_LINK],
  ['/advertise', 'h1, h2'],
  ['/faq', 'h1, h2'],
  ['/about', 'h1, h2'],
  ['/@threespeak', VIDEO_LINK],
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

test('old /p/ and /user/ links move to the Hive-style address', async ({ page }) => {
  for (const old of ['/p/threespeak', '/user/threespeak']) {
    await page.goto(old)
    await expect(page).toHaveURL(/\/@threespeak$/)
  }
})
