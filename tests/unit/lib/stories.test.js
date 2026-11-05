// @vitest-environment jsdom
// The client side of 24h stories (src/lib/stories.js): the seen list kept on
// this device, the stories row and notification hooks, the countdown ring,
// registering a fresh story with retries, and keeping a story as a short
// (signed by @threespeak, or by the wallet when that grant is missing).
// React Query, the store, aioha and i18n are mocked; axios and fetch are stubbed.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const h = vi.hoisted(() => ({
  query: { data: undefined, isLoading: false },
  queries: [],
  invalidate: vi.fn(),
  store: { user: null, showNsfw: false },
  axiosGet: vi.fn(),
  axiosPost: vi.fn(),
  aioha: {
    signMessageWithAioha: vi.fn(),
    getCurrentProvider: vi.fn(),
    isManteAuthLogin: vi.fn(),
    establishWalletSession: vi.fn(),
  },
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options) => { h.queries.push(options); return h.query },
  useQueryClient: () => ({ invalidateQueries: h.invalidate }),
}))
vi.mock('axios', () => ({ default: { get: h.axiosGet, post: h.axiosPost } }))
vi.mock('../../../src/utils/config', () => ({ STORIES_URL: 'https://checker.test/stories' }))
vi.mock('../../../src/lib/store', () => ({
  useAppStore: (selector) => (selector ? selector(h.store) : h.store),
}))
vi.mock('../../../src/i18n', () => ({ t: (key) => key }))
vi.mock('../../../src/hive-api/aioha', () => ({
  ...h.aioha,
  KeyTypes: { Posting: 'posting' },
  Providers: { Keychain: 'keychain', HiveAuth: 'hiveauth', PeakVault: 'peakvault', Ledger: 'ledger', HiveSigner: 'hivesigner' },
}))

import {
  isStorySeenLocally,
  markStorySeen,
  markStoriesSeen,
  useStoryCreators,
  useStoryNotifications,
  storyTimeLeft,
  useStoryClock,
  storyViewerPath,
  useInvalidateStories,
  registerStory,
  STREAK_MIN,
  useStoryStreak,
  useStorySeenBy,
  keepStoryAsShort,
} from '../../../src/lib/stories.js'

const SEEN_KEY = '3speak_seen_stories'
const lastQuery = () => h.queries.at(-1)
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

beforeEach(() => {
  localStorage.clear()
  h.query = { data: undefined, isLoading: false }
  h.queries = []
  h.store = { user: null, showNsfw: false }
  h.invalidate.mockReset()
  h.axiosGet.mockReset()
  h.axiosPost.mockReset()
  Object.values(h.aioha).forEach((f) => f.mockReset())
})
afterEach(() => vi.useRealTimers())

