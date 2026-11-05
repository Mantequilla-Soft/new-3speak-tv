// The GIF picker list (src/hooks/useGiphySearch.js): trending as soon as the
// picker opens, a debounced search while typing, and a late answer never
// overwriting a newer one. Also the plain .gif URL the Hive renderer embeds.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useGiphySearch, { normalizeGifUrl } from '../../../src/hooks/useGiphySearch.js'

let fetchMock
const answer = (data) => ({ json: async () => ({ data }) })
const advance = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock = vi.fn(async (url) => answer([{ id: url.includes('/search') ? 'found' : 'trend' }]))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.useRealTimers())

describe('normalizeGifUrl', () => {
  it.each([
    [{ images: { fixed_height: { url: 'https://media.giphy.com/a.gif?cid=1' } } }, 'https://media.giphy.com/a.gif'],
    [{ images: { original: { url: 'https://media.giphy.com/b.gif' } } }, 'https://media.giphy.com/b.gif'],
    [{ images: {} }, ''],
    [null, ''],
  ])('%o -> %s', (gif, url) => {
    expect(normalizeGifUrl(gif)).toBe(url)
  })
})

describe('useGiphySearch', () => {
  it('stays idle while the picker is closed', async () => {
    renderHook(() => useGiphySearch(false))
    await advance(1000)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('loads trending GIFs right away when opened', async () => {
    const { result } = renderHook(() => useGiphySearch(true))
    await advance(0)
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/v1\/gifs\/trending\?.*limit=24&rating=pg-13/)
    expect(result.current.gifs).toEqual([{ id: 'trend' }])
    expect(result.current.loading).toBe(false)
  })

  it('waits for typing to pause before searching, once', async () => {
    const { result } = renderHook(() => useGiphySearch(true))
    await advance(0)
    act(() => result.current.setQuery('ca'))
    await advance(200)
    act(() => result.current.setQuery(' cats & dogs '))
    await advance(349)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await advance(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][0]).toContain('/search?')
    expect(fetchMock.mock.calls[1][0]).toContain(`q=${encodeURIComponent('cats & dogs')}`)
    expect(result.current.gifs).toEqual([{ id: 'found' }])
  })

  it('a slow earlier answer does not replace a newer one', async () => {
    let slow
    fetchMock.mockImplementationOnce(() => new Promise((r) => { slow = r }))
    const { result } = renderHook(() => useGiphySearch(true))
    await advance(0)
    act(() => result.current.setQuery('cats'))
    await advance(350)
    expect(result.current.gifs).toEqual([{ id: 'found' }])
    await act(async () => { slow(answer([{ id: 'stale-trending' }])) })
    expect(result.current.gifs).toEqual([{ id: 'found' }])
  })

  it('shows an empty list when the request fails or the answer is malformed', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    const { result } = renderHook(() => useGiphySearch(true))
    await advance(0)
    expect(result.current).toMatchObject({ gifs: [], loading: false })
    fetchMock.mockResolvedValueOnce({ json: async () => ({ data: 'nope' }) })
    act(() => result.current.setQuery('x'))
    await advance(350)
    expect(result.current.gifs).toEqual([])
  })

  it('closing the picker cancels a pending search', async () => {
    const { result, rerender } = renderHook(({ on }) => useGiphySearch(on), { initialProps: { on: true } })
    await advance(0)
    act(() => result.current.setQuery('cats'))
    rerender({ on: false })
    await advance(1000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
