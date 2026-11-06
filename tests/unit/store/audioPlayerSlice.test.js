// The global audio player's state (src/lib/slices/createAudioPlayerSlice.js):
// coming back after a reload paused where the listener left off (including the
// older sessionStorage keys), closing and resuming the last track, playing from a
// timestamp or a clip, playing an outside episode without losing what played,
// and the queue (add, move, remove, clear), all persisted to localStorage.
// Queueing on a cover tap is covered in tests/unit/lib/audioQueue.test.js.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { create } from 'zustand'

vi.mock('../../../src/i18n', () => ({ t: (k) => k }))
vi.mock('../../../src/utils/toast', () => ({ toastIn: () => ({ success: () => {} }) }))

const A = { _id: 'a', permlink: 'a', title: 'Track A', duration: 300 }
const B = { _id: 'b', permlink: 'b', title: 'Track B', duration: '120' }
const C = { _id: 'c', permlink: 'c', title: 'Track C' }
const EPISODE = { _id: 'feed:ep1', external: true, title: 'Episode', duration: 3600 }

let mod
let store
const state = () => store.getState()
const saved = (k) => JSON.parse(localStorage.getItem(k))

async function freshStore() {
  vi.resetModules()
  mod = await import('../../../src/lib/slices/createAudioPlayerSlice.js')
  store = create((...a) => mod.createAudioPlayerSlice(...a))
}

beforeEach(async () => {
  localStorage.clear()
  sessionStorage.clear()
  await freshStore()
})

describe('after a reload', () => {
  it('nothing saved: an idle player', () => {
    expect(state()).toMatchObject({ audioCurrent: null, audioQueue: [], audioAutoplayList: [], audioRestoredAt: null, audioCurrentTime: 0, audioDuration: 0, audioLast: null })
  })

  it('brings the track back paused at the saved position, with the queue', async () => {
    localStorage.setItem('audio-now-playing', JSON.stringify(A))
    localStorage.setItem('audio-queue', JSON.stringify([A, B]))
    localStorage.setItem('audio-now-position', JSON.stringify({ id: 'a', t: 42 }))
    await freshStore()
    expect(state()).toMatchObject({ audioCurrent: A, audioQueue: [A, B], audioAutoplayList: [A], audioRestoredAt: 42, audioCurrentTime: 42, audioDuration: 300, audioIsPlaying: false })
  })

  it('a saved position for another track starts from 0', async () => {
    localStorage.setItem('audio-now-playing', JSON.stringify(A))
    localStorage.setItem('audio-now-position', JSON.stringify({ id: 'b', t: 42 }))
    await freshStore()
    expect(state().audioRestoredAt).toBe(0)
  })

  it('picks up what older builds left in sessionStorage', async () => {
    sessionStorage.setItem('audio-now-playing', JSON.stringify(B))
    sessionStorage.setItem('audio-queue', JSON.stringify([B]))
    await freshStore()
    expect(state()).toMatchObject({ audioCurrent: B, audioQueue: [B], audioDuration: 120 })
  })

  it('corrupt saved state starts idle instead of crashing', async () => {
    localStorage.setItem('audio-now-playing', '{oops')
    localStorage.setItem('audio-last', '{oops')
    await freshStore()
    expect(state()).toMatchObject({ audioCurrent: null, audioQueue: [], audioLast: null })
  })

  it('reads the last closed track, defaulting a missing position to 0', async () => {
    localStorage.setItem('audio-last', JSON.stringify({ track: A }))
    await freshStore()
    expect(state().audioLast).toEqual({ track: A, t: 0 })
    localStorage.setItem('audio-last', JSON.stringify({ track: {} }))
    await freshStore()
    expect(state().audioLast).toBeNull()
  })
})

