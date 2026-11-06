// Captions on a video (src/hooks/useSubtitles.js): the language list and the
// cues, both fetched once and shared (a failure is retried next time), which
// language shows (saved CC choice, then device language, then English), captions
// staying off for a viewer who never turned them on, an author's correction
// showing at once, and the remembered caption style.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

vi.mock('../../../src/utils/config', () => ({ TRANSLATE_API_URL: 'https://translate.test', CHECKER_URL: 'https://checker.test' }))

const SRT = '1\n00:00:01,000 --> 00:00:02,500\nHello there\n\n2\n00:00:03,000 --> 00:00:04,000\nSecond line\n'
const LIST = [{ lang: 'en', cid: 'QmEn' }, { lang: 'de', cid: 'QmDe' }, { lang: 'pt-BR', cid: 'QmPt' }]
let fetchMock
let mod
let languages

const listUrl = 'https://translate.test/subtitles/badadib/p1'
const proxied = (cid) => `https://checker.test/subtitle-proxy/${cid}`
const calls = (url) => fetchMock.mock.calls.filter(([u]) => u === url).length

beforeEach(async () => {
  localStorage.clear()
  languages = ['en-US', 'en']
  vi.spyOn(navigator, 'languages', 'get').mockImplementation(() => languages)
  fetchMock = vi.fn(async (url) => {
    if (url.startsWith('https://translate.test')) return { ok: true, json: async () => LIST }
    return { ok: true, text: async () => SRT }
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.resetModules()
  mod = await import('../../../src/hooks/useSubtitles.js')
})
afterEach(() => vi.restoreAllMocks())

describe('pickSubtitleLang', () => {
  it.each([
    ['the saved choice first', 'de', ['fr'], 'de'],
    ['the saved choice, whatever its case', 'DE', ['fr'], 'de'],
    ['the device language next', null, ['pt-BR'], 'pt-BR'],
    ['a device dialect offers its base language', null, ['de-AT'], 'de'],
    ['English last', null, ['fr-FR'], 'en'],
    ['a saved choice the video lacks falls through', 'ja', ['de'], 'de'],
  ])('%s', (_label, saved, device, expected) => {
    if (saved) localStorage.setItem(mod.SUBTITLE_LANG_KEY, saved)
    languages = device
    expect(mod.pickSubtitleLang(LIST)).toBe(expected)
  })

  it('nothing matching is null, or any language as a last resort', () => {
    languages = ['fr']
    const list = [{ lang: 'es', cid: 'x' }]
    expect(mod.pickSubtitleLang(list)).toBeNull()
    expect(mod.pickSubtitleLang(list, { anyAsLastResort: true })).toBe('es')
    expect(mod.pickSubtitleLang([])).toBeNull()
  })
})

describe('listSubtitleLanguages', () => {
  it('fetches the list once per video, shared by every caller', async () => {
    const [a, b] = await Promise.all([mod.listSubtitleLanguages('badadib', 'p1'), mod.listSubtitleLanguages('badadib', 'p1')])
    expect(a).toEqual(LIST)
    expect(b).toBe(a)
    expect(calls(listUrl)).toBe(1)
  })

  it('a failure is an empty list, and the next call tries again', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 })
    expect(await mod.listSubtitleLanguages('badadib', 'p1')).toEqual([])
    expect(await mod.listSubtitleLanguages('badadib', 'p1')).toEqual(LIST)
    expect(calls(listUrl)).toBe(2)
  })

  it('an answer that is not a list is empty', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ error: 'x' }) })
    expect(await mod.listSubtitleLanguages('badadib', 'p1')).toEqual([])
  })

  it.each([['', 'p1'], ['badadib', ''], ['unknown', 'p1']])('asks nothing for %s/%s', async (a, p) => {
    expect(await mod.listSubtitleLanguages(a, p)).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('loadSubtitleCues', () => {
  it('fetches the file through our proxy and parses it, once', async () => {
    const cues = await mod.loadSubtitleCues('badadib', 'p1', LIST[0])
    await mod.loadSubtitleCues('badadib', 'p1', LIST[0])
    expect(cues).toEqual([{ start: 1, end: 2.5, text: 'Hello there' }, { start: 3, end: 4, text: 'Second line' }])
    expect(calls(proxied('QmEn'))).toBe(1)
  })

  it('a proxy failure rejects and is retried on the next call', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 502 })
    await expect(mod.loadSubtitleCues('badadib', 'p1', LIST[0])).rejects.toThrow('subtitle-proxy responded 502')
    await expect(mod.loadSubtitleCues('badadib', 'p1', LIST[0])).resolves.toHaveLength(2)
  })

  it('an entry without a file is no cues', async () => {
    expect(await mod.loadSubtitleCues('badadib', 'p1', { lang: 'en' })).toEqual([])
    expect(await mod.loadSubtitleCues('badadib', 'p1', null)).toEqual([])
  })
})

