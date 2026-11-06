// The watch-time heartbeat (src/hooks/useWatchDuration.js): a measured session
// opened on the first real play (embed first, then legacy), beats while the video
// plays in the front tab, a final beat on pause, tab-hide, page-hide and unmount,
// nothing counted for a short video in a background tab, long-form kept counting
// there, and ad seconds kept out of the position.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../../../src/utils/playerUrl', () => ({ getPlayerUrl: () => 'https://player.test' }))
const store = vi.hoisted(() => ({ privateMode: false }))
vi.mock('../../../src/lib/store', () => ({ useAppStore: { getState: () => store } }))
const deps = vi.hoisted(() => ({ meta: null, rewardName: null, token: null, handle: null }))
vi.mock('../../../src/lib/videoMetaCache', () => ({ resolveVideoMeta: async () => deps.meta }))
vi.mock('../../../src/utils/viewerRewards', () => ({ viewerRewardsName: async () => deps.rewardName }))
vi.mock('../../../src/lib/advertiseData', () => ({ fetchWatchToken: async (...a) => { deps.tokenArgs = a; return deps.token } }))
vi.mock('../../../src/lib/incubation', () => ({ currentHandle: () => deps.handle }))
const { default: useWatchDuration } = await import('../../../src/hooks/useWatchDuration.js')

let fetchMock
let startAnswers
const bodies = (path) => fetchMock.mock.calls.filter(([u]) => u === `https://player.test${path}`).map(([, o]) => JSON.parse(o.body))
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })
const setHidden = (hidden) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') })
  act(() => { document.dispatchEvent(new Event('visibilitychange')) })
}

function mount(initial = {}, props = {}) {
  const base = { api: {}, author: 'badadib', permlink: 'p1', ...props }
  const hook = renderHook(({ state, extra }) => useWatchDuration({ ...base, ...extra, playerState: state }), {
    initialProps: { state: { paused: true, currentTime: 0, duration: 120, ...initial }, extra: {} },
  })
  let state = { paused: true, currentTime: 0, duration: 120, ...initial }
  const update = (patch, extra = {}) => { state = { ...state, ...patch }; hook.rerender({ state, extra }) }
  return { ...hook, update }
}

async function playing(initial, props) {
  const h = mount(initial, props)
  h.update({ paused: false })
  await flush()
  return h
}

beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000 })
  Object.assign(deps, { meta: null, rewardName: null, token: null, handle: null, tokenArgs: null })
  store.privateMode = false
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
  startAnswers = [{ ok: true, json: async () => ({ sid: 's1', token: 't1', beatSeconds: 10 }) }]
  fetchMock = vi.fn(async (url) => (url.endsWith('/start') ? startAnswers.shift() || { ok: false } : { ok: true }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.useRealTimers())

describe('opening a session', () => {
  it('waits for real playback, then opens one with the video and viewer facts', async () => {
    const h = mount()
    await flush()
    expect(bodies('/api/watch/start')).toHaveLength(0)
    h.update({ paused: false })
    await flush()
    expect(bodies('/api/watch/start')).toEqual([{
      owner: 'badadib', permlink: 'p1', type: 'embed', duration: 120, position: 0, source: '3speak',
      premium: false, private: false, viewer: null, incubationViewer: null,
    }])
  })

  it('uses the embed asset owner, permlink and stored duration from the metadata', async () => {
    deps.meta = { owner: 'asset-owner', permlink: 'asset-perm', duration: 3600 }
    await playing({ duration: 6 })
    expect(bodies('/api/watch/start')[0]).toMatchObject({ owner: 'asset-owner', permlink: 'asset-perm', duration: 3600 })
  })

  it('names an opted-in viewer with a token proving it, a premium and private viewer as such', async () => {
    deps.rewardName = 'badadib'
    deps.token = 'signed-proof'
    deps.handle = 'sunny-otter'
    store.privateMode = true
    await playing({}, { premium: true })
    expect(deps.tokenArgs).toEqual(['badadib', 'p1'])
    expect(bodies('/api/watch/start')[0]).toMatchObject({ viewer: 'badadib', viewerToken: 'signed-proof', premium: true, private: true, incubationViewer: 'sunny-otter' })
  })

  it('tries the legacy collection when the embed one does not have the video', async () => {
    startAnswers = [{ ok: false, status: 404 }, { ok: true, json: async () => ({ sid: 's2', token: 't2' }) }]
    const h = await playing()
    expect(bodies('/api/watch/start').map((b) => b.type)).toEqual(['embed', 'legacy'])
    h.update({ paused: true })
    expect(bodies('/api/watch/beat').at(-1)).toMatchObject({ sid: 's2', token: 't2' })
  })

  it('a video without a measurable duration opens nothing and does not try legacy', async () => {
    startAnswers = [{ ok: true, json: async () => ({ tracked: false }) }]
    const h = await playing()
    expect(bodies('/api/watch/start')).toHaveLength(1)
    h.update({ paused: true })
    expect(bodies('/api/watch/beat')).toHaveLength(0)
  })

  it('opens one session per video, and a new one for the next video', async () => {
    startAnswers.push({ ok: true, json: async () => ({ sid: 's9', token: 't9' }) })
    const h = await playing()
    h.update({ paused: true }); h.update({ paused: false })
    await flush()
    expect(bodies('/api/watch/start')).toHaveLength(1)
    h.rerender({ state: { paused: true, currentTime: 0 }, extra: { permlink: 'p2' } })
    h.rerender({ state: { paused: false, currentTime: 0 }, extra: { permlink: 'p2' } })
    await flush()
    expect(bodies('/api/watch/start').map((b) => b.permlink)).toEqual(['p1', 'p2'])
  })

  it.each([
    ['disabled', {}, { enabled: false }],
    ['an unknown author', {}, { author: 'unknown' }],
    ['no permlink', {}, { permlink: '' }],
  ])('%s opens nothing', async (_label, initial, props) => {
    await playing(initial, props)
    expect(bodies('/api/watch/start')).toHaveLength(0)
  })

  it('network errors on both collections leave it quietly unmeasured', async () => {
    fetchMock.mockImplementation(async () => { throw new TypeError('Failed to fetch') })
    const h = await playing()
    expect(() => h.update({ paused: true })).not.toThrow()
  })
})

describe('beating', () => {
  it('beats once per interval while playing, with the position and rate', async () => {
    const h = await playing()
    vi.setSystemTime(1_000_000 + 5_000); h.update({ currentTime: 5 })
    expect(bodies('/api/watch/beat')).toHaveLength(0)
    vi.setSystemTime(1_000_000 + 10_000); h.update({ currentTime: 10, playbackRate: 1.5 })
    expect(bodies('/api/watch/beat')).toEqual([{ sid: 's1', token: 't1', position: 10, rate: 1.5 }])
    const [, init] = fetchMock.mock.calls.find(([u]) => u.endsWith('/beat'))
    expect(init).toMatchObject({ method: 'POST', keepalive: true })
  })

  it('keeps stitched ad seconds out of the position', async () => {
    const h = await playing({}, { mapPosition: (t) => Math.max(0, t - 30) })
    vi.setSystemTime(1_000_000 + 10_000); h.update({ currentTime: 40 }, { mapPosition: (t) => Math.max(0, t - 30) })
    expect(bodies('/api/watch/beat')[0].position).toBe(10)
  })

  it('sends a final beat on pause', async () => {
    const h = await playing()
    h.update({ paused: true, currentTime: 3 })
    expect(bodies('/api/watch/beat')).toEqual([expect.objectContaining({ position: 3 })])
  })

  it('sends a final beat on page hide and on unmount', async () => {
    const h = await playing()
    act(() => { window.dispatchEvent(new Event('pagehide')) })
    expect(bodies('/api/watch/beat')).toHaveLength(1)
    h.unmount()
    expect(bodies('/api/watch/beat')).toHaveLength(2)
  })

  it('nothing is sent before a session exists', () => {
    const h = mount()
    h.update({ paused: true, currentTime: 9 })
    h.unmount()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('a background tab', () => {
  it('a short video: the hide flushes a beat, then nothing counts until it is back', async () => {
    const h = await playing()
    setHidden(true)
    expect(bodies('/api/watch/beat')).toHaveLength(1)
    vi.setSystemTime(1_000_000 + 60_000); h.update({ currentTime: 60 })
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(bodies('/api/watch/beat')).toHaveLength(1)

    // Coming back re-anchors: the next beat is a full interval later, no gap credited.
    setHidden(false)
    expect(bodies('/api/watch/beat')).toHaveLength(1)
    h.update({ currentTime: 61 })
    expect(bodies('/api/watch/beat')).toHaveLength(1)
    vi.setSystemTime(Date.now() + 10_000); h.update({ currentTime: 71 })
    expect(bodies('/api/watch/beat')).toHaveLength(2)
  })

  it('long-form (20 min or more) keeps beating on a timer while hidden', async () => {
    deps.meta = { duration: 20 * 60 }
    await playing()
    setHidden(true)
    const afterHide = bodies('/api/watch/beat').length
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(bodies('/api/watch/beat').length).toBe(afterHide + 1)
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(bodies('/api/watch/beat').length).toBe(afterHide + 2)
  })

  it('long-form beats on updates while visible, not on the timer', async () => {
    deps.meta = { duration: 3600 }
    await playing()
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(bodies('/api/watch/beat')).toHaveLength(0)
  })
})
