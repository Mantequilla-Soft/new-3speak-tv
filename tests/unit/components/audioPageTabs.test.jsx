// The audio page on phones and tablets: Player | Explore tabs. A bare /audio
// opens on Player while something is loaded in the player, on Explore otherwise;
// a link into the page (a podcast, an episode, a tag) always opens Explore.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }))
window.matchMedia = (q) => ({ matches: q.includes('max-width: 1024px'), media: q, addEventListener() {}, removeEventListener() {} })

vi.mock('axios', () => {
  const ok = async () => ({ data: {} })
  return { default: { get: ok, post: ok, create: () => ({ get: ok, post: ok, interceptors: { request: { use() {} }, response: { use() {} } } }), interceptors: { request: { use() {} }, response: { use() {} } } } }
})

let useAppStore
let Audio
let where = ''
function Where() { where = useLocation().search; return null }

beforeAll(async () => {
  ;({ useAppStore } = await import('../../../src/lib/store'))
  ;({ default: Audio } = await import('../../../src/page/Audio.jsx'))
})

afterEach(() => {
  act(() => { useAppStore.getState().audioSetDock(null); useAppStore.getState().audioStop() })
  document.body.innerHTML = ''
  localStorage.clear()
})

function open(path) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={[path]}><Audio /><Where /></MemoryRouter>
      </QueryClientProvider>,
    )
  })
  const tabs = [...host.querySelectorAll('[role="tab"]')]
  return { host, root, tabs, selected: tabs.findIndex((b) => b.getAttribute('aria-selected') === 'true') }
}

const track = { _id: 'a1', owner: 'alice', permlink: 'p1', title: 'Song', audio_cid: 'Qm1', duration: 100 }

describe('audio page tabs', () => {
  it('puts Player first and opens it when something is loaded', () => {
    act(() => { useAppStore.getState().audioPlay(track) })
    const { host, root, tabs, selected } = open('/audio')
    expect(tabs).toHaveLength(2)
    expect(selected).toBe(0)
    expect(where).toContain('player=1')
    expect(host.querySelector('.audio-player-dock')).toBeTruthy()
    act(() => root.unmount())
  })

  it('opens Explore when the player is empty', () => {
    const { root, selected } = open('/audio')
    expect(selected).toBe(1)
    expect(where).not.toContain('player=1')
    act(() => root.unmount())
  })

  it('opens Explore for a link into the page, even while something plays', () => {
    act(() => { useAppStore.getState().audioPlay(track) })
    const { root, selected } = open('/audio?type=external&podcast=f1')
    expect(selected).toBe(1)
    act(() => root.unmount())
  })
})
