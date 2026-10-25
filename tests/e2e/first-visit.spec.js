// What a visitor meets before doing anything: the cookie banner, the update popup,
// the login chooser and the language.
import { test, expect, APP_VERSION, VIDEO_LINK } from './fixtures.js'
import es from '../../src/locales/es/common.json' with { type: 'json' }

test.describe('cookie banner', () => {
  test.use({ fresh: true })

  test('appears on a first visit and stays gone once answered', async ({ page }) => {
    await page.goto('/')
    const banner = page.locator('.cookie-consent')
    await expect(banner).toBeVisible()
    await banner.getByRole('button').last().click()
    await expect(banner).toBeHidden()
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('3speak_cookie_consent')))
    expect(stored).toMatchObject({ essential: true })
    await page.reload()
    await expect(page.locator(VIDEO_LINK).first()).toBeVisible()
    await expect(banner).toBeHidden()
  })
})

test('a returning user on an older version sees the update popup once', async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('e2e-old-version')) {
      sessionStorage.setItem('e2e-old-version', '1')
      localStorage.setItem('3speak_app_version', '1.0.0')
    }
  })
  await page.goto('/')
  const modal = page.locator('.changelog-modal')
  await expect(modal).toBeVisible()
  await expect(modal).toContainText('We shipped an update!')
  await expect(modal.locator('.changelog-entry-version').first()).toContainText(APP_VERSION)
  await modal.locator('.changelog-close').click()
  await expect(modal).toBeHidden()
  expect(await page.evaluate(() => localStorage.getItem('3speak_app_version'))).toBe(APP_VERSION)
  await page.reload()
  await expect(page.locator(VIDEO_LINK).first()).toBeVisible()
  await expect(modal).toBeHidden()
})

test('Log in offers Butter Auth and the Hive wallets', async ({ page }) => {
  await page.goto('/')
  await page.locator('.nav-guest-login:visible').first().click()
  await expect(page.getByRole('heading', { name: 'Login to 3Speak' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Butter Auth/ })).toBeVisible()
  // Keychain is only listed when its browser extension is installed.
  for (const wallet of ['HiveAuth', 'HiveSigner']) {
    await expect(page.getByRole('listitem').filter({ hasText: wallet })).toBeVisible()
  }
  await page.getByRole('button', { name: 'Close modal' }).click()
  await expect(page.getByRole('heading', { name: 'Login to 3Speak' })).toBeHidden()
})

test.describe('language', () => {
  test.use({ lang: 'es' })

  test('a saved language translates the interface', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.nav-guest-login').first()).toContainText(es.actions.login)
    expect(await page.evaluate(() => document.documentElement.lang)).toMatch(/^es/)
  })
})