describe('playing', () => {
  it('starts a track from the top with its stored duration and remembers it', () => {
    localStorage.setItem('audio-now-position', JSON.stringify({ id: 'x', t: 9 }))
    state().audioPlay(A, [A, B])
    expect(state()).toMatchObject({ audioCurrent: A, audioAutoplayList: [A, B], audioCurrentTime: 0, audioDuration: 300, audioPlayNonce: 1, audioRestoredAt: null })
    expect(saved('audio-now-playing')).toEqual(A)
    expect(localStorage.getItem('audio-now-position')).toBeNull()
  })

  it('without a context list autoplays just the track; replaying bumps the nonce', () => {
    state().audioPlay(C)
    state().audioPlay(C)
    expect(state()).toMatchObject({ audioAutoplayList: [C], audioDuration: 0, audioPlayNonce: 2 })
  })

  it('ignores a missing track', () => {
    state().audioPlay(null)
    state().audioLoadPaused(null)
    state().audioPlayAt(null, 5)
    state().audioPlayQueued(null)
    expect(state().audioCurrent).toBeNull()
  })

  it('loads a track paused at a position', () => {
    state().audioLoadPaused(A, 75, [A, B])
    expect(state()).toMatchObject({ audioCurrent: A, audioRestoredAt: 75, audioCurrentTime: 75, audioAutoplayList: [A, B] })
    state().audioLoadPaused(B)
    expect(state()).toMatchObject({ audioRestoredAt: 0, audioAutoplayList: [B] })
  })

  it.each([
    [30, 60, 30, 60],
    [30, undefined, 30, null],
    [0, 10, null, 10],
    [-5, 10, null, 10],
    [30, 20, 30, null],
    ['x', 'y', null, null],
  ])('playing from %s to %s starts at %s and pauses at %s', (start, end, from, to) => {
    state().audioPlayAt(A, start, end)
    expect(state()).toMatchObject({ audioCurrent: A, audioStartAt: from, audioClipEnd: to, audioCurrentTime: from || 0 })
    state().audioClearClip()
    expect(state().audioClipEnd).toBeNull()
  })

  it('an outside episode played from a timestamp keeps what was playing in the queue', () => {
    state().audioPlay(A)
    state().audioPlayAt(EPISODE, 120)
    expect(state().audioQueue.map((t) => t._id)).toEqual(['a', 'feed:ep1'])
    expect(state()).toMatchObject({ audioCurrent: EPISODE, audioStartAt: 120 })
  })
})

describe('playing an outside episode now', () => {
  it('puts the playing track in the queue and the episode right after it', () => {
    state().audioAddToQueue(B)
    state().audioPlay(A)
    state().audioPlayQueued(EPISODE)
    expect(state().audioQueue.map((t) => t._id)).toEqual(['b', 'a', 'feed:ep1'])
    expect(state().audioAutoplayList).toEqual(state().audioQueue)
    expect(state().audioCurrent).toBe(EPISODE)
    expect(saved('audio-queue').map((t) => t._id)).toEqual(['b', 'a', 'feed:ep1'])
  })

  it('with the playing track already queued, slots in after it and moves an old copy', () => {
    state().audioAddToQueue(A)
    state().audioAddToQueue(EPISODE)
    state().audioAddToQueue(B)
    state().audioPlay(A)
    state().audioPlayQueued(EPISODE)
    expect(state().audioQueue.map((t) => t._id)).toEqual(['a', 'feed:ep1', 'b'])
  })

  it('with nothing playing, goes on the end', () => {
    state().audioAddToQueue(B)
    state().audioPlayQueued(EPISODE)
    expect(state().audioQueue.map((t) => t._id)).toEqual(['b', 'feed:ep1'])
  })
})

