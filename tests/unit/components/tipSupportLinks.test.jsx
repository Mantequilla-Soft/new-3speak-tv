// The tip window's "More ways" links (useSupportLinks in OtherWays.jsx): when the
// window switches creator, the previous creator's links must not stay on screen.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'

const pending = vi.hoisted(() => new Map())
vi.mock('../../../src/lib/supportLinks', () => ({
  readSupportLinks: (user) => new Promise((resolve, reject) => pending.set(user, { resolve, reject })),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { useSupportLinks } = await import('../../../src/components/tip-reward/OtherWays.jsx')

let root
let seen
function Probe({ recipient }) { seen = useSupportLinks(recipient); return null }
const show = (recipient) => act(() => { root.render(createElement(Probe, { recipient })) })
const kofi = (user) => [{ url: `https://ko-fi.com/${user}`, site: { id: 'kofi', label: 'Ko-fi' } }]

beforeEach(() => { pending.clear(); root = createRoot(document.createElement('div')) })
afterEach(() => act(() => root.unmount()))

describe('useSupportLinks', () => {
  it('shows the links once they load', async () => {
    show('badadib')
    expect(seen).toEqual([])
    await act(async () => pending.get('badadib').resolve(kofi('badadib')))
    expect(seen).toEqual(kofi('badadib'))
  })

  it('drops the previous creator\'s links at once when the recipient changes', async () => {
    show('badadib')
    await act(async () => pending.get('badadib').resolve(kofi('badadib')))
    show('alice')
    expect(seen).toEqual([])
    // Even when the new lookup fails.
    await act(async () => pending.get('alice').reject(new Error('node blip')))
    expect(seen).toEqual([])
  })

  it('ignores a late answer for a creator the window already left', async () => {
    show('badadib')
    show('alice')
    await act(async () => pending.get('badadib').resolve(kofi('badadib')))
    expect(seen).toEqual([])
    await act(async () => pending.get('alice').resolve(kofi('alice')))
    expect(seen).toEqual(kofi('alice'))
  })
})
