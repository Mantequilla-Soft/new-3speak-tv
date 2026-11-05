// Translating a post or comment on demand (src/hooks/useTranslation.js): one
// request per text and language, a per-item "translating" flag, and a cache that
// can be dropped for one item.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const tr = vi.hoisted(() => ({ lang: 'de', translateText: vi.fn() }))
vi.mock('../../../src/utils/translate', () => ({
  getTargetLanguage: () => tr.lang,
  translateText: (...a) => tr.translateText(...a),
}))
const { default: useTranslation } = await import('../../../src/hooks/useTranslation.js')

beforeEach(() => {
  tr.lang = 'de'
  tr.translateText.mockReset().mockImplementation(async (text, lang) => `${lang}:${text}`)
})

describe('useTranslation', () => {
  it('translates into the reader language and flags the item while it works', async () => {
    let resolve
    tr.translateText.mockImplementationOnce(() => new Promise((r) => { resolve = r }))
    const { result } = renderHook(() => useTranslation())
    let pending
    act(() => { pending = result.current.translate('p1', 'Hello') })
    expect(result.current.translating).toEqual({ p1: true })
    await act(async () => { resolve('Hallo'); await pending })
    expect(await pending).toBe('Hallo')
    expect(result.current.translating).toEqual({})
    expect(tr.translateText).toHaveBeenCalledWith('Hello', 'de')
    expect(result.current.getTranslation('p1')).toBe('Hallo')
  })

  it('a second request for the same item and language comes from the cache', async () => {
    const { result } = renderHook(() => useTranslation())
    await act(async () => { await result.current.translate('p1', 'Hello') })
    await act(async () => { await result.current.translate('p1', 'Hello') })
    expect(tr.translateText).toHaveBeenCalledTimes(1)
  })

  it('an explicit language is cached separately', async () => {
    const { result } = renderHook(() => useTranslation())
    await act(async () => { await result.current.translate('p1', 'Hello') })
    await act(async () => { await result.current.translate('p1', 'Hello', 'fr') })
    expect(tr.translateText.mock.calls.map((c) => c[1])).toEqual(['de', 'fr'])
  })

  it('getTranslation reads the current reader language only', async () => {
    const { result } = renderHook(() => useTranslation())
    await act(async () => { await result.current.translate('p1', 'Hello') })
    tr.lang = 'es'
    expect(result.current.getTranslation('p1')).toBeNull()
  })

  it('clearing an item drops every language of it, and only it', async () => {
    const { result } = renderHook(() => useTranslation())
    await act(async () => {
      await result.current.translate('p1', 'a')
      await result.current.translate('p1', 'a', 'fr')
      await result.current.translate('p10', 'b')
    })
    result.current.clearTranslation('p1')
    expect(result.current.getTranslation('p1')).toBeNull()
    expect(result.current.getTranslation('p10')).toBe('de:b')
    await act(async () => { await result.current.translate('p1', 'a', 'fr') })
    expect(tr.translateText).toHaveBeenCalledTimes(4)
  })

  it('a failed translation clears the flag, caches nothing and rethrows', async () => {
    tr.translateText.mockRejectedValueOnce(new Error('quota'))
    const { result } = renderHook(() => useTranslation())
    await act(async () => { await expect(result.current.translate('p1', 'Hello')).rejects.toThrow('quota') })
    expect(result.current.translating).toEqual({})
    expect(result.current.getTranslation('p1')).toBeNull()
  })
})
