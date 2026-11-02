// The audio player's queue: a cover tapped while something plays lines up at
// the end of the queue, and a playlist goes in oldest first.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../../src/utils/toast.js', () => ({
  toastIn: () => ({ success: () => {} }),
}))

const { createAudioPlayerSlice, oldestFirst } = await import('../../../src/lib/slices/createAudioPlayerSlice.js')

function makeStore() {
  let state = {}
  const set = (p) => { state = { ...state, ...(typeof p === 'function' ? p(state) : p) } }
  const get = () => state
  state = createAudioPlayerSlice(set, get)
  return { get, set }
}

const tr = (id, createdAt) => ({ _id: id, title: id, createdAt })
const ids = (list) => list.map((i) => i._id)

describe('audioQueueIfPlaying', () => {
  beforeEach(() => localStorage.clear())

  it('does nothing while nothing plays, so the caller starts the track', () => {
    const s = makeStore()
    expect(s.get().audioQueueIfPlaying(tr('a'))).toBe(false)
    s.get().audioPlay(tr('a'))
    expect(s.get().audioQueueIfPlaying(tr('b'))).toBe(false) // loaded, not playing
    expect(s.get().audioQueue).toEqual([])
  })

  it('puts the playing item first when the queue is empty, then the new one', () => {
    const s = makeStore()
    s.get().audioPlay(tr('a'))
    s.get().audioSetIsPlaying(true)
    expect(s.get().audioQueueIfPlaying(tr('b'))).toBe(true)
    expect(s.get().audioCurrent._id).toBe('a')
    expect(ids(s.get().audioQueue)).toEqual(['a', 'b'])
  })

  it('appends to the end of an existing queue, each once', () => {
    const s = makeStore()
    s.get().audioAddToQueue(tr('x'))
    s.get().audioAddToQueue(tr('y'))
    s.get().audioPlay(tr('x'))
    s.get().audioSetIsPlaying(true)
    s.get().audioQueueIfPlaying([tr('y'), tr('z'), tr('w')])
    expect(ids(s.get().audioQueue)).toEqual(['x', 'y', 'z', 'w'])
  })

  it('leaves the playing item to the caller', () => {
    const s = makeStore()
    s.get().audioPlay(tr('a'))
    s.get().audioSetIsPlaying(true)
    expect(s.get().audioQueueIfPlaying(tr('a'))).toBe(false)
  })
})

describe('oldestFirst', () => {
  it('sorts by creation date ascending, undated last in their order', () => {
    const list = [
      tr('new', '2026-10-30T00:00:00Z'),
      tr('nodate1'),
      tr('old', '2025-01-01T00:00:00Z'),
      tr('nodate2'),
      tr('mid', '2026-03-01T00:00:00Z'),
    ]
    expect(ids(oldestFirst(list))).toEqual(['old', 'mid', 'new', 'nodate1', 'nodate2'])
  })

  it('copes with no list', () => {
    expect(oldestFirst(undefined)).toEqual([])
  })
})

describe('listened 3Speak tracks', () => {
  beforeEach(() => { localStorage.clear(); vi.resetModules() })

  it('marks a track listened once played to the end, and keeps it after a reload signed out', async () => {
    let p = await import('../../../src/lib/podcastProgress.js')
    p.recordProgress(null, 't1', 100, 300)
    p.recordProgress(null, 't2', 290, 300)
    expect(p.isListened(null, 't1')).toBe(false)
    expect(p.isListened(null, 't2')).toBe(true)
    vi.resetModules()
    p = await import('../../../src/lib/podcastProgress.js')
    expect(p.isListened(null, 't2')).toBe(true)
  })

  it('keeps each listener apart', async () => {
    const p = await import('../../../src/lib/podcastProgress.js')
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({}) })))
    p.recordProgress('alice', 't3', 300, 300)
    expect(p.isListened('alice', 't3')).toBe(true)
    expect(p.isListened('bob', 't3')).toBe(false)
  })
})
