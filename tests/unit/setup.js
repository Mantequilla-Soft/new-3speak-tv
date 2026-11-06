// Loaded before every unit and API test file (vitest.config.js setupFiles).
//
// For files that run in jsdom (`// @vitest-environment jsdom`): the jest-dom
// matchers (toBeInTheDocument, toHaveAccessibleName, ...) and an unmount after each
// test, so one test's rendered tree never leaks into the next. Node-environment
// files skip all of it.
import { afterEach, expect } from 'vitest'

if (typeof document !== 'undefined') {
  const matchers = await import('@testing-library/jest-dom/matchers')
  expect.extend(matchers)
  const { cleanup } = await import('@testing-library/react')
  afterEach(() => cleanup())
}
