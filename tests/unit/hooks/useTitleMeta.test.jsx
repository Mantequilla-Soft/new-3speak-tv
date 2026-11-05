// Translated titles and the summary (src/hooks/useTitleMeta.js): read from the
// translator's meta file, the remembered title language applied only where the
// video has it, and a 404 or failure hiding everything.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

vi.mock('../../../src/utils/config', () => ({ TRANSLATE_API_URL: 'https://translate.test' }))
const { default: useTitleMeta } = await import('../../../src/hooks/useTitleMeta.js')

const META = { summary_en: 'An English summary', summary_de: 'Eine Zusammenfassung', title_translations: { de: 'Hallo Welt', es: 'Hola mundo' } }
let fetchMock
const ok = (data) => ({ ok: true, json: async () => data })

beforeEach(() => {
  localStorage.clear()
  fetchMock = vi.fn(async () => ok(META))
  vi.stubGlobal('fetch', fetchMock)
})

describe('useTitleMeta', () => {
  it('reads the meta file for the video', async () => {
    const { result } = renderHook(() => useTitleMeta('badadib', 'p1'))
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(fetchMock).toHaveBeenCalledWith('https://translate.test/subtitles/badadib/p1/meta')
    expect(result.current).toMatchObject({
      hasTitleTranslations: true, availableLangs: ['de', 'es'], selectedLang: null, translatedTitle: null,
      summary: 'An English summary', hasSummary: true,
    })
  })

  it('choosing a language translates the title and summary, and is remembered', async () => {
    const { result } = renderHook(() => useTitleMeta('badadib', 'p1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => result.current.selectLanguage('de'))
    expect(result.current).toMatchObject({ selectedLang: 'de', translatedTitle: 'Hallo Welt', summary: 'Eine Zusammenfassung' })
    expect(localStorage.getItem('3speak-title-lang')).toBe('de')

    act(() => result.current.selectLanguage('es'))
    expect(result.current.summary).toBe('An English summary') // no Spanish summary: English
    act(() => result.current.selectLanguage(null))
    expect(localStorage.getItem('3speak-title-lang')).toBeNull()
    expect(result.current.translatedTitle).toBeNull()
  })

  it('a remembered language applies only to videos that have it', async () => {
    localStorage.setItem('3speak-title-lang', 'fr')
    const { result } = renderHook(() => useTitleMeta('badadib', 'p1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current).toMatchObject({ selectedLang: null, translatedTitle: null })

    localStorage.setItem('3speak-title-lang', 'es')
    const second = renderHook(() => useTitleMeta('badadib', 'p1'))
    await waitFor(() => expect(second.result.current.translatedTitle).toBe('Hola mundo'))
  })

  it.each([
    ['a 404', async () => ({ ok: false, json: async () => ({}) })],
    ['a network error', async () => { throw new TypeError('Failed to fetch') }],
    ['a meta file with nothing in it', async () => ok({ meta_cid: 'x' })],
  ])('%s hides everything', async (_label, impl) => {
    fetchMock.mockImplementation(impl)
    const { result } = renderHook(() => useTitleMeta('badadib', 'p1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current).toMatchObject({ hasTitleTranslations: false, availableLangs: [], summary: null, hasSummary: false })
  })

  it('without a video asks nothing', () => {
    renderHook(() => useTitleMeta('badadib', ''))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('an answer for a previous video is dropped', async () => {
    let first
    fetchMock.mockImplementationOnce(() => new Promise((r) => { first = r }))
    const { result, rerender } = renderHook(({ p }) => useTitleMeta('badadib', p), { initialProps: { p: 'old' } })
    rerender({ p: 'new' })
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => { first(ok({ summary_en: 'stale', title_translations: {} })) })
    expect(result.current.summary).toBe('An English summary')
  })
})