describe('the seen list on this device', () => {
  it('marks a story seen by asset and Hive permlink and tells the page', () => {
    const heard = vi.fn()
    window.addEventListener('3speak-stories-seen', heard)
    markStorySeen('alice', 'asset1', 'hive-1', null)
    window.removeEventListener('3speak-stories-seen', heard)
    expect(isStorySeenLocally('alice', 'asset1')).toBe(true)
    expect(isStorySeenLocally('alice', 'hive-1')).toBe(true)
    expect(isStorySeenLocally('bob', 'asset1')).toBe(false)
    expect(heard).toHaveBeenCalledTimes(1)
  })

  it('does nothing when there is nothing new to mark', () => {
    markStorySeen('alice', 'a')
    const heard = vi.fn()
    window.addEventListener('3speak-stories-seen', heard)
    markStorySeen('alice', 'a')
    markStorySeen('', 'b')
    window.removeEventListener('3speak-stories-seen', heard)
    expect(heard).not.toHaveBeenCalled()
  })

  it('forgets entries older than two days when it writes', () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.parse('2026-06-01T00:00:00Z'))
    markStorySeen('alice', 'old')
    vi.setSystemTime(Date.parse('2026-06-03T00:00:01Z'))
    markStorySeen('alice', 'new')
    expect(Object.keys(JSON.parse(localStorage.getItem(SEEN_KEY)))).toEqual(['alice/new'])
  })

  it.each([
    ['broken JSON', '{nope'],
    ['a non-object', '42'],
    ['null', 'null'],
  ])('treats %s in storage as nothing seen', (_, raw) => {
    localStorage.setItem(SEEN_KEY, raw)
    expect(isStorySeenLocally('alice', 'x')).toBe(false)
  })

  it('still tells the page when storage cannot be written', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    const heard = vi.fn()
    window.addEventListener('3speak-stories-seen', heard)
    expect(() => markStorySeen('alice', 'x')).not.toThrow()
    window.removeEventListener('3speak-stories-seen', heard)
    expect(heard).toHaveBeenCalled()
  })

  it('marks every unseen story in a list', () => {
    markStoriesSeen([
      { owner: 'a', permlink: 'p1', hive_permlink: 'h1' },
      { owner: 'b', permlink: 'p2', seen: true },
    ])
    markStoriesSeen(null)
    expect(isStorySeenLocally('a', 'p1')).toBe(true)
    expect(isStorySeenLocally('a', 'h1')).toBe(true)
    expect(isStorySeenLocally('b', 'p2')).toBe(false)
  })
})

describe('useStoryCreators', () => {
  it('asks for the signed-in user and NSFW setting and reads the row', async () => {
    h.store = { user: 'alice', showNsfw: true }
    h.query = { data: { creators: [{ username: 'bob' }], currentUserHasStory: 1, currentUserStreak: '3' }, isLoading: false }
    h.axiosGet.mockResolvedValue({ data: 'payload' })
    const { result } = renderHook(() => useStoryCreators())
    expect(result.current).toEqual({
      storyCreators: [{ username: 'bob' }], currentUserHasStory: true, currentUserStreak: 3, isLoading: false,
    })
    expect(lastQuery().queryKey).toEqual(['stories', 'alice', true])
    expect(await lastQuery().queryFn()).toBe('payload')
    expect(h.axiosGet).toHaveBeenCalledWith('https://checker.test/stories', { params: { currentuser: 'alice', nsfw: 'true' } })
  })

  it('answers an empty row while signed out and loading', async () => {
    h.query = { data: undefined, isLoading: true }
    h.axiosGet.mockResolvedValue({ data: null })
    const { result } = renderHook(() => useStoryCreators())
    expect(result.current).toEqual({ storyCreators: [], currentUserHasStory: false, currentUserStreak: 0, isLoading: true })
    await lastQuery().queryFn()
    expect(h.axiosGet).toHaveBeenCalledWith('https://checker.test/stories', { params: {} })
  })
})

describe('useStoryNotifications', () => {
  it('marks stories seen from the checker or this device and counts the rest', () => {
    markStorySeen('carol', 'hive-c')
    h.query = {
      data: {
        stories: [
          { owner: 'alice', permlink: 'a', hive_permlink: 'ha', seen: true },
          { owner: 'bob', permlink: 'b', hive_permlink: 'hb' },
          { owner: 'carol', permlink: 'c', hive_permlink: 'hive-c' },
        ],
      },
    }
    const { result } = renderHook(() => useStoryNotifications('me'))
    expect(result.current.stories.map((s) => s.seen)).toEqual([true, false, true])
    expect(result.current.unseenCount).toBe(1)
  })

  it('recomputes after a story is marked seen in this tab or another one', () => {
    h.query = { data: { stories: [{ owner: 'bob', permlink: 'b' }] } }
    const { result } = renderHook(() => useStoryNotifications('me'))
    expect(result.current.unseenCount).toBe(1)
    act(() => markStorySeen('bob', 'b'))
    expect(result.current.unseenCount).toBe(0)

    localStorage.clear()
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'other' })) })
    expect(result.current.unseenCount).toBe(0)
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: SEEN_KEY })) })
    expect(result.current.unseenCount).toBe(1)
  })

  it('queries the followed stories only for a signed-in user', async () => {
    h.store = { showNsfw: true }
    h.axiosGet.mockResolvedValue({ data: { stories: [] } })
    renderHook(() => useStoryNotifications(null))
    expect(lastQuery().enabled).toBe(false)
    renderHook(() => useStoryNotifications('me'))
    expect(lastQuery()).toMatchObject({ enabled: true, queryKey: ['story-notifications', 'me', true] })
    await lastQuery().queryFn()
    expect(h.axiosGet).toHaveBeenCalledWith('https://checker.test/stories/following', { params: { currentuser: 'me', nsfw: 'true' } })
  })
})

