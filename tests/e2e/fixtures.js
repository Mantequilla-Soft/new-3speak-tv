// Shared setup for the browser tests: a first-time visitor who already answered the
// cookie banner and the welcome prompts, in English, on the current app version, so
// pages open without popups. A test can opt out with test.use({ fresh: true }).
// Every test fails on an uncaught JavaScript error in the page. Console errors from
// the network (CORS on localhost, a missing thumbnail) are expected and ignored.
import { test as base, expect } from '@playwright/test'
import { APP_VERSION } from '../../src/version.js'

export const test = base.extend({
  fresh: [false, { option: true }],
  lang: ['en', { option: true }],

  page: async ({ page, fresh, lang }, use) => {
    await page.addInitScript(
      ({ fresh, lang, version }) => {
        try {
          if (sessionStorage.getItem('e2e-primed')) return
          sessionStorage.setItem('e2e-primed', '1')
          localStorage.setItem('3speak_lang', lang)
          if (fresh) return
          localStorage.setItem('3speak_cookie_consent', JSON.stringify({
            version: 1, essential: true, functional: true, advertising: false,
            decidedAt: new Date().toISOString(),
          }))
          localStorage.setItem('3speak_app_version', version)
          localStorage.setItem('3speak_welcome_closed', '1')
          localStorage.setItem('3speak_welcomed', '1')
          localStorage.setItem('3speak_interests_prompted', '1')
        } catch { /* storage blocked */ }
      },
      { fresh, lang, version: APP_VERSION },
    )

    const errors = []
    page.on('pageerror', (err) => errors.push(err.message))
    await use(page)
    expect(errors, 'uncaught errors in the page').toEqual([])
  },
})

export { expect, APP_VERSION }

// The first few /watch links on the current page.
export async function watchLinks(page, n = 5) {
  const links = page.locator('a[href*="/watch?v="]')
  await expect(links.first()).toBeVisible()
  return (await links.evaluateAll((as) => as.map((a) => a.getAttribute('href')))).slice(0, n)
}
