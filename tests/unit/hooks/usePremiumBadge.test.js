// PRO badges (src/hooks/usePremiumStatus.js usePremiumBadge): every badge on a
// page answers from ONE list of Pro accounts instead of a lookup per creator.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let mod
let fetchMock
const json = (body, ok = true) => Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) })

beforeEach(async () => {
  vi.resetModules()
  fetchMock = vi.fn()
  globalThis.fetch = fetchMock
  mod = await import('../../../src/hooks/usePremiumStatus.js')
})

async function badges(names) {
  const out = {}
  const Probe = ({ name }) => { out[name] = mod.usePremiumBadge(name); return null }
  const root = createRoot(document.createElement('div'))
  await act(async () => { root.render(names.map((n) => createElement(Probe, { key: n, name: n }))) })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  root.unmount()
  return out
}

describe('usePremiumBadge', () => {
  it('answers every badge from one list request', async () => {
    fetchMock.mockImplementation((url) => (url.includes('/premium?')
      ? json({ count: 2, subscribers: [{ username: 'Alice' }, { username: 'bob' }] })
      : json({ premium: true })))
    const out = await badges(['alice', 'bob', 'carol', 'dave'])
    expect(out).toEqual({ alice: true, bob: true, carol: false, dave: false })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to single lookups when the list is unavailable', async () => {
    fetchMock.mockImplementation((url) => (url.includes('/premium?')
      ? json({}, false)
      : json({ premium: url.endsWith('/alice') })))
    const out = await badges(['alice', 'carol'])
    expect(out).toEqual({ alice: true, carol: false })
    expect(fetchMock.mock.calls.map((c) => c[0].split('/premium')[1])).toEqual(expect.arrayContaining(['/alice', '/carol']))
  })
})
