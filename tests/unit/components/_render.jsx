/* eslint-disable react-refresh/only-export-components -- a test helper, never hot-reloaded */
// Shared helpers for the component and page tests (jsdom).
//
// renderWithProviders wraps a tree the way the app does: Helmet, a MemoryRouter
// at a chosen route and a fresh TanStack Query client that never retries, so a failed
// query shows its error state at once. English strings come from the real i18n
// setup, so tests query by the text and accessible names a person sees.
//
// The *Module() factories build stand-ins for modules that would otherwise talk
// to Hive or the network when imported. Use them from a vi.mock factory:
//
//   vi.mock('../../../src/hive-api/aioha', async () => (await import('./_render.jsx')).aiohaModule())
import { vi } from 'vitest'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import '../../../src/i18n'

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  })
}

// Shows where the router is, so a test can assert that a click navigated.
export function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="location" hidden>{loc.pathname + loc.search}</div>
}

/**
 * @param ui         the element under test
 * @param route      the URL the MemoryRouter starts at
 * @param path       a route pattern; when given, `ui` is rendered as that route's element
 * @param queryClient an existing client (to pre-seed data); a fresh one otherwise
 * @param fakeTimers true when the test uses fake timers, so userEvent advances them.
 *                   Those tests must call useFakeClock() (below), not plain
 *                   vi.useFakeTimers(): Testing Library waits on a setTimeout(0)
 *                   after every event and only knows how to advance Jest's clock.
 */
export function renderWithProviders(ui, { route = '/', path, queryClient = makeQueryClient(), fakeTimers = false } = {}) {
  // With fake timers, user-event must not wait on a real clock between steps.
  const user = userEvent.setup(fakeTimers ? { delay: null, advanceTimers: (ms) => vi.advanceTimersByTime(ms) } : {})
  const tree = path
    ? <Routes><Route path={path} element={ui} /><Route path="*" element={null} /></Routes>
    : ui
  const result = render(
    <HelmetProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>
          {tree}
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>,
  )
  return { user, queryClient, ...result }
}

// Fake timers that still move on with the real clock, so Testing Library's own
// short waits finish. Timers the test cares about are driven with
// vi.advanceTimersByTime as usual.
export function useFakeClock(opts = {}) {
  vi.useFakeTimers({ shouldAdvanceTime: true, ...opts })
}

// The aioha (Hive wallet) module. The real one registers wallet providers and
// probes Hive nodes when imported. `isLoggedIn` is a vi.fn so a test can sign in.
export function aiohaModule(overrides = {}) {
  const ok = async () => ({ success: true })
  const aioha = {
    getCurrentUser: vi.fn(() => null),
    getCurrentProvider: vi.fn(() => null),
    switchUser: vi.fn(() => true),
    logout: vi.fn(),
    removeOtherLogin: vi.fn(),
    getOtherLogins: vi.fn(() => ({})),
    loadAuth: vi.fn(),
    login: vi.fn(ok),
    isLoggedIn: vi.fn(() => false),
    on: vi.fn(),
    off: vi.fn(),
  }
  return {
    default: aioha,
    isLoggedIn: vi.fn(() => false),
    getCurrentUser: vi.fn(() => null),
    getCurrentProvider: vi.fn(() => null),
    getOperationUser: vi.fn(() => null),
    isHiveAuthProvider: vi.fn(() => false),
    isManteAuthLogin: vi.fn(() => false),
    isSessionMismatch: vi.fn(() => false),
    keychainReady: vi.fn(async () => false),
    setHiveAuthCallbacks: vi.fn(),
    setActiveAuthHandler: vi.fn(),
    withHiveAuthWaiting: vi.fn((op) => op()),
    withTimeout: vi.fn((p) => p),
    voteWithAioha: vi.fn(ok),
    commentWithAioha: vi.fn(ok),
    customJsonWithAioha: vi.fn(ok),
    followWithAioha: vi.fn(ok),
    reblogWithAioha: vi.fn(ok),
    transferWithAioha: vi.fn(ok),
    broadcastWithAioha: vi.fn(ok),
    broadcastViaThreespeak: vi.fn(ok),
    broadcastViaManteAuth: vi.fn(ok),
    signMessageWithAioha: vi.fn(ok),
    tagVideoWithAioha: vi.fn(ok),
    awardBadgeWithAioha: vi.fn(ok),
    establishWalletSession: vi.fn(ok),
    endWalletSession: vi.fn(ok),
    syncWalletSession: vi.fn(ok),
    VIEWER_TAG_CJ_ID: '3speak-viewer-tag',
    Providers: { Keychain: 'keychain', HiveSigner: 'hivesigner', HiveAuth: 'hiveauth', Ledger: 'ledger', PeakVault: 'peakvault' },
    ...overrides,
  }
}

// sonner, the toast library behind utils/toast.js. toastIn('X').success(msg)
// reaches sonner.success('X', { description: msg }), so tests read the message
// from the second argument (see toastMessages).
export function sonnerModule() {
  const toast = vi.fn()
  for (const m of ['success', 'error', 'warning', 'info', 'loading', 'message', 'dismiss', 'custom', 'promise']) toast[m] = vi.fn()
  return { toast, Toaster: () => null }
}

// Every message one sonner method was called with (the description line).
export function toastMessages(fn) {
  return fn.mock.calls.map(([title, opts]) => opts?.description ?? title)
}

// A clipboard the test can read back. navigator.clipboard is a getter in jsdom,
// so it is replaced with defineProperty and put back by the returned restore().
export function stubClipboard({ fail = false } = {}) {
  const writeText = vi.fn(async () => { if (fail) throw new Error('denied') })
  const before = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  return {
    writeText,
    restore: () => {
      if (before) Object.defineProperty(navigator, 'clipboard', before)
      else delete navigator.clipboard
    },
  }
}

// window.matchMedia does not exist in jsdom. `matches` decides every query, or
// pass a function of the query string.
export function stubMatchMedia(matches = false) {
  const decide = typeof matches === 'function' ? matches : () => matches
  vi.stubGlobal('matchMedia', vi.fn((query) => ({
    matches: decide(query), media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })))
}
