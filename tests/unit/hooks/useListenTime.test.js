// Listening time (src/hooks/useListenTime.js): the global audio player opens a
// session when a track plays and sends beats, for 3Speak audio and outside episodes.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'

vi.mock('../../../src/lib/store', () => ({ useAppStore: { getState: () => ({ privateMode: false }) } }))
vi.mock('../../../src/utils/config', () => ({ CHECKER_URL: 'https://checker.test' }))
const rewards = vi.hoisted(() => ({ name: null }))
vi.mock('../../../src/utils/viewerRewards', () => ({ listenerRewardsName: async () => rewards.name }))
vi.mock('../../../src/lib/podcasts', () => ({ listenVouch: async (u) => ({ user: u, signature: 'sig', timestamp: 123 }) }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let mod
let fetchMock
let root
let container
const calls = (path) => fetchMock.mock.calls.filter(([url]) => url.endsWith(path)).map(([, o]) => JSON.parse(o.body))

function fakeAudio() {
  const el = new EventTarget()
  Object.assign(el, { currentTime: 0, duration: 600, paused: true, playbackRate: 1 })
  return el
}

function mount(el, track, elementKey) {
  const ref = { current: el }
  function Probe({ t, k }) { mod.default(ref, t, k); return null }
  act(() => { root.render(createElement(Probe, { t: track, k: elementKey })) })
  return (t, k = elementKey, nextEl) => act(() => {
    if (nextEl) ref.current = nextEl
    root.render(createElement(Probe, { t, k }))
  })
}

beforeEach(async () => {
  rewards.name = null
  vi.resetModules()
  fetchMock = vi.fn(async (url) => ({
    ok: true,
    json: async () => (url.endsWith('/start') ? { sid: 's1', token: 't1', beatSeconds: 10 } : {}),
  }))
  globalThis.fetch = fetchMock
  mod = await import('../../../src/hooks/useListenTime.js')
  container = document.createElement('div')
  root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); vi.useRealTimers() })

describe('which item a track is', () => {
  it('3Speak audio by its permlink, an outside episode by its id', () => {
    expect(mod._test.itemOf({ permlink: 'abc123' })).toEqual({ kind: 'audio', id: 'abc123' })
    expect(mod._test.itemOf({ external: true, _id: '6ae3c77f91d7738e82354365:Igp2yAbCdEfGhIjK' }))
      .toEqual({ kind: 'podcast', id: '6ae3c77f91d7738e82354365:Igp2yAbCdEfGhIjK' })
    expect(mod._test.itemOf(null)).toBeNull()
  })

  it('a live stream is not measured', () => {
    expect(mod._test.itemOf({ external: true, live: true, _id: 'live:feed:1' })).toBeNull()
  })
})

describe('the beats', () => {
  it('opens a session on play, beats while playing, and credits the stretch before a seek', async () => {
    vi.useFakeTimers({ now: 0 })
    const el = fakeAudio()
    mount(el, { external: true, _id: '6ae3c77f91d7738e82354365:Igp2yAbCdEfGhIjK' })
    el.paused = false
    await act(async () => { el.dispatchEvent(new Event('play')) })
    expect(calls('/audio/listen/start')[0]).toMatchObject({ kind: 'podcast', source: '3speak', duration: 600, private: false })

    // Under the beat interval: nothing yet. Past it: one beat with the position.
    vi.setSystemTime(5000); el.currentTime = 5; el.dispatchEvent(new Event('timeupdate'))
    expect(calls('/audio/listen/beat')).toHaveLength(0)
    vi.setSystemTime(10500); el.currentTime = 10.5; el.dispatchEvent(new Event('timeupdate'))
    expect(calls('/audio/listen/beat')).toEqual([expect.objectContaining({ sid: 's1', token: 't1', position: 10.5 })])

    // A seek: the beat names where playback WAS, not where it jumped to.
    el.currentTime = 12; el.dispatchEvent(new Event('timeupdate'))
    el.currentTime = 300; el.dispatchEvent(new Event('seeking'))
    expect(calls('/audio/listen/beat').at(-1).position).toBe(12)
  })

  it('a track change sends the last beat of the old session and starts over', async () => {
    const el = fakeAudio()
    const rerender = mount(el, { permlink: 'one' })
    el.paused = false
    await act(async () => { el.dispatchEvent(new Event('play')) })
    el.currentTime = 42; el.dispatchEvent(new Event('timeupdate'))
    await act(async () => { rerender({ permlink: 'two' }) })
    expect(calls('/audio/listen/beat').at(-1)).toMatchObject({ sid: 's1', position: 42 })
    // Still playing on the new track: it opens its own session right away.
    expect(calls('/audio/listen/start').map((b) => b.id)).toEqual(['one', 'two'])
  })
})

describe('who is listening', () => {
  it('is nobody, unless the listener agreed to listener rewards', async () => {
    const el = fakeAudio()
    mount(el, { permlink: 'one' })
    el.paused = false
    await act(async () => { el.dispatchEvent(new Event('play')) })
    expect(calls('/audio/listen/start')[0]).not.toHaveProperty('listener')
  })

  it('is named, with our API\'s proof, for someone who agreed', async () => {
    rewards.name = 'alice'
    const el = fakeAudio()
    mount(el, { permlink: 'one' })
    el.paused = false
    await act(async () => { el.dispatchEvent(new Event('play')) })
    expect(calls('/audio/listen/start')[0]).toMatchObject({ listener: 'alice', listenerSig: 'sig', listenerTs: 123 })
  })
})

describe('the player swapping its element', () => {
  it('keeps the same session on the new element and beats with its real rate', async () => {
    vi.useFakeTimers({ now: 0 })
    const first = fakeAudio()
    const track = { permlink: 'one' }
    const rerender = mount(first, track, 'plain')
    first.paused = false
    await act(async () => { first.dispatchEvent(new Event('play')) })
    first.currentTime = 20; first.dispatchEvent(new Event('timeupdate'))

    // Voice boost switched on: a routed element takes over at the same spot.
    const second = fakeAudio()
    Object.assign(second, { currentTime: 20, paused: false, playbackRate: 3.75 })
    await act(async () => { rerender(track, 'fx', second) })
    expect(calls('/audio/listen/beat').at(-1)).toMatchObject({ sid: 's1', position: 20 })

    vi.setSystemTime(11000); second.currentTime = 45; second.dispatchEvent(new Event('timeupdate'))
    expect(calls('/audio/listen/start')).toHaveLength(1)
    expect(calls('/audio/listen/beat').at(-1)).toMatchObject({ sid: 's1', position: 45, rate: 3.75 })

    // The old element's events no longer count.
    first.currentTime = 99; first.dispatchEvent(new Event('pause'))
    expect(calls('/audio/listen/beat').at(-1).position).toBe(45)
  })
})
