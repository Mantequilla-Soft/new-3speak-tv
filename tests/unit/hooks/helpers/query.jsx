// Shared by the hook tests that use TanStack Query: a fresh client per test (no
// retries, no cache carried between tests) and a wrapper for renderHook.
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

export function newQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } })
}

export function queryWrapper(client = newQueryClient()) {
  const Wrapper = ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper: Wrapper }
}

// A matchMedia stand-in whose answer a test can flip; `change` fires the listeners.
export function fakeMatchMedia(initial = false) {
  let matches = initial
  const listeners = new Set()
  const mql = (query) => ({
    media: query,
    get matches() { return matches },
    addEventListener: (_e, fn) => listeners.add(fn),
    removeEventListener: (_e, fn) => listeners.delete(fn),
  })
  return {
    install() { window.matchMedia = mql },
    change(next) { matches = next; for (const fn of [...listeners]) fn({ matches }) },
    get listenerCount() { return listeners.size },
  }
}
