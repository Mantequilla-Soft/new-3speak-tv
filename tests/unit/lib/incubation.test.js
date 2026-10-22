// Incubating (warm-up) users with no Hive account: the handle kept apart from
// user_id, checker reads, proxied writes with the wallet-session retry, goal
// progress maths, and the paced backfill to Hive after graduation
// (src/lib/incubation.js).
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const aioha = vi.hoisted(() => ({ establishWalletSession: vi.fn(), isManteAuthLogin: vi.fn(() => true) }))
vi.mock('../../../src/hive-api/aioha', () => aioha)

import * as inc from '../../../src/lib/incubation.js'

const C = 'https://checker.3speak.tv'
const res = (status, body = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const DAY = 24 * 60 * 60 * 1000

let fetchMock
beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  aioha.establishWalletSession.mockReset()
  aioha.isManteAuthLogin.mockReset().mockReturnValue(true)
  fetchMock = vi.fn().mockResolvedValue(res(200, {}))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.useRealTimers())

describe('the incubation handle', () => {
  it('lives in its own key, never in user_id', () => {
    localStorage.setItem('user_id', 'realhive')
    expect(inc.currentHandle()).toBeNull()
    expect(inc.isIncubating()).toBe(false)
    localStorage.setItem('incubation_handle', 'newbie')
    expect(inc.currentHandle()).toBe('newbie')
    expect(inc.isIncubating()).toBe(true)
    inc.clearIncubation()
    expect(inc.isIncubating()).toBe(false)
    expect(localStorage.getItem('user_id')).toBe('realhive')
  })

  it('everyone without a Hive account shares the 3Speak avatar', () => {
    expect(inc.handleAvatar('a')).toBe('/pwa-192x192.png')
    expect(inc.handleAvatar('b')).toBe(inc.handleAvatar('a'))
  })
})

describe('checker reads', () => {
  it('resolves authors in one deduplicated, lowercased call, chunked at 100', async () => {
    fetchMock.mockImplementation(async (_u, opts) => res(200, { authors: Object.fromEntries(JSON.parse(opts.body).handles.map((h) => [h, { handle: h }])) }))
    const handles = Array.from({ length: 250 }, (_, i) => `U${i}`)
    const out = await inc.resolveAuthors([...handles, 'u0', null, ''])
    expect(Object.keys(out)).toHaveLength(250)
    expect(out.u0).toEqual({ handle: 'u0' })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[0][0]).toBe(`${C}/incubation/authors`)
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).handles).toHaveLength(50)
  })

  it('resolves nothing for no handles', async () => {
    expect(await inc.resolveAuthors([])).toEqual({})
    expect(await inc.resolveAuthors(null)).toEqual({})
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws the server error with status and reason', async () => {
    fetchMock.mockResolvedValue(res(403, { error: 'nope', reason: 'banned' }))
    await expect(inc.fetchIncubationFeed()).rejects.toMatchObject({ message: 'nope', status: 403, reason: 'banned' })
  })

  it('a post that is gone (404) or now on Hive (409) is null', async () => {
    fetchMock.mockResolvedValueOnce(res(404)).mockResolvedValueOnce(res(409)).mockResolvedValueOnce(res(200, { title: 't' }))
    expect(await inc.fetchIncubationPost('a', 'p')).toBeNull()
    expect(await inc.fetchIncubationPost('a', 'p')).toBeNull()
    expect(await inc.fetchIncubationPost('a', 'p 1')).toEqual({ title: 't' })
    expect(fetchMock.mock.calls[2][0]).toBe(`${C}/incubation/post/a/p%201`)
  })

  it('builds the read URLs', async () => {
    await inc.fetchIncubationProfile('ann', 'bob')
    await inc.fetchIncubationProfile('ann')
    await inc.fetchIncubationPosts('ann')
    await inc.fetchIncubationShorts(5)
    await inc.fetchIncubationReplies('alice', 'vid', 10)
    await inc.fetchIncubationLikes('ann', 'p', 'bob')
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      `${C}/incubation/profile/ann?viewer=bob`,
      `${C}/incubation/profile/ann`,
      `${C}/incubation/user/ann/posts?limit=30`,
      `${C}/incubation/feed?contentType=short&limit=5`,
      `${C}/incubation/replies?parentAuthor=alice&parentPermlink=vid&limit=10`,
      `${C}/incubation/likes?author=ann&permlink=p&viewer=bob`,
    ])
  })

  it('batches like counts, skipping incomplete items', async () => {
    expect(await inc.fetchIncubationLikesFor([{ author: 'a' }, null])).toEqual({})
    expect(fetchMock).not.toHaveBeenCalled()
    fetchMock.mockResolvedValue(res(200, { items: { 'a/p': { count: 2 } } }))
    expect(await inc.fetchIncubationLikesFor([{ author: 'a', permlink: 'p' }, { permlink: 'x' }])).toEqual({ 'a/p': { count: 2 } })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ items: [{ author: 'a', permlink: 'p' }] })
  })
})

