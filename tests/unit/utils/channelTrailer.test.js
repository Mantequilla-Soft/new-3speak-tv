// Channel trailer (src/utils/channelTrailer.js): reading it, matching a video
// against it, and setting it with the not-indexed-yet retry and on-chain mirror.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }))
vi.mock('axios', () => ({ default: { get: h.get, put: h.put } }))
vi.mock('../../../src/utils/config', () => ({ CHECKER_URL: 'https://checker.example', CHECKER_API_KEY: 'ck' }))
vi.mock('../../../src/hive-api/hiveApi', () => ({ getAccounts: vi.fn() }))
vi.mock('../../../src/hive-api/aioha', () => ({ broadcastWithAioha: vi.fn(), KeyTypes: { Posting: 'posting' } }))

import { getAccounts } from '../../../src/hive-api/hiveApi'
import { broadcastWithAioha } from '../../../src/hive-api/aioha'
import { fetchChannelTrailer, trailerMatches, setChannelTrailer } from '../../../src/utils/channelTrailer.js'

const httpError = (status) => Object.assign(new Error(`HTTP ${status}`), { response: { status } })

beforeEach(() => {
  h.get.mockReset()
  h.put.mockReset()
  vi.mocked(getAccounts).mockReset()
  vi.mocked(broadcastWithAioha).mockReset()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => { vi.useRealTimers() })

const mirrored = () => JSON.parse(vi.mocked(broadcastWithAioha).mock.calls[0][0][0][1].posting_json_metadata)

describe('fetchChannelTrailer', () => {
  it('reads the trailer for a cleaned username, or null', async () => {
    h.get.mockResolvedValueOnce({ data: { trailer: { author: 'a', permlink: 'p' } } })
    expect(await fetchChannelTrailer(' @Alice ')).toEqual({ author: 'a', permlink: 'p' })
    expect(h.get).toHaveBeenCalledWith('https://checker.example/user/alice/trailer')
    h.get.mockResolvedValueOnce({ data: {} })
    expect(await fetchChannelTrailer('alice')).toBeNull()
    expect(await fetchChannelTrailer('')).toBeNull()
  })

  it('a failed lookup throws rather than reading as "no trailer"', async () => {
    h.get.mockRejectedValue(new Error('down'))
    await expect(fetchChannelTrailer('alice')).rejects.toThrow('down')
  })
})

describe('trailerMatches', () => {
  it('matches author and permlink, ignoring case', () => {
    expect(trailerMatches({ author: 'Alice', permlink: 'My-Video' }, 'alice', 'my-video')).toBe(true)
    expect(trailerMatches({ author: 'alice', permlink: 'p' }, 'bob', 'p')).toBe(false)
    expect(trailerMatches({ author: 'alice', permlink: 'p' }, 'alice', 'q')).toBe(false)
    expect(trailerMatches(null, 'alice', 'p')).toBe(false)
    expect(trailerMatches({ author: 'alice' }, 'alice', undefined)).toBe(false)
  })
})

describe('setChannelTrailer', () => {
  it('saves to the checker and mirrors it on chain, keeping other metadata', async () => {
    h.put.mockResolvedValue({})
    vi.mocked(getAccounts).mockResolvedValue([{ posting_json_metadata: JSON.stringify({ profile: { name: 'A' }, '3speak': { interests: ['music'] } }) }])
    vi.mocked(broadcastWithAioha).mockResolvedValue({ success: true })
    expect(await setChannelTrailer('@Alice', 'trailer-1')).toBe(true)
    expect(h.put).toHaveBeenCalledWith('https://checker.example/user/trailer',
      { username: 'alice', permlink: 'trailer-1', author: 'alice' },
      { headers: { Authorization: 'Bearer ck', 'Content-Type': 'application/json' } })
    const meta = mirrored()
    expect(meta.profile).toEqual({ name: 'A' })
    expect(meta['3speak']).toEqual({ interests: ['music'], channel_trailer: 'alice/trailer-1' })
  })

  it('a trailer by another author is stored with that author', async () => {
    h.put.mockResolvedValue({})
    vi.mocked(getAccounts).mockResolvedValue([{}])
    vi.mocked(broadcastWithAioha).mockResolvedValue({ success: true })
    await setChannelTrailer('alice', 'p', { author: '@Bob' })
    expect(h.put.mock.calls[0][1].author).toBe('bob')
    expect(mirrored()['3speak'].channel_trailer).toBe('bob/p')
  })

  it('clearing removes the on-chain copy too', async () => {
    h.put.mockResolvedValue({})
    vi.mocked(getAccounts).mockResolvedValue([{ posting_json_metadata: '{"3speak":{"channel_trailer":"alice/old","interests":[]}}' }])
    vi.mocked(broadcastWithAioha).mockResolvedValue({ success: true })
    await setChannelTrailer('alice', null)
    expect(h.put.mock.calls[0][1].permlink).toBeNull()
    expect(mirrored()['3speak']).toEqual({ interests: [] })
  })

  it('retries a 404 while the fresh video is still being indexed', async () => {
    vi.useFakeTimers()
    h.put.mockRejectedValueOnce(httpError(404)).mockRejectedValueOnce(httpError(404)).mockResolvedValue({})
    vi.mocked(getAccounts).mockResolvedValue([{}])
    const done = setChannelTrailer('alice', 'p')
    await vi.advanceTimersByTimeAsync(3000 + 6000)
    expect(await done).toBe(true)
    expect(h.put).toHaveBeenCalledTimes(3)
  })

  it('gives up on a 404 after the last retry, and never retries other errors', async () => {
    vi.useFakeTimers()
    h.put.mockRejectedValue(httpError(404))
    const done = setChannelTrailer('alice', 'p').catch((e) => e)
    await vi.advanceTimersByTimeAsync(3000 + 6000 + 10000 + 15000)
    expect((await done).response.status).toBe(404)
    expect(h.put).toHaveBeenCalledTimes(5)
    expect(broadcastWithAioha).not.toHaveBeenCalled()

    h.put.mockReset()
    h.put.mockRejectedValue(httpError(403))
    await expect(setChannelTrailer('alice', 'p')).rejects.toThrow('HTTP 403')
    expect(h.put).toHaveBeenCalledTimes(1)
  })

  it('a failed on-chain mirror does not undo a saved trailer', async () => {
    h.put.mockResolvedValue({})
    vi.mocked(getAccounts).mockRejectedValue(new Error('rpc down'))
    expect(await setChannelTrailer('alice', 'p')).toBe(true)
    vi.mocked(getAccounts).mockResolvedValue([{ posting_json_metadata: '{broken' }])
    vi.mocked(broadcastWithAioha).mockRejectedValue(new Error('rejected'))
    expect(await setChannelTrailer('alice', 'p')).toBe(true)
  })

  it('refuses without a user', async () => {
    await expect(setChannelTrailer('', 'p')).rejects.toThrow('Not logged in')
    expect(h.put).not.toHaveBeenCalled()
  })
})