describe('storyTimeLeft', () => {
  const posted = '2026-06-01T00:00:00Z'
  const expires = '2026-06-02T00:00:00Z'
  const at = (iso) => Date.parse(iso)

  it.each([
    ['at the start', at(posted), 1],
    ['half way', at('2026-06-01T12:00:00Z'), 0.5],
    ['after expiry', at('2026-06-03T00:00:00Z'), 0],
    ['before posting', at('2026-05-31T00:00:00Z'), 1],
  ])('%s', (_, now, expected) => {
    expect(storyTimeLeft(posted, expires, now)).toBeCloseTo(expected)
  })

  it.each([
    ['an unreadable start', 'nope', expires],
    ['an unreadable end', posted, 'nope'],
    ['an end before the start', expires, posted],
  ])('draws a full ring for %s', (_, p, e) => {
    expect(storyTimeLeft(p, e, Date.now())).toBe(1)
  })
})

describe('useStoryClock', () => {
  it('ticks on the interval and stops when unmounted', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const { result, unmount } = renderHook(() => useStoryClock(500))
    expect(result.current).toBe(1000)
    act(() => { vi.advanceTimersByTime(500) })
    expect(result.current).toBe(1500)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('storyViewerPath and useInvalidateStories', () => {
  it('opens the creator stories in the viewer', () => {
    expect(storyViewerPath('a b')).toBe('/shorts/stories?user=a%20b&story=1')
  })

  it('refreshes both story lists', () => {
    const { result } = renderHook(() => useInvalidateStories())
    result.current()
    expect(h.invalidate.mock.calls).toEqual([[{ queryKey: ['stories'] }], [{ queryKey: ['story-notifications'] }]])
  })
})

describe('registerStory', () => {
  it('answers the registered story on success', async () => {
    h.axiosPost.mockResolvedValue({ data: { success: true, story: { id: 1 } } })
    expect(await registerStory('alice', 'p')).toEqual({ id: 1 })
    expect(h.axiosPost).toHaveBeenCalledWith('https://checker.test/stories/register', { author: 'alice', permlink: 'p' }, { timeout: 15000 })
  })

  it('waits and tries again while the post is not readable yet', async () => {
    vi.useFakeTimers()
    h.axiosPost
      .mockRejectedValueOnce(Object.assign(new Error('not yet'), { response: { status: 404, data: { retry: true } } }))
      .mockRejectedValueOnce(Object.assign(new Error('502'), { response: { status: 502 } }))
      .mockResolvedValueOnce({ data: { success: true, story: 'ok' } })
    const pending = registerStory('alice', 'p', { delayMs: 1000 })
    await vi.advanceTimersByTimeAsync(2000)
    expect(await pending).toBe('ok')
    expect(h.axiosPost).toHaveBeenCalledTimes(3)
  })

  it('gives up at once on a refusal that will not change', async () => {
    const refused = Object.assign(new Error('forbidden'), { response: { status: 403, data: {} } })
    h.axiosPost.mockRejectedValue(refused)
    await expect(registerStory('alice', 'p')).rejects.toBe(refused)
    expect(h.axiosPost).toHaveBeenCalledTimes(1)
  })

  it('throws the last checker error after the last attempt', async () => {
    vi.useFakeTimers()
    h.axiosPost.mockResolvedValue({ data: { success: false, error: 'not a story' } })
    const pending = registerStory('alice', 'p', { attempts: 2, delayMs: 10 })
    const settled = expect(pending).rejects.toThrow('not a story')
    await vi.advanceTimersByTimeAsync(20)
    await settled
  })

  it('throws a plain error when there were no attempts', async () => {
    await expect(registerStory('a', 'p', { attempts: 0 })).rejects.toThrow('register failed')
  })

  it('uses a generic message when the checker gives none', async () => {
    vi.useFakeTimers()
    h.axiosPost.mockResolvedValue({ data: {} })
    const pending = registerStory('a', 'p', { attempts: 1, delayMs: 1 })
    const settled = expect(pending).rejects.toThrow('register failed')
    await vi.advanceTimersByTimeAsync(1)
    await settled
  })
})

describe('useStoryStreak and useStorySeenBy', () => {
  it('reads the streak, numbers made safe', async () => {
    expect(STREAK_MIN).toBe(2)
    h.query = { data: { streak: '4', postedToday: 1 } }
    h.axiosGet.mockResolvedValue({ data: 'streak' })
    const { result } = renderHook(() => useStoryStreak('a b'))
    expect(result.current).toEqual({ streak: 4, postedToday: true })
    expect(await lastQuery().queryFn()).toBe('streak')
    expect(h.axiosGet).toHaveBeenCalledWith('https://checker.test/stories/streak/a%20b')
  })

  it('answers no streak without data', () => {
    const { result } = renderHook(() => useStoryStreak(null))
    expect(result.current).toEqual({ streak: 0, postedToday: false })
    expect(lastQuery().enabled).toBe(false)
  })

  it('lists who watched, only when author, permlink and the switch are all set', async () => {
    h.query = { data: { count: '2', viewers: [{ username: 'x' }] }, isLoading: false }
    h.axiosGet.mockResolvedValue({ data: 'seen' })
    const { result } = renderHook(() => useStorySeenBy('alice', 'hp'))
    expect(result.current).toEqual({ count: 2, viewers: [{ username: 'x' }], isLoading: false })
    expect(lastQuery().enabled).toBe(true)
    await lastQuery().queryFn()
    expect(h.axiosGet).toHaveBeenCalledWith('https://checker.test/stories/seen', { params: { author: 'alice', permlink: 'hp' } })
    renderHook(() => useStorySeenBy('alice', 'hp', false))
    expect(lastQuery().enabled).toBe(false)
    h.query = {}
    const empty = renderHook(() => useStorySeenBy('alice', null))
    expect(empty.result.current).toMatchObject({ count: 0, viewers: [] })
  })
})

describe('keepStoryAsShort', () => {
  // fetch router: the sign route answers from `sign` (a list consumed in order),
  // the keep route from `keep`.
  function stubFetch({ sign = [], keep = json(200, { success: true, kept: { permlink: 'kept' } }) }) {
    const f = vi.fn(async (url) => {
      if (url === '/api/stories/keep-signature') return sign.shift()
      if (url === 'https://checker.test/stories/keep') return keep
      throw new Error(`unexpected ${url}`)
    })
    vi.stubGlobal('fetch', f)
    return f
  }
  const bodyOf = (f, url) => JSON.parse(f.mock.calls.find((c) => c[0] === url)[1].body)

  it('signs through @threespeak with the HiveSigner token and keeps the story', async () => {
    h.aioha.getCurrentProvider.mockReturnValue('hivesigner')
    localStorage.setItem('hivesignerToken', 'tok')
    const f = stubFetch({ sign: [json(200, { signature: 'sig', timestamp: 5, username: 'Alice' })] })
    expect(await keepStoryAsShort('alice', 'hp')).toEqual({ permlink: 'kept' })
    const signCall = f.mock.calls[0][1]
    expect(signCall.headers.Authorization).toBe('Bearer tok')
    expect(signCall.credentials).toBe('include')
    expect(JSON.parse(signCall.body)).toEqual({ permlink: 'hp', username: 'alice' })
    expect(bodyOf(f, 'https://checker.test/stories/keep')).toEqual({ author: 'alice', permlink: 'hp', signature: 'sig', timestamp: 5 })
  })

  it('re-mints a lapsed wallet session once and asks again', async () => {
    h.aioha.getCurrentProvider.mockReturnValue('keychain')
    h.aioha.isManteAuthLogin.mockReturnValue(false)
    h.aioha.establishWalletSession.mockResolvedValue(true)
    const f = stubFetch({
      sign: [json(401, { reason: 'not_signed_in_as' }), json(200, { signature: 's2', timestamp: 9 })],
    })
    await keepStoryAsShort('alice', 'hp')
    expect(h.aioha.establishWalletSession).toHaveBeenCalledWith('alice')
    expect(f.mock.calls[0][1].headers.Authorization).toBeUndefined()
    expect(bodyOf(f, 'https://checker.test/stories/keep').signature).toBe('s2')
  })

  it('falls back to a wallet signature over the exact keep message', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(123456)
    h.aioha.getCurrentProvider.mockReturnValue('keychain')
    h.aioha.isManteAuthLogin.mockReturnValue(false)
    h.aioha.signMessageWithAioha.mockResolvedValue({ success: true, result: 'wallet-sig' })
    const f = stubFetch({ sign: [json(500, { error: 'no grant' })] })
    await keepStoryAsShort('alice', 'hp')
    expect(h.aioha.signMessageWithAioha).toHaveBeenCalledWith(
      '3speak-stories|keep|alice|hp|123456', 'posting', 'shorts.storyTools.keepWalletPrompt',
    )
    expect(bodyOf(f, 'https://checker.test/stories/keep')).toMatchObject({ signature: 'wallet-sig', timestamp: 123456 })
  })

  it('refuses a signature made for another account', async () => {
    h.aioha.getCurrentProvider.mockReturnValue('hivesigner')
    stubFetch({ sign: [json(200, { signature: 's', username: 'mallory' })] })
    await expect(keepStoryAsShort('alice', 'hp')).rejects.toThrow('shorts.storyTools.keepFailed')
  })

  it('surfaces the signer error when no wallet can sign instead', async () => {
    h.aioha.getCurrentProvider.mockReturnValue('hivesigner')
    stubFetch({ sign: [{ ok: false, status: 500, json: async () => { throw new Error('html') } }] })
    await expect(keepStoryAsShort('alice', 'hp')).rejects.toThrow('shorts.storyTools.keepFailed')
  })

  it('surfaces a rejected wallet signature', async () => {
    h.aioha.getCurrentProvider.mockReturnValue('ledger')
    h.aioha.isManteAuthLogin.mockReturnValue(false)
    h.aioha.signMessageWithAioha.mockResolvedValue({ success: false })
    stubFetch({ sign: [json(403, { error: 'grant missing' })] })
    await expect(keepStoryAsShort('alice', 'hp')).rejects.toThrow('shorts.storyTools.keepFailed')
  })

  it('surfaces the checker refusal to keep an expired story', async () => {
    h.aioha.getCurrentProvider.mockReturnValue('hivesigner')
    stubFetch({ sign: [json(200, { signature: 's' })], keep: json(410, { error: 'story expired' }) })
    await expect(keepStoryAsShort('alice', 'hp')).rejects.toThrow('story expired')
  })

  it('uses the generic message when the keep answer is unreadable', async () => {
    h.aioha.getCurrentProvider.mockReturnValue('hivesigner')
    stubFetch({ sign: [json(200, { signature: 's' })], keep: { ok: true, status: 200, json: async () => { throw new Error('x') } } })
    await expect(keepStoryAsShort('alice', 'hp')).rejects.toThrow('shorts.storyTools.keepFailed')
  })
})
