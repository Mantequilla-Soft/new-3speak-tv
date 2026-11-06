// Mirroring live chat to Hive (src/hooks/useStreamChatMirror.js): each line a
// signed-in viewer sends becomes their own timecoded comment on the stream's
// post, with the exact comment handed to the signer checked here. Guests, and
// streams without a post, mirror nothing.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

const store = vi.hoisted(() => ({ authenticated: true }))
vi.mock('../../../src/lib/store', () => ({ useAppStore: (sel) => sel(store) }))
const signer = vi.hoisted(() => ({ commentWithAioha: vi.fn() }))
vi.mock('../../../src/hive-api/aioha', () => ({ commentWithAioha: (...a) => signer.commentWithAioha(...a) }))
const { useStreamChatMirror } = await import('../../../src/hooks/useStreamChatMirror.js')

const START = Date.UTC(2026, 6, 19, 12, 0, 0)
const stream = { author: 'badadib', permlink: 'live-1', startedAt: '2026-07-19T12:00:00', hasPost: true }
const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  vi.useFakeTimers({ now: START + 125_000, toFake: ['Date'] })
  store.authenticated = true
  signer.commentWithAioha.mockReset().mockResolvedValue({ success: true })
})
afterEach(() => vi.useRealTimers())

describe('a mirrored chat line', () => {
  it('is a reply to the stream post, timecoded from the UTC start, authored by the viewer', () => {
    const { result } = renderHook(() => useStreamChatMirror(stream))
    result.current('hello stream')
    expect(signer.commentWithAioha).toHaveBeenCalledTimes(1)
    const [parentAuthor, parentPermlink, permlink, title, body, metadata] = signer.commentWithAioha.mock.calls[0]
    expect([parentAuthor, parentPermlink, title]).toEqual(['badadib', 'live-1', ''])
    expect(permlink).toBe(`re-live-1-${START + 125_000}`)
    expect(body).toBe(`hello stream\n<br><sup>said at [02:05](${window.location.origin}/watch?v=badadib/live-1) during the live stream</sup>`)
    expect(metadata).toEqual({ app: '3speak/new-version', parentTimestamp: 125 })
  })

  it.each([
    ['2026-07-19T12:00:00Z', 125],
    ['2026-07-19T14:00:00+02:00', 125],
    [START, 125],
  ])('reads the start %s the same way', (startedAt, seconds) => {
    const { result } = renderHook(() => useStreamChatMirror({ ...stream, startedAt }))
    result.current('x')
    expect(signer.commentWithAioha.mock.calls[0][5].parentTimestamp).toBe(seconds)
  })

  it.each([
    ['a start in the future', '2026-07-19T13:00:00'],
    ['an unreadable start', 'not a date'],
    ['no start at all', null],
  ])('%s counts from now (00:00)', (_label, startedAt) => {
    const { result } = renderHook(() => useStreamChatMirror({ ...stream, startedAt }))
    result.current('x')
    expect(signer.commentWithAioha.mock.calls[0][4]).toContain('said at [00:00]')
    expect(signer.commentWithAioha.mock.calls[0][5].parentTimestamp).toBe(0)
  })

  it('never throws or rejects when the broadcast fails', async () => {
    vi.useRealTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    signer.commentWithAioha.mockRejectedValue(new Error('RC exhausted'))
    const { result } = renderHook(() => useStreamChatMirror(stream))
    expect(() => result.current('x')).not.toThrow()
    await flush()
    expect(warn).toHaveBeenCalledWith('[stream chat] Hive comment failed:', 'RC exhausted')
  })
})

describe('what is not mirrored', () => {
  it.each([
    ['a guest', { }, { authenticated: false }],
    ['a stream without a Hive post', { hasPost: false }, {}],
    ['a stream without an author', { author: '' }, {}],
    ['a stream without a permlink', { permlink: null }, {}],
  ])('%s', (_label, override, storeOverride) => {
    Object.assign(store, storeOverride)
    const { result } = renderHook(() => useStreamChatMirror({ ...stream, ...override }))
    result.current('x')
    expect(signer.commentWithAioha).not.toHaveBeenCalled()
  })
})
