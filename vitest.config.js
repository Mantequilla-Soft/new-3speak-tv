import { defineConfig } from 'vitest/config'

// Unit tests (tests/unit) and API tests (tests/server). The browser tests in
// tests/e2e run with Playwright instead (playwright.config.js).
//
// Deliberately not built on vite.config.js: the app's PWA and polyfill plugins only
// slow the tests down. Code that reads import.meta.env sees no VITE_* values here
// (no .env is loaded), so tests set what they need with vi.stubEnv().
export default defineConfig({
  envDir: false,
  test: {
    include: ['tests/unit/**/*.test.{js,jsx}', 'tests/server/**/*.test.js'],
    environment: 'node',
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    // The API tests start the real server as a child process.
    testTimeout: 20000,
  },
})