describe('public profile reads', () => {
  it('lowercase the handle and send no cookies', async () => {
    await inc.fetchIncubationFollowers('Alice')
    await inc.fetchIncubationUserComments('Bob', 5)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/incubation/public/user/alice/followers?limit=100')
    expect(fetchMock.mock.calls[0][1]).toEqual({ credentials: 'omit' })
    expect(fetchMock.mock.calls[1][0]).toBe('/api/incubation/public/user/bob/comments?limit=5')
  })
})

describe('writes through our own server', () => {
  it('send cookies and a JSON body, and no body on GET', async () => {
    await inc.voteIncubation('a', 'p', 100)
    await inc.fetchMyIncubationProfile()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/incubation/social/vote')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'PUT', credentials: 'include' })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ author: 'a', permlink: 'p', weight: 100 })
    expect(fetchMock.mock.calls[1][1].body).toBeUndefined()
  })

  it('a Hive wallet user with a lapsed session re-mints it once and retries', async () => {
    aioha.establishWalletSession.mockResolvedValue(true)
    fetchMock.mockResolvedValueOnce(res(401)).mockResolvedValueOnce(res(200, { ok: 1 }))
    expect(await inc.voteIncubation('a', 'p', 1)).toEqual({ ok: 1 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('an incubating user is never sent to a wallet on 401', async () => {
    localStorage.setItem('incubation_handle', 'newbie')
    fetchMock.mockResolvedValue(res(401, { error: 'expired' }))
    await expect(inc.voteIncubation('a', 'p', 1)).rejects.toMatchObject({ status: 401 })
    expect(aioha.establishWalletSession).not.toHaveBeenCalled()
  })

  it('follow sends the state words the service expects', async () => {
    await inc.followIncubationUser('ann', true)
    await inc.followIncubationUser('ann', false)
    await inc.subscribeIncubation('hive-1', false)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ following: 'ann', state: 'following' })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ following: 'ann', state: 'unfollowed' })
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ community: 'hive-1', state: 'unsubscribed' })
  })
})

describe('progress announcements', () => {
  it('fire only after a goal-moving write lands', async () => {
    const heard = vi.fn()
    const off = inc.onIncubationProgress(heard)
    let release
    fetchMock.mockReturnValueOnce(new Promise((r) => { release = r }))
    const p = inc.postIncubationContent({ title: 'x' })
    await Promise.resolve()
    expect(heard).not.toHaveBeenCalled()
    release(res(200, {}))
    await p
    expect(heard).toHaveBeenCalledTimes(1)

    fetchMock.mockResolvedValueOnce(res(500, {}))
    await expect(inc.setIncubationTrack('creator')).rejects.toThrow()
    expect(heard).toHaveBeenCalledTimes(1)
    off()
    inc.notifyIncubationProgress()
    expect(heard).toHaveBeenCalledTimes(1)
  })
})

describe('advertiser contact', () => {
  it('saving announces progress; failures throw the server message', async () => {
    const heard = vi.fn()
    const off = inc.onIncubationProgress(heard)
    fetchMock.mockResolvedValueOnce(res(200, { ok: true }))
    await inc.saveWarmupContact({ email: 'a@b.c', address: 'x' })
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'PUT', credentials: 'include' })
    expect(heard).toHaveBeenCalledTimes(1)
    fetchMock.mockResolvedValueOnce(res(400, { error: 'bad email' }))
    await expect(inc.saveWarmupContact({ email: 'x' })).rejects.toThrow('bad email')
    fetchMock.mockResolvedValueOnce(res(401, {}))
    await expect(inc.fetchWarmupContact()).rejects.toThrow()
    off()
  })

  it('the admin view is null for anyone not allowed', async () => {
    fetchMock.mockResolvedValueOnce(res(404))
    expect(await inc.fetchAdvertiserAdminView('ann')).toBeNull()
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    expect(await inc.fetchAdvertiserAdminView('ann')).toBeNull()
  })
})

describe('goal progress', () => {
  it('counted goals are have/need, clamped', () => {
    expect(inc.taskFraction({ have: 7, need: 10 })).toBe(0.7)
    expect(inc.taskFraction({ have: 12, need: 5 })).toBe(1)
    expect(inc.taskFraction({ have: -1, need: 5 })).toBe(0)
    expect(inc.taskFraction({ have: 3 })).toBe(0)
    expect(inc.taskFraction(null)).toBe(0)
  })

  it('a done goal is full, whatever the counts say', () => {
    expect(inc.taskFraction({ done: true, have: 0, need: 10 })).toBe(1)
  })

  it('a goal measured in days moves with the clock towards readyAt', () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.UTC(2026, 9, 22, 12))
    const readyAt = new Date(Date.now() + 2 * DAY).toISOString()
    expect(inc.taskFraction({ unit: 'days', need: 3, have: 0, readyAt })).toBeCloseTo(1 / 3)
    expect(inc.taskFraction({ unit: 'days', need: 3, readyAt: new Date(Date.now() - DAY).toISOString() })).toBe(1)
    expect(inc.taskFraction({ unit: 'days', need: 3, readyAt: new Date(Date.now() + 5 * DAY).toISOString() })).toBe(0)
    expect(inc.taskFraction({ unit: 'days', need: 3, have: 1, readyAt: 'garbage' })).toBeCloseTo(1 / 3)
  })

  it('every goal is an equal share of the bar, and overshooting one cannot borrow', () => {
    expect(inc.progressFraction([{ have: 12, need: 5 }, { have: 0, need: 5 }])).toBe(0.5)
    expect(inc.progressFraction([{ done: true }, { have: 1, need: 4 }, { have: 0, need: 1 }, { have: 1, need: 1 }])).toBeCloseTo((1 + 0.25 + 0 + 1) / 4)
    expect(inc.progressFraction([])).toBe(0)
    expect(inc.progressFraction(undefined)).toBe(0)
  })

  it('the bar hue runs from red (4) to green (142)', () => {
    expect(inc.progressHue(0)).toBe(4)
    expect(inc.progressHue(1)).toBe(142)
    expect(inc.progressHue(0.5)).toBe(73)
    expect(inc.progressHue(2)).toBe(142)
    expect(inc.progressHue('x')).toBe(4)
  })
})

