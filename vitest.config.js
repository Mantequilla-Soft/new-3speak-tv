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
    setupFiles: ['tests/unit/setup.js'],
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    // The API tests start the real server as a child process.
    testTimeout: 20000,
    // `npm run test:coverage`. Only the app's own logic is measured: translations,
    // assets and the entry points (main.jsx, the service worker) are not code paths
    // a unit test can meaningfully exercise. The API server runs as a child
    // process, so it is covered by its own tests but not measured here.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{js,jsx}'],
      exclude: [
        'src/locales/**',
        'src/assets/**',
        'src/main.jsx',
        'src/sw.js',
        'src/polyfills.js',
        'src/changelog.js',
        // JSX in a .js file: the coverage remapper cannot parse it (a PARSE_ERROR
        // in every run) and it holds only icon markup.
        'src/icons/svg.js',
      ],
      reporter: ['text-summary', 'lcov', 'json-summary'],
      // Ratchet: raise these with the suite, never lower them to make a run pass.
      thresholds: { lines: 37, statements: 36, functions: 31, branches: 32 },
    },
  },
})
