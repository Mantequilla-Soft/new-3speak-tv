import { defineConfig, devices } from '@playwright/test'

// Browser tests (tests/e2e). By default they build the app and serve the build
// locally; the pages then load real data from the public 3Speak and Hive APIs, so
// no .env is needed. Point them at a deployed site instead with
//   E2E_BASE_URL=https://preview.3speak.tv npm run test:e2e
// E2E_CHROME=/path/to/chrome uses a local Chrome instead of Playwright's Chromium
// (Playwright's Chromium cannot play H.264 video).
const BASE_URL = process.env.E2E_BASE_URL
const CI = !!process.env.CI

// The feature switches 3speak.tv is built with, so the local build shows the same
// pages (ads, editor, Pro, Butter Auth, the warm-up rail). Live streams stay off, as on prod.
const PROD_FLAGS = {
  VITE_ENABLE_ADS: 'true',
  VITE_SHORTS_ADS: 'true',
  VITE_FEATURE_EDITOR: 'true',
  VITE_COMPACT_SIDEBAR: 'true',
  VITE_ENABLE_SUBS: 'true',
  VITE_ENABLE_PRO_TESTING: 'true',
  VITE_ENABLE_BUTRAUTH: 'true',
  VITE_ENABLE_WARMUP_RAIL: 'true',
}

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 20_000 },
  // Live APIs are involved, so allow one retry on CI before calling it a failure.
  retries: CI ? 1 : 0,
  workers: 2,
  reporter: CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL || 'http://localhost:4173',
    locale: 'en-US',
    colorScheme: 'dark',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.E2E_CHROME
      ? { executablePath: process.env.E2E_CHROME, args: ['--no-sandbox'] }
      : {},
  },
  projects: [
    {
      name: 'desktop',
      testIgnore: /mobile\.spec\.js/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile',
      testMatch: /mobile\.spec\.js/,
      use: { ...devices['Pixel 7'] },
    },
  ],
  webServer: BASE_URL
    ? undefined
    : {
        command: 'npm run build && npx vite preview --port 4173 --strictPort',
        url: 'http://localhost:4173',
        env: PROD_FLAGS,
        reuseExistingServer: !CI,
        timeout: 300_000,
      },
})
