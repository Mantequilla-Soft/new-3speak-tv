// @vitest-environment jsdom
// Listening progress (src/lib/podcastProgress.js): what counts as finished,
// where an episode resumes, the per-account copy kept in this browser, batched
// saves to the checker with one reused session vouch, merging what another
// device played, and Continue listening. fetch is stubbed and the clock is
// fake; each test loads a fresh module, since it keeps per-page state.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const h = vi.hoisted(() => ({ provider: vi.fn() }))
vi.mock('../../../src/hive-api/aioha', () => ({ getCurrentProvider: h.provider, Providers: { HiveSigner: 'hivesigner' } }))
vi.mock('../../../src/utils/config', () => ({ CHECKER_URL: 'https://checker.example' }))

const NOW = new Date('2026-11-05T12:00:00Z').getTime()
const VOUCH = { username: 'alice', signature: 'SIG', timestamp: NOW }
const reply = (status, body) => ({ ok: status < 300, status, json: async () => body })

let fetchMock
let routes
let pp
// Module loading needs real timers; the clock is faked again right after.
async function load() {
  const now = Date.now()
  vi.useRealTimers()
  vi.resetModules()
  pp = await import('../../../src/lib/podcastProgress.js')
  vi.useFakeTimers()
  vi.setSystemTime(now)
  return pp
}
const callsTo = (path) => fetchMock.mock.calls.filter(([url]) => url.startsWith(path))
const bodyOf = (call) => JSON.parse(call[1].body)

beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  localStorage.clear()
  h.provider.mockReset().mockReturnValue('keychain')
  routes = { '/api/podcasts/signature': reply(200, VOUCH) }
  fetchMock = vi.fn(async (url) => {
    const key = Object.keys(routes).find((k) => url.startsWith(k))
    const r = key ? routes[key] : reply(404, {})
    if (r instanceof Error) throw r
    return typeof r === 'function' ? r(url) : r
  })
  vi.stubGlobal('fetch', fetchMock)
  await load()
})
afterEach(() => vi.useRealTimers())

describe('isFinished', () => {
  it.each([
    [950, 1000, true],
    [940, 1000, false],
    [171, 200, true],
    [169, 200, false],
    [10, 0, false],
  ])('%i of %i seconds -> %s', (pos, dur, done) => {
    expect(pp.isFinished(pos, dur)).toBe(done)
  })
})

describe('recording and reading progress', () => {
  it('returns null for an episode never played', () => {
    expect(pp.progressOf('ep1')).toBeNull()
  })

  it('records rounded seconds with a percentage, and keeps a finished mark', () => {
    pp.recordProgress('alice', 'ep1', 600.4, 1200.2)
    expect(pp.progressOf('ep1')).toEqual({ pos: 600, dur: 1200, done: false, at: NOW, pct: 50 })
    pp.recordProgress('alice', 'ep1', 1190, 1200)
    expect(pp.progressOf('ep1').pct).toBe(100)
    expect(pp.isListened('alice', 'ep1')).toBe(true)
    pp.recordProgress('alice', 'ep1', 10, 1200)
    expect(pp.progressOf('ep1')).toMatchObject({ pos: 10, done: true, pct: 100 })
  })

  it.each([
    ['no id', ['', 10, 100]],
    ['a position that is not a number', ['ep1', NaN, 100]],
    ['no duration', ['ep1', 10, 0]],
  ])('ignores a report with %s', (_name, [id, pos, dur]) => {
    pp.recordProgress('alice', id, pos, dur)
    expect(pp.progressOf('ep1')).toBeNull()
  })

  it('keeps progress per account and signed out separately in this browser', async () => {
    pp.recordProgress('alice', 'ep1', 100, 1000)
    pp.recordProgress(null, 'ep1', 300, 1000)
    expect(JSON.parse(localStorage.getItem('podcast-progress:alice')).ep1.pos).toBe(100)
    expect(JSON.parse(localStorage.getItem('podcast-progress:~anon')).ep1.pos).toBe(300)
    await load()
    expect(pp.resumePosition('alice', 'ep1')).toBe(97)
    expect(pp.resumePosition(null, 'ep1')).toBe(297)
  })

  it.each([
    ['a few seconds before where it was left', 120, 1000, 117],
    ['from the start when barely begun', 15, 1000, 0],
    ['from the start once finished', 990, 1000, 0],
  ])('resumes %s', (_name, pos, dur, at) => {
    pp.recordProgress('alice', 'ep1', pos, dur)
    expect(pp.resumePosition('alice', 'ep1')).toBe(at)
  })

  it('a tick in the same second changes nothing; small moves are not written locally', () => {
    pp.recordProgress('alice', 'ep1', 100, 1000)
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    pp.recordProgress('alice', 'ep1', 100.2, 1000)
    pp.recordProgress('alice', 'ep1', 102, 1000)
    expect(setItem).not.toHaveBeenCalled()
    // Five seconds on from the previous report is a visible move.
    pp.recordProgress('alice', 'ep1', 107, 1000)
    expect(setItem).toHaveBeenCalledTimes(1)
  })

  it('survives unreadable or unwritable storage', async () => {
    localStorage.setItem('podcast-progress:bob', '{broken')
    await load()
    expect(pp.progressOf('x')).toBeNull()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full') })
    expect(() => pp.recordProgress('bob', 'ep1', 100, 1000)).not.toThrow()
    expect(pp.progressOf('ep1').pos).toBe(100)
  })
})

