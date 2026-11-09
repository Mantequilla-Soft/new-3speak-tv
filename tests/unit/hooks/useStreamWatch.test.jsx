// Stream-viewer rewards (src/hooks/useStreamWatch.js): a live session on the player
// service opened only for a viewer who opted in (never the host), beats while the
// stream is active and the tab is in front, a beat on the way out, a `hidden` beat
// on the way back, a retry later when nothing could be opened, and a fresh session
// when the player has forgotten the old one.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../../../src/utils/playerUrl', () => ({ getPlayerUrl: () => 'https://player.test' }))
const store = vi.hoisted(() => ({ privateMode: false }))
vi.mock('../../../src/lib/store', () => ({ useAppStore: { getState: () => store } }))
const deps = vi.hoisted(() => ({ rewardName: 'alice', token: 'tok', tokenArgs: null }))
vi.mock('../../../src/utils/viewerRewards', () => ({ viewerRewardsName: async () => deps.rewardName }))
vi.mock('../../../src/lib/advertiseData', () => ({ fetchWatchToken: async (...a) => { deps.tokenArgs = a; return deps.token } }))
const { default: useStreamWatch } = await import('../../../src/hooks/useStreamWatch.js')

let fetchMock
let startAnswers
let beatStatus
const bodies = (path) => fetchMock.mock.calls.filter(([u]) => u === `https://player.test${path}`).map(([, o]) => JSON.parse(o.body))
const tick = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
const setHidden = (hidden) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') })
  act(() => { document.dispatchEvent(new Event('visibilitychange')) })
}
const mount = (props = {}) => renderHook((p) => useStreamWatch(p), {
  initialProps: { host: 'Host1', room: 'room-1', active: true, ...props },
})

beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000 })
  Object.assign(deps, { rewardName: 'alice', token: 'tok', tokenArgs: null })
  store.privateMode = false
  beatStatus = 200
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
  startAnswers = [{ ok: true, json: async () => ({ sid: 's1', token: 't1', beatSeconds: 5, live: true }) }]
  fetchMock = vi.fn(async (url) => (url.endsWith('/start')
    ? startAnswers.shift() || { ok: true, json: async () => ({ tracked: false, reason: 'not_live' }) }
    : { ok: beatStatus === 200, status: beatStatus }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.useRealTimers())

describe('opening a live session', () => {
  it('opens one for the host and room, as a live 3speak.tv watch, with the viewer and a token bound to the room', async () => {
    mount()
    await tick(1000)
    expect(bodies('/api/watch/start')).toEqual([{
      owner: 'host1', permlink: 'room-1', type: 'live', source: '3speak', private: false, viewer: 'alice', viewerToken: 'tok',
    }])
    expect(deps.tokenArgs).toEqual(['host1', 'room-1'])
  })

  it('opens nothing while the stream is not active (not live yet, or the pre-roll is playing)', async () => {
    mount({ active: false })
    await tick(5000)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('opens nothing for a viewer who has not opted in, and asks again a minute later', async () => {
    deps.rewardName = null
    mount()
    await tick(30_000)
    expect(bodies('/api/watch/start')).toEqual([])
    deps.rewardName = 'alice'
    await tick(31_000)
    expect(bodies('/api/watch/start')).toHaveLength(1)
  })

  it('never for the host watching their own stream', async () => {
    deps.rewardName = 'host1'
    mount()
    await tick(5000)
    expect(bodies('/api/watch/start')).toEqual([])
  })

  it('a stream in standby (not_live) is asked again a minute later, not every second', async () => {
    startAnswers = []
    mount()
    await tick(30_000)
    expect(bodies('/api/watch/start')).toHaveLength(1)
    await tick(31_000)
    expect(bodies('/api/watch/start')).toHaveLength(2)
  })

  it('private mode is passed on, so the player records nothing', async () => {
    store.privateMode = true
    mount()
    await tick(1000)
    expect(bodies('/api/watch/start')[0].private).toBe(true)
  })
})

describe('beats', () => {
  it('every beatSeconds while the tab is in front', async () => {
    mount()
    await tick(1000)
    await tick(15_000)
    expect(bodies('/api/watch/beat')).toEqual([{ sid: 's1', token: 't1' }, { sid: 's1', token: 't1' }, { sid: 's1', token: 't1' }])
  })

  it('one beat on the way out, none while away, a hidden beat on the way back', async () => {
    mount()
    await tick(1000)
    setHidden(true)
    await tick(60_000)
    expect(bodies('/api/watch/beat')).toEqual([{ sid: 's1', token: 't1' }])
    setHidden(false)
    expect(bodies('/api/watch/beat')[1]).toEqual({ sid: 's1', token: 't1', hidden: true })
  })

  it('a final beat when the stream stops being active or the page unmounts', async () => {
    const h = mount()
    await tick(2000)
    h.rerender({ host: 'Host1', room: 'room-1', active: false })
    expect(bodies('/api/watch/beat')).toHaveLength(1)
    await tick(10_000)
    expect(bodies('/api/watch/beat')).toHaveLength(1)
  })

  it('a player that forgot the session (restart: 403/410) gets a fresh one', async () => {
    startAnswers.push({ ok: true, json: async () => ({ sid: 's2', token: 't2', beatSeconds: 5 }) })
    mount()
    await tick(1000)
    beatStatus = 403
    await tick(5000)
    beatStatus = 200
    await tick(2000)
    expect(bodies('/api/watch/start')).toHaveLength(2)
    await tick(5000)
    expect(bodies('/api/watch/beat').at(-1)).toEqual({ sid: 's2', token: 't2' })
  })
})