describe('prefetchSubtitles', () => {
  it('warms the list and the cues a preview would show', async () => {
    mod.prefetchSubtitles('badadib', 'p1')
    await waitFor(() => expect(calls(proxied('QmEn'))).toBe(1))
  })

  it('warms no cues when no language would show', async () => {
    languages = ['fr']
    fetchMock.mockImplementation(async () => ({ ok: true, json: async () => [{ lang: 'es', cid: 'QmEs' }] }))
    mod.prefetchSubtitles('badadib', 'p1')
    await waitFor(() => expect(calls(listUrl)).toBe(1))
    await new Promise((r) => setTimeout(r, 0))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('useSubtitles', () => {
  it('lists the languages but keeps captions off for a viewer who never turned them on', async () => {
    const { result } = renderHook(() => mod.default('badadib', 'p1'))
    await waitFor(() => expect(result.current.availableLanguages).toEqual(LIST))
    expect(result.current.selectedLang).toBeNull()
    expect(result.current.cues).toEqual([])
    expect(calls(proxied('QmEn'))).toBe(0)
  })

  it('shows the saved language for a viewer who turned CC on before', async () => {
    localStorage.setItem(mod.SUBTITLE_LANG_KEY, 'de')
    const { result } = renderHook(() => mod.default('badadib', 'p1'))
    await waitFor(() => expect(result.current.cues).toHaveLength(2))
    expect(result.current.selectedLang).toBe('de')
    expect(calls(proxied('QmDe'))).toBe(1)
    expect(result.current.loading).toBe(false)
  })

  it('autoSelect shows captions without saving a choice', async () => {
    const { result } = renderHook(() => mod.default('badadib', 'p1', { autoSelect: true }))
    await waitFor(() => expect(result.current.selectedLang).toBe('en'))
    expect(localStorage.getItem(mod.SUBTITLE_LANG_KEY)).toBeNull()
  })

  it('choosing a language saves it, turning CC off forgets it', async () => {
    const { result } = renderHook(() => mod.default('badadib', 'p1'))
    await waitFor(() => expect(result.current.availableLanguages).toEqual(LIST))
    act(() => result.current.selectLanguage('pt-BR'))
    await waitFor(() => expect(result.current.cues).toHaveLength(2))
    expect(localStorage.getItem(mod.SUBTITLE_LANG_KEY)).toBe('pt-BR')
    act(() => result.current.selectLanguage(null))
    expect(result.current.cues).toEqual([])
    expect(localStorage.getItem(mod.SUBTITLE_LANG_KEY)).toBeNull()
  })

  it('a language the video does not have shows no cues', async () => {
    const { result } = renderHook(() => mod.default('badadib', 'p1'))
    await waitFor(() => expect(result.current.availableLanguages).toEqual(LIST))
    act(() => result.current.selectLanguage('ja'))
    expect(result.current.cues).toEqual([])
  })

  it('a video without subtitles has no language list', async () => {
    fetchMock.mockImplementation(async () => ({ ok: true, json: async () => [] }))
    const { result } = renderHook(() => mod.default('badadib', 'p1'))
    await waitFor(() => expect(calls(listUrl)).toBe(1))
    expect(result.current.availableLanguages).toBeNull()
  })

  it('an unknown author asks nothing', () => {
    const { result } = renderHook(() => mod.default('unknown', 'p1'))
    expect(result.current.availableLanguages).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a caption file that cannot be loaded shows no cues and is logged', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    localStorage.setItem(mod.SUBTITLE_LANG_KEY, 'en')
    fetchMock.mockImplementation(async (url) => (url === listUrl ? { ok: true, json: async () => LIST } : { ok: false, status: 502 }))
    const { result } = renderHook(() => mod.default('badadib', 'p1'))
    await waitFor(() => expect(log).toHaveBeenCalled())
    expect(result.current).toMatchObject({ cues: [], loading: false })
  })

  it('an author\'s correction replaces the lines on screen and in the caches', async () => {
    localStorage.setItem(mod.SUBTITLE_LANG_KEY, 'en')
    const { result } = renderHook(() => mod.default('badadib', 'p1'))
    await waitFor(() => expect(result.current.cues).toHaveLength(2))
    const fixed = [{ start: 1, end: 2, text: 'Corrected' }]
    act(() => mod.publishSubtitleEdit('badadib', 'p1', 'en', 'QmFixed', fixed))
    expect(result.current.cues).toEqual(fixed)
    expect(await mod.loadSubtitleCues('badadib', 'p1', { lang: 'en', cid: 'QmFixed' })).toEqual(fixed)
    expect((await mod.listSubtitleLanguages('badadib', 'p1')).find((l) => l.lang === 'en').cid).toBe('QmFixed')
  })

  it('a correction for another video or language is ignored', async () => {
    localStorage.setItem(mod.SUBTITLE_LANG_KEY, 'en')
    const { result } = renderHook(() => mod.default('badadib', 'p1'))
    await waitFor(() => expect(result.current.cues).toHaveLength(2))
    act(() => mod.publishSubtitleEdit('badadib', 'p1', 'de', 'QmX', []))
    act(() => mod.publishSubtitleEdit('badadib', 'other', 'en', 'QmY', []))
    expect(result.current.cues).toHaveLength(2)
  })

  it('stops listening for corrections once unmounted', async () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    const { unmount } = renderHook(() => mod.default('badadib', 'p1'))
    unmount()
    expect(remove).toHaveBeenCalledWith(mod.SUBTITLES_UPDATED_EVENT, expect.any(Function))
  })
})

describe('the caption style', () => {
  it('starts from the defaults', () => {
    const { result } = renderHook(() => mod.default('', ''))
    expect(result.current.subtitleStyle).toEqual({ fontSize: 'medium', color: '#ffffff', bgOpacity: 0.7, fontFamily: 'sans-serif', borderWidth: 0, borderColor: '#000000' })
  })

  it('merges changes and remembers them for next time', () => {
    const { result } = renderHook(() => mod.default('', ''))
    act(() => result.current.updateStyle({ fontSize: 'large' }))
    act(() => result.current.updateStyle({ color: '#ffff00' }))
    expect(result.current.subtitleStyle).toMatchObject({ fontSize: 'large', color: '#ffff00', bgOpacity: 0.7 })
    const again = renderHook(() => mod.default('', ''))
    expect(again.result.current.subtitleStyle).toMatchObject({ fontSize: 'large', color: '#ffff00' })
  })

  it('a corrupt saved style falls back to the defaults', () => {
    localStorage.setItem('3speak-subtitle-style', '{not json')
    const { result } = renderHook(() => mod.default('', ''))
    expect(result.current.subtitleStyle.fontSize).toBe('medium')
  })
})
