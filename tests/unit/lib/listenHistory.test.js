// @vitest-environment jsdom
/**
 * lib/listenHistory.js: what the global audio player puts into the watch history.
 * 3Speak audio, 3Speak episodes of a followed 3Speak feed (by their Hive post) and
 * outside episodes (author `_podcast` + episode id), each once per day per listener,
 * only past the listen threshold and only with "Save history" on.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ state: {} }))
vi.mock('../../../src/utils/watchHistory', () => ({ recordWatch: vi.fn(async () => ({ success: true })) }))
vi.mock('../../../src/lib/store', () => ({
  useAppStore: { getState: () => h.state, setState: (patch) => { h.state = { ...h.state, ...patch } } },
}))

const { recordWatch } = await import('../../../src/utils/watchHistory')
const { useAppStore } = await import('../../../src/lib/store')
const { noteListen, historyKeyOf, listenedEnough, PODCAST_HISTORY_AUTHOR, _resetListenHistory } = await import('../../../src/lib/listenHistory')

const EP = '6ae8465717bc26ca49e3afce:DvcJ2HrhyR9L5nZ_'
const native = { _id: '6a0000000000000000000001', owner: 'badadib', permlink: 'abc123', duration: 300 }
const threeSpeakEpisode = { _id: EP, external: true, owner: 'badadib', post_permlink: 'my-episode-post', duration: 170 }
const outside = { _id: '6aeb69e6696f90cea1328cc7:woMAUv9ELz6UQDwM', external: true, owner: '', duration: 5130 }
const DAY1 = new Date(2026, 10, 15, 9, 0).getTime()
const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  localStorage.clear()
  _resetListenHistory()
  recordWatch.mockReset().mockResolvedValue({ success: true })
  useAppStore.setState({ user: 'fan', incubationHandle: null, watchHistoryEnabled: true })
})

describe('historyKeyOf', () => {
  it('3Speak audio by owner + asset permlink, a 3Speak feed episode by its Hive post, an outside episode by its id', () => {
    expect(historyKeyOf(native)).toEqual({ author: 'badadib', permlink: 'abc123' })
    expect(historyKeyOf(threeSpeakEpisode)).toEqual({ author: 'badadib', permlink: 'my-episode-post' })
    expect(historyKeyOf(outside)).toEqual({ author: PODCAST_HISTORY_AUTHOR, permlink: outside._id })
  })

  it('never a live stream, a private feed, or something without a key', () => {
    expect(historyKeyOf({ ...outside, live: true })).toBeNull()
    expect(historyKeyOf({ ...outside, private: true })).toBeNull()
    expect(historyKeyOf({ _id: 'live:x:y', external: true })).toBeNull()
    expect(historyKeyOf({ owner: 'badadib' })).toBeNull()
    expect(historyKeyOf(null)).toBeNull()
  })
})

describe('listenedEnough', () => {
  it('30 s, or half of a shorter track', () => {
    expect(listenedEnough(29, 300)).toBe(false)
    expect(listenedEnough(30, 300)).toBe(true)
    expect(listenedEnough(9, 20)).toBe(false)
    expect(listenedEnough(10, 20)).toBe(true)
    expect(listenedEnough(30, 0)).toBe(true)
  })
})

describe('noteListen', () => {
  it('records each kind once it qualifies, then not again on every timeupdate', async () => {
    for (const pos of [5, 31, 32, 60, 200]) {
      noteListen(native, pos, 300, DAY1)
      noteListen(threeSpeakEpisode, pos, 170, DAY1)
      noteListen(outside, pos, 5130, DAY1)
    }
    expect(recordWatch.mock.calls).toEqual([
      ['fan', 'badadib', 'abc123', { short: false }],
      ['fan', 'badadib', 'my-episode-post', { short: false }],
      ['fan', '_podcast', outside._id, { short: false }],
    ])
  })

  it('once per day: a reload the same day does not count it again, the next day does', () => {
    noteListen(outside, 40, 5130, DAY1)
    _resetListenHistory()               // a reload: memory gone, localStorage kept
    noteListen(outside, 50, 5130, DAY1 + 3600e3)
    expect(recordWatch).toHaveBeenCalledTimes(1)
    noteListen(outside, 50, 5130, DAY1 + 24 * 3600e3)
    expect(recordWatch).toHaveBeenCalledTimes(2)
  })

  it('"Save history" off records nothing', () => {
    useAppStore.setState({ watchHistoryEnabled: false })
    noteListen(native, 100, 300, DAY1)
    noteListen(outside, 100, 5130, DAY1)
    expect(recordWatch).not.toHaveBeenCalled()
  })

  it('nobody signed in records nothing; a warm-up handle is a listener too', () => {
    useAppStore.setState({ user: null })
    noteListen(native, 100, 300, DAY1)
    expect(recordWatch).not.toHaveBeenCalled()
    useAppStore.setState({ incubationHandle: 'newbie' })
    noteListen(native, 100, 300, DAY1)
    expect(recordWatch).toHaveBeenCalledWith('newbie', 'badadib', 'abc123', { short: false })
  })

  it('a failed call is tried again after a minute, not on every timeupdate', async () => {
    recordWatch.mockResolvedValueOnce(null)
    noteListen(native, 40, 300, DAY1)
    await flush()
    noteListen(native, 41, 300, DAY1 + 1000)
    expect(recordWatch).toHaveBeenCalledTimes(1)
    noteListen(native, 100, 300, DAY1 + 61 * 1000)
    expect(recordWatch).toHaveBeenCalledTimes(2)
  })

  it('another listener on the same device gets their own record', () => {
    noteListen(native, 40, 300, DAY1)
    useAppStore.setState({ user: 'other' })
    noteListen(native, 40, 300, DAY1)
    expect(recordWatch.mock.calls.map((c) => c[0])).toEqual(['fan', 'other'])
  })
})