describe('graduation status', () => {
  it('canGraduate is the whole answer; awaiting approval is not a refusal', () => {
    expect(inc.canCreateAccount({ canGraduate: true })).toBe(true)
    expect(inc.canCreateAccount({ canGraduate: false, awaitingApproval: true })).toBe(false)
    expect(inc.canCreateAccount(null)).toBe(false)
    expect(inc.isAwaitingApproval({ awaitingApproval: true })).toBe(true)
    expect(inc.isAwaitingApproval(undefined)).toBe(false)
  })
})

describe('backfill', () => {
  it('refuses locally for a non-Butter-Auth login instead of prompting a wallet', async () => {
    aioha.isManteAuthLogin.mockReturnValue(false)
    await expect(inc.fetchBackfillItems()).rejects.toMatchObject({ status: 401, reason: 'not_butrauth' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reads the backlog for a Butter Auth login', async () => {
    fetchMock.mockResolvedValue(res(200, { items: [] }))
    expect(await inc.fetchBackfillSummary()).toEqual({ items: [] })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/incubation/backfill/summary')
  })

  it('claims assets once per browser session, and retries after a failure', async () => {
    fetchMock.mockResolvedValueOnce(res(500, {}))
    await expect(inc.claimAssetsOnce()).rejects.toThrow()
    fetchMock.mockResolvedValueOnce(res(200, { claimed: 2 }))
    expect(await inc.claimAssetsOnce()).toEqual({ claimed: 2 })
    expect(await inc.claimAssetsOnce()).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('waits 5 minutes between root posts (chain rule)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.UTC(2026, 9, 22, 12))
    expect(inc.rootPostWaitMs()).toBe(0)
    localStorage.setItem('backfill_last_root_post_at', String(Date.now() - 60 * 1000))
    expect(inc.rootPostWaitMs()).toBe(4 * 60 * 1000)
    localStorage.setItem('backfill_last_root_post_at', 'junk')
    expect(inc.lastRootPostAt()).toBe(0)
  })
})

describe('publishBackfill', () => {
  const reply = (id) => ({ id, type: 'comment', isRootPost: false, op: ['comment', { permlink: `re-${id}` }] })
  const root = (id) => ({ id, type: 'post', isRootPost: true, op: ['comment', { permlink: `post-${id}` }] })

  it('broadcasts each item, marks it published and paces replies 3s apart', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.UTC(2026, 9, 22, 12))
    const progress = []
    const p = inc.publishBackfill([root('a'), reply('b')], (item, status) => progress.push(`${item.id}:${status}`))
    await vi.advanceTimersByTimeAsync(3000)
    expect(await p).toEqual(['a', 'b'])
    expect(progress).toEqual(['a:publishing', 'a:done', 'b:publishing', 'b:done'])

    const urls = fetchMock.mock.calls.map((c) => c[0])
    expect(urls).toEqual(['/api/broadcast', '/api/incubation/backfill/mark', '/api/broadcast', '/api/incubation/backfill/mark'])
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ operations: [root('a').op] })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ type: 'post', id: 'a', permlink: 'post-a' })
    expect(inc.lastRootPostAt()).toBe(Date.UTC(2026, 9, 22, 12))
  })

  it('stops at a root post that would break the 5 minute rule', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.UTC(2026, 9, 22, 12))
    localStorage.setItem('backfill_last_root_post_at', String(Date.now() - 1000))
    const onProgress = vi.fn()
    expect(await inc.publishBackfill([root('a'), reply('b')], onProgress)).toEqual([])
    expect(onProgress).toHaveBeenCalledWith(root('a'), 'waiting', 5 * 60 * 1000 - 1000)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('stops at the first failure and reports it', async () => {
    fetchMock.mockResolvedValueOnce(res(400, { error: 'RC exhausted' }))
    const onProgress = vi.fn()
    expect(await inc.publishBackfill([root('a'), root('b')], onProgress)).toEqual([])
    expect(onProgress).toHaveBeenLastCalledWith(root('a'), 'error', 'RC exhausted')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