describe('saving to the checker', () => {
  it('saves once, 20 seconds after the first report, with the session vouch', async () => {
    pp.recordProgress('alice', 'ep1', 100, 1000)
    pp.recordProgress('alice', 'ep2', 50, 500)
    await vi.advanceTimersByTimeAsync(19999)
    expect(callsTo('https://checker.example/podcasts/progress')).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    const [save] = callsTo('https://checker.example/podcasts/progress')
    expect(bodyOf(save)).toEqual({
      user: 'alice', signature: 'SIG', timestamp: NOW,
      items: [{ id: 'ep1', pos: 100, dur: 1000 }, { id: 'ep2', pos: 50, dur: 500 }],
    })
    const [sig] = callsTo('/api/podcasts/signature')
    expect(sig[1]).toMatchObject({ method: 'POST', credentials: 'include' })
    expect(bodyOf(sig)).toEqual({ action: 'progress', payload: 'session' })
  })

  it('sends at most 20 episodes per save, and the rest next time', async () => {
    for (let i = 0; i < 25; i += 1) pp.recordProgress('alice', `ep${i}`, 100, 1000)
    await pp.flushProgress()
    await pp.flushProgress()
    const saves = callsTo('https://checker.example/podcasts/progress')
    expect(saves.map((c) => bodyOf(c).items.length)).toEqual([20, 5])
  })

  it('keeps progress local when signed out', async () => {
    pp.recordProgress(null, 'ep1', 100, 1000)
    await pp.flushProgress()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends nothing when nothing changed', async () => {
    pp.resumePosition('alice', 'x')
    await pp.flushProgress()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // BUG: the set of unsaved episodes (`dirty`, podcastProgress.js:34) is not
  // tied to an account. switchOwner (podcastProgress.js:45) swaps the progress
  // map but keeps `dirty`, so episodes played signed out (or by the previous
  // account) are sent in the next save under the NEW account, as rows with
  // pos 0 and dur 0, and the previous account's unsaved positions are lost.
  // Expected: a save only ever carries episodes the saving account played.
  it('BUG: switching accounts never sends the previous account\'s unsaved episodes under the new one', async () => {
    pp.recordProgress(null, 'ep1', 100, 1000)
    pp.resumePosition('alice', 'x')
    await pp.flushProgress()
    expect(callsTo('https://checker.example/podcasts/progress')).toHaveLength(0)
  })

  it('an account switched away from still gets its own unsaved episodes saved, under its own name', async () => {
    pp.recordProgress('alice', 'ep1', 100, 1000)
    pp.resumePosition('bob', 'x')
    await vi.advanceTimersByTimeAsync(0)
    const saves = callsTo('https://checker.example/podcasts/progress')
    expect(saves.map((c) => [bodyOf(c).user, bodyOf(c).items])).toEqual([['alice', [{ id: 'ep1', pos: 100, dur: 1000 }]]])
    await pp.flushProgress()
    expect(callsTo('https://checker.example/podcasts/progress')).toHaveLength(1)
  })

  it('retries a failed save next time', async () => {
    routes['https://checker.example/podcasts/progress'] = new TypeError('offline')
    pp.recordProgress('alice', 'ep1', 100, 1000)
    await pp.flushProgress()
    routes['https://checker.example/podcasts/progress'] = reply(200, {})
    await pp.flushProgress()
    const saves = callsTo('https://checker.example/podcasts/progress')
    expect(saves).toHaveLength(2)
    expect(bodyOf(saves[1]).items).toEqual([{ id: 'ep1', pos: 100, dur: 1000 }])
  })

  it('sends the last position along when the page is left', async () => {
    pp.recordProgress('alice', 'ep1', 100, 1000)
    window.dispatchEvent(new Event('pagehide'))
    await vi.advanceTimersByTimeAsync(0)
    const saves = callsTo('https://checker.example/podcasts/progress')
    expect(saves.at(-1)[1].keepalive).toBe(true)
  })
})

describe('sessionVouch', () => {
  it('reuses one vouch for most of a day', async () => {
    await pp.sessionVouch('alice')
    await pp.sessionVouch('alice')
    expect(callsTo('/api/podcasts/signature')).toHaveLength(1)
    expect(pp.lastVouchUser()).toBe('alice')
    vi.setSystemTime(NOW + 20 * 3600 * 1000)
    await pp.sessionVouch('alice')
    expect(callsTo('/api/podcasts/signature')).toHaveLength(2)
  })

  it('asks once for concurrent callers', async () => {
    const [a, b] = await Promise.all([pp.sessionVouch('alice'), pp.sessionVouch('alice')])
    expect(a).toBe(b)
    expect(callsTo('/api/podcasts/signature')).toHaveLength(1)
  })

  it.each([
    ['vouches for someone else', reply(200, { ...VOUCH, username: 'mallory' })],
    ['refuses', reply(401, {})],
    ['is down', new TypeError('offline')],
    ['answers garbage', { ok: true, status: 200, json: async () => { throw new Error('html') } }],
  ])('is null when the API %s, and does not ask again for five minutes', async (_name, answer) => {
    routes['/api/podcasts/signature'] = answer
    expect(await pp.sessionVouch('alice')).toBeNull()
    expect(await pp.sessionVouch('alice')).toBeNull()
    expect(callsTo('/api/podcasts/signature')).toHaveLength(1)
    vi.setSystemTime(NOW + 5 * 60 * 1000)
    routes['/api/podcasts/signature'] = reply(200, VOUCH)
    expect(await pp.sessionVouch('alice')).toMatchObject({ signature: 'SIG' })
    expect(pp.lastVouchUser()).toBe('alice')
  })

  it('is null signed out, and HiveSigner sends its token', async () => {
    expect(await pp.sessionVouch(null)).toBeNull()
    expect(pp.lastVouchUser()).toBeNull()
    h.provider.mockReturnValue('hivesigner')
    localStorage.setItem('hivesignerToken', 'TOK')
    await pp.sessionVouch('alice')
    expect(callsTo('/api/podcasts/signature')[0][1].headers.Authorization).toBe('Bearer TOK')
  })

  it('a failed save is skipped without a vouch', async () => {
    routes['/api/podcasts/signature'] = reply(401, {})
    pp.recordProgress('alice', 'ep1', 100, 1000)
    await pp.flushProgress()
    expect(callsTo('https://checker.example/podcasts/progress')).toHaveLength(0)
  })
})

describe('progress from other devices', () => {
  it('takes the furthest position and never undoes a finished mark', async () => {
    pp.recordProgress('alice', 'a', 500, 1000)
    pp.recordProgress('alice', 'b', 990, 1000)
    pp.recordProgress('alice', 'c', 100, 1000)
    routes['https://checker.example/podcasts/progress?'] = reply(200, { progress: {
      a: { pos: 200, dur: 1000 }, b: { pos: 10, dur: 1000 }, c: { pos: 700, dur: 1000 }, d: { pos: 50, dur: 0, done: true },
    } })
    await pp.loadProgressFor('alice', ['a', 'b', 'c', 'd', 'd', ''])
    expect(pp.progressOf('a').pos).toBe(500)
    expect(pp.progressOf('b').done).toBe(true)
    expect(pp.progressOf('c').pos).toBe(700)
    expect(pp.progressOf('d')).toMatchObject({ done: true, pct: 100 })
    const [url] = callsTo('https://checker.example/podcasts/progress?')[0]
    expect(url).toBe('https://checker.example/podcasts/progress?user=alice&ids=a,b,c,d')
  })

  it('asks in chunks of 150 ids', async () => {
    routes['https://checker.example/podcasts/progress?'] = reply(200, { progress: {} })
    await pp.loadProgressFor('alice', Array.from({ length: 320 }, (_, i) => `e${i}`))
    expect(callsTo('https://checker.example/podcasts/progress?')).toHaveLength(3)
  })

  it('signed out it asks nothing; with the checker down the local copy stays', async () => {
    await pp.loadProgressFor(null, ['a'])
    expect(fetchMock).not.toHaveBeenCalled()
    pp.recordProgress('alice', 'a', 300, 1000)
    routes['https://checker.example/podcasts/progress?'] = new TypeError('offline')
    await pp.loadProgressFor('alice', ['a'])
    expect(pp.progressOf('a').pos).toBe(300)
  })

  it('wantProgressFor batches asks from many tiles and asks each id once', async () => {
    routes['https://checker.example/podcasts/progress?'] = reply(200, { progress: {} })
    pp.wantProgressFor('alice', ['a', 'b'])
    pp.wantProgressFor('alice', ['b', 'c'])
    await vi.advanceTimersByTimeAsync(150)
    pp.wantProgressFor('alice', ['a'])
    await vi.advanceTimersByTimeAsync(150)
    const urls = callsTo('https://checker.example/podcasts/progress?').map((c) => c[0])
    expect(urls).toEqual(['https://checker.example/podcasts/progress?user=alice&ids=a,b,c'])
  })

  it('wantProgressFor starts over for another account and ignores empty asks', async () => {
    routes['https://checker.example/podcasts/progress?'] = reply(200, { progress: {} })
    pp.wantProgressFor(null, ['a'])
    pp.wantProgressFor('alice', [])
    pp.wantProgressFor('alice', ['a'])
    pp.wantProgressFor('bob', ['a'])
    await vi.advanceTimersByTimeAsync(150)
    expect(callsTo('https://checker.example/podcasts/progress?').map((c) => c[0])).toEqual([
      'https://checker.example/podcasts/progress?user=bob&ids=a',
    ])
  })
})

describe('usePodcastProgress', () => {
  it('loads a show\'s progress and re-renders when progress changes', async () => {
    routes['https://checker.example/podcasts/progress?'] = reply(200, { progress: { e1: { pos: 400, dur: 1000 } } })
    const { result } = renderHook(() => pp.usePodcastProgress('alice', { feedId: 'f1' }))
    const first = result.current
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(callsTo('https://checker.example/podcasts/progress?')[0][0]).toBe('https://checker.example/podcasts/progress?user=alice&feed=f1')
    expect(pp.progressOf('e1').pos).toBe(400)
    expect(result.current).toBeGreaterThan(first)
  })

  it('loads a list of episode ids', async () => {
    routes['https://checker.example/podcasts/progress?'] = reply(200, { progress: {} })
    renderHook(() => pp.usePodcastProgress('alice', { ids: ['x', 'y'] }))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(callsTo('https://checker.example/podcasts/progress?').map((c) => c[0])).toEqual([
      'https://checker.example/podcasts/progress?user=alice&ids=x,y',
    ])
  })

  it('loads nothing signed out, or without a show or ids', async () => {
    renderHook(() => pp.usePodcastProgress(null, { ids: ['z'] }))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    renderHook(() => pp.usePodcastProgress(null))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('Continue listening', () => {
  it('lists what was left half way and seeds this browser\'s copy', async () => {
    pp.recordProgress('alice', 'old', 990, 1000)
    pp.recordProgress('alice', 'far', 800, 1000)
    const items = [{ id: 'new', kind: 'episode', pos: 300, dur: 1000 }, { id: 'old', pos: 100 }, { id: 'far', pos: 850 }]
    routes['https://checker.example/podcasts/progress/recent'] = reply(200, { items })
    expect(await pp.fetchContinueListening('alice')).toEqual(items)
    expect(bodyOf(callsTo('https://checker.example/podcasts/progress/recent')[0])).toEqual({ user: 'alice', signature: 'SIG', timestamp: NOW })
    expect(pp.progressOf('new').pos).toBe(300)
    expect(pp.progressOf('old').done).toBe(true)
    expect(pp.progressOf('far').pos).toBe(850)
  })

  it('is empty signed out or unproven, and throws on a checker error', async () => {
    expect(await pp.fetchContinueListening(null)).toEqual([])
    routes['https://checker.example/podcasts/progress/recent'] = reply(500, {})
    await expect(pp.fetchContinueListening('alice')).rejects.toThrow('continue listening: 500')
    await load()
    routes['/api/podcasts/signature'] = reply(401, {})
    expect(await pp.fetchContinueListening('alice')).toEqual([])
  })

  it('an answer without items is an empty list', async () => {
    routes['https://checker.example/podcasts/progress/recent'] = reply(200, {})
    expect(await pp.fetchContinueListening('alice')).toEqual([])
  })

  it('hides an item, or brings it back', async () => {
    routes['https://checker.example/podcasts/progress/hide'] = reply(200, {})
    await pp.hideFromContinue('alice', 'ep1')
    await pp.hideFromContinue('alice', 'ep1', false)
    const bodies = callsTo('https://checker.example/podcasts/progress/hide').map(bodyOf)
    expect(bodies.map((b) => b.hidden)).toEqual([true, false])
    expect(bodies[0]).toEqual({ user: 'alice', id: 'ep1', hidden: true, signature: 'SIG', timestamp: NOW })
  })

  it('hiding needs a session and reports a checker error', async () => {
    routes['https://checker.example/podcasts/progress/hide'] = reply(403, {})
    await expect(pp.hideFromContinue('alice', 'ep1')).rejects.toThrow('continue listening hide: 403')
    await load()
    routes['/api/podcasts/signature'] = reply(401, {})
    await expect(pp.hideFromContinue('alice', 'ep1')).rejects.toThrow('not signed in')
  })
})