describe('closing and resuming', () => {
  it('closing remembers the track at its saved position and empties the player', () => {
    state().audioPlay(A)
    state().audioSetIsPlaying(true)
    state().audioSetExpanded(true)
    state().audioSetCurrentTime(50)
    mod.persistAudioPosition('a', 61.8)
    state().audioStop()
    expect(state().audioLast).toEqual({ track: A, t: 61 })
    expect(saved('audio-last')).toEqual({ track: A, t: 61 })
    expect(state()).toMatchObject({ audioCurrent: null, audioIsPlaying: false, audioCurrentTime: 0, audioDuration: 0, audioAutoplayList: [], audioExpanded: false })
    expect(localStorage.getItem('audio-now-playing')).toBeNull()
  })

  it('without a saved position, remembers where the player is', () => {
    state().audioPlay(A)
    state().audioSetCurrentTime(12.9)
    state().audioStop()
    expect(state().audioLast.t).toBe(12)
  })

  it('a live stream is not remembered', () => {
    state().audioPlay({ _id: 'live:1', live: true })
    state().audioStop()
    expect(state().audioLast).toBeNull()
  })

  it('resumes the last track paused, or playing from its spot', () => {
    state().audioPlay(A)
    state().audioSetCurrentTime(30)
    state().audioStop()
    state().audioResumeLast()
    expect(state()).toMatchObject({ audioCurrent: A, audioRestoredAt: 30 })
    state().audioStop()
    state().audioResumeLast(true)
    expect(state()).toMatchObject({ audioCurrent: A, audioStartAt: 30, audioRestoredAt: null })
  })

  it('nothing to resume does nothing', () => {
    state().audioResumeLast(true)
    expect(state().audioCurrent).toBeNull()
  })

  it('persistAudioPosition ignores a missing id or time', () => {
    mod.persistAudioPosition(null, 5)
    mod.persistAudioPosition('a', NaN)
    expect(localStorage.getItem('audio-now-position')).toBeNull()
  })
})

describe('the queue', () => {
  it('adds each track once, persisted', () => {
    state().audioAddToQueue(A)
    state().audioAddToQueue(B)
    state().audioAddToQueue(A)
    expect(state().audioQueue).toEqual([A, B])
    expect(saved('audio-queue')).toEqual([A, B])
  })

  it('moves, removes and clears', () => {
    for (const t of [A, B, C]) state().audioAddToQueue(t)
    state().audioMoveInQueue(2, 0)
    expect(state().audioQueue.map((t) => t._id)).toEqual(['c', 'a', 'b'])
    state().audioRemoveFromQueue('a')
    expect(saved('audio-queue').map((t) => t._id)).toEqual(['c', 'b'])
    state().audioClearQueue()
    expect(state().audioQueue).toEqual([])
    expect(saved('audio-queue')).toEqual([])
  })
})

describe('requests to the player and small setters', () => {
  it('toggle, play/pause and seek requests bump their nonces', () => {
    state().audioRequestToggle()
    state().audioRequestPlayPauseToggle()
    state().audioRequestSeek(90)
    expect(state()).toMatchObject({ audioToggleNonce: 1, audioPlayNonce: 1, audioIsPlaying: true, audioSeekNonce: 1, audioPendingSeek: 90 })
  })

  it('setters take values or updaters', () => {
    state().audioSetExpanded((v) => !v)
    state().audioSetShowQueue(true)
    state().audioSetShowQueue((v) => !v)
    state().audioSetDuration(200)
    state().audioSetIsPlaying('yes')
    state().audioSetAutoplayList('nope')
    expect(state()).toMatchObject({ audioExpanded: true, audioShowQueue: false, audioDuration: 200, audioIsPlaying: true, audioAutoplayList: [] })
    state().audioSetAutoplayList([A])
    expect(state().audioAutoplayList).toEqual([A])
  })

  it('the restored marker clears once the player applied it', async () => {
    localStorage.setItem('audio-now-playing', JSON.stringify(A))
    await freshStore()
    state().audioClearRestored()
    expect(state().audioRestoredAt).toBeNull()
  })

  it('the phone dock and its opener', () => {
    const el = {}
    const open = () => {}
    state().audioSetDock(el)
    state().audioSetDockOpener(open)
    expect(state()).toMatchObject({ audioDock: el, audioDockOpener: open })
    state().audioSetDock(undefined)
    state().audioSetDockOpener('not a function')
    expect(state()).toMatchObject({ audioDock: null, audioDockOpener: null })
  })
})

describe('when storage is unavailable', () => {
  it('playing and queueing still work', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceeded') })
    state().audioPlay(A)
    state().audioAddToQueue(B)
    mod.persistAudioPosition('a', 5)
    state().audioStop()
    expect(state()).toMatchObject({ audioCurrent: null, audioQueue: [B], audioLast: { track: A, t: 0 } })
  })
})
