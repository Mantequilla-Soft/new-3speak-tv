// @vitest-environment jsdom
// Interface translations (src/i18n/index.js): picking the first language,
// switching languages, English as the fallback for anything missing, the
// community overlay and community languages from /api/i18n, live editor
// changes, and the locale-aware date and number formatting helpers.
//
// Each test loads a fresh copy of the module (it keeps per-page state such as
// "languages already loaded"), with fetch stubbed so nothing leaves the machine.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({ reloadOnceForChunk: vi.fn() }))
vi.mock('../../../src/utils/staleChunk', () => ({ reloadOnceForChunk: h.reloadOnceForChunk }))

let fetchMock
// Routes: { '/api/i18n/languages': body | Error | { status } }
function stubApi(routes = {}) {
  fetchMock = vi.fn(async (url) => {
    const r = routes[url]
    if (r instanceof Error) throw r
    if (r === undefined) return { ok: false, status: 404, json: async () => ({}) }
    if (r && r.__status) return { ok: false, status: r.__status, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => r }
  })
  vi.stubGlobal('fetch', fetchMock)
}

async function load() {
  vi.resetModules()
  const mod = await import('../../../src/i18n/index.js')
  return mod
}

const setBrowserLanguages = (langs) => {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(langs)
}

beforeEach(() => {
  localStorage.clear()
  h.reloadOnceForChunk.mockReset().mockResolvedValue(false)
  stubApi()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('detectBrowserLanguage', () => {
  it.each([
    [['pt-BR', 'en-US'], 'pt'],
    [['zh-Hans-CN'], 'zh'],
    [['xx-YY', 'de-AT'], 'de'],
    [['tl'], 'fil'],
    [['FIL-ph'], 'fil'],
    [['klingon'], 'en'],
    [[], 'en'],
  ])('reads %j as %s', async (langs, expected) => {
    const { detectBrowserLanguage } = await load()
    setBrowserLanguages(langs)
    expect(detectBrowserLanguage()).toBe(expected)
  })
})

describe('initLanguage', () => {
  it('stays in English without fetching an overlay when the browser asks for English', async () => {
    setBrowserLanguages(['en-GB'])
    const { initLanguage, getLanguage, t } = await load()
    await initLanguage()
    expect(getLanguage()).toBe('en')
    expect(t('common.actions.save')).toBe('Save')
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['/api/i18n/languages'])
    expect(document.documentElement.lang).toBe('en')
  })

  it('follows the browser on a first visit without pinning that choice', async () => {
    setBrowserLanguages(['de-DE'])
    const { initLanguage, getLanguage, t } = await load()
    await initLanguage()
    expect(getLanguage()).toBe('de')
    expect(t('common.actions.save')).toBe('Speichern')
    expect(document.documentElement.lang).toBe('de')
    expect(document.documentElement.dir).toBe('ltr')
    expect(localStorage.getItem('3speak_lang')).toBeNull()
  })

  it('prefers a language the person picked earlier over the browser', async () => {
    setBrowserLanguages(['de-DE'])
    localStorage.setItem('3speak_lang', 'es')
    const { initLanguage, t } = await load()
    await initLanguage()
    expect(t('common.actions.save')).toBe('Guardar')
  })

  it('ignores a garbled stored value', async () => {
    setBrowserLanguages(['de'])
    localStorage.setItem('3speak_lang', '<script>')
    const { initLanguage, getLanguage } = await load()
    await initLanguage()
    expect(getLanguage()).toBe('de')
  })

  it('falls back to English when a stored community language no longer exists', async () => {
    localStorage.setItem('3speak_lang', 'xq')
    stubApi({ '/api/i18n/languages': [] })
    const { initLanguage, getLanguage } = await load()
    await initLanguage()
    expect(getLanguage()).toBe('en')
  })

  it('still works when storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    setBrowserLanguages(['es'])
    const { initLanguage, getLanguage } = await load()
    await initLanguage()
    expect(getLanguage()).toBe('es')
  })
})

describe('setLanguage', () => {
  it('switches language, remembers it, and keeps interpolation and plurals working', async () => {
    const { setLanguage, t } = await load()
    await setLanguage('ru')
    expect(localStorage.getItem('3speak_lang')).toBe('ru')
    expect(t('common.units.views', { count: 1 })).toBe('1 просмотр')
    expect(t('common.units.views', { count: 3 })).toBe('3 просмотра')
    expect(t('common.units.views', { count: 5 })).toBe('5 просмотров')
  })

  it('does not escape interpolated values, since React already escapes output', async () => {
    const { t } = await load()
    expect(t('watch.follow.followed', { user: '<b>al&ce</b>' })).toBe('Followed @<b>al&ce</b>')
  })

  it('treats an unknown, malformed code as English', async () => {
    const { setLanguage, getLanguage } = await load()
    await setLanguage('not a language')
    expect(getLanguage()).toBe('en')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not overwrite storage when remember is off', async () => {
    const { setLanguage } = await load()
    await setLanguage('de', { remember: false })
    expect(localStorage.getItem('3speak_lang')).toBeNull()
  })

  it('survives storage that refuses writes', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    const { setLanguage, getLanguage } = await load()
    await expect(setLanguage('de')).resolves.toBeUndefined()
    expect(getLanguage()).toBe('de')
  })

  it('loads a language only once', async () => {
    const { setLanguage } = await load()
    await setLanguage('de')
    await setLanguage('en')
    await setLanguage('de')
    expect(fetchMock.mock.calls.filter((c) => c[0] === '/api/i18n/overlay/de')).toHaveLength(1)
  })
})

describe('community overlay', () => {
  it('lays saved community strings over the bundled text', async () => {
    stubApi({ '/api/i18n/overlay/de': { 'common.actions.save': 'Sichern' } })
    const { setLanguage, t } = await load()
    await setLanguage('de')
    await vi.waitFor(() => expect(t('common.actions.save')).toBe('Sichern'))
    expect(t('common.actions.cancel')).toBe('Abbrechen')
  })

  it('shows the bundled text when the API is down', async () => {
    stubApi({ '/api/i18n/overlay/de': new Error('offline') })
    const { setLanguage, t } = await load()
    await setLanguage('de')
    expect(t('common.actions.save')).toBe('Speichern')
  })

  it.each([
    ['an array', ['x']],
    ['a string', 'x'],
    ['an error status', { __status: 500 }],
  ])('treats %s from the overlay endpoint as no overlay', async (_name, body) => {
    stubApi({ '/api/i18n/overlay/de': body })
    const { fetchOverlay } = await load()
    expect(await fetchOverlay('de')).toBeNull()
  })

  it('never asks for an English or a malformed overlay', async () => {
    const { fetchOverlay } = await load()
    expect(await fetchOverlay('en')).toBeNull()
    expect(await fetchOverlay('../../etc')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('can bypass the HTTP cache', async () => {
    stubApi({ '/api/i18n/overlay/de': {} })
    const { fetchOverlay } = await load()
    await fetchOverlay('de', { fresh: true })
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: 'no-store' })
  })

  it('gives up on a slow overlay after 2.5 seconds', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_url, { signal }) => new Promise((_res, rej) => {
      signal.addEventListener('abort', () => rej(new Error('aborted')))
    })))
    const { fetchOverlay } = await load()
    const pending = fetchOverlay('de')
    await vi.advanceTimersByTimeAsync(2500)
    expect(await pending).toBeNull()
  })

  it('applies only well-formed keys with non-empty text', async () => {
    const { setLanguage, applyOverlay, t } = await load()
    await setLanguage('de')
    applyOverlay('de', {
      'common.actions.save': 'Sichern',
      'common.actions.cancel': '',
      'common.actions.close': 42,
      badkey: 'x',
      'common.actions.de lete': 'x',
    })
    expect(t('common.actions.save')).toBe('Sichern')
    expect(t('common.actions.cancel')).toBe('Abbrechen')
    expect(t('badkey')).toBe('badkey')
  })

  it('never touches English', async () => {
    const { applyOverlay, t } = await load()
    applyOverlay('en', { 'common.actions.save': 'Hacked' })
    applyOverlay('de', null)
    expect(t('common.actions.save')).toBe('Save')
  })
})

describe('community languages', () => {
  const lang = (extra = {}) => ({ code: 'xq', native: 'Xq native', english: 'Xq', ...extra })

  it('adds valid languages once, trims long names, keeps rtl, and tells subscribers', async () => {
    const { registerCommunityLanguages, getAllLanguages, subscribeLanguages, findLanguage } = await load()
    const listener = vi.fn()
    const unsubscribe = subscribeLanguages(listener)
    const before = getAllLanguages()
    registerCommunityLanguages([
      lang({ native: 'N'.repeat(60), dir: 'rtl' }),
      lang(),
      { code: 'BAD' },
      { code: 'de' },
      null,
      { code: 'xr' },
    ])
    expect(listener).toHaveBeenCalledTimes(1)
    expect(getAllLanguages()).not.toBe(before)
    expect(findLanguage('xq')).toEqual({ code: 'xq', native: 'N'.repeat(40), english: 'Xq', dir: 'rtl', community: true })
    expect(findLanguage('xr')).toEqual({ code: 'xr', native: 'xr', english: 'xr', community: true })
    expect(getAllLanguages().filter((l) => l.code === 'de')).toHaveLength(1)

    unsubscribe()
    registerCommunityLanguages([{ code: 'xs' }])
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('keeps the same list object when nothing new arrives', async () => {
    const { registerCommunityLanguages, getAllLanguages } = await load()
    const before = getAllLanguages()
    registerCommunityLanguages([{ code: 'en' }])
    registerCommunityLanguages('nope')
    expect(getAllLanguages()).toBe(before)
  })

  it('fetches the list once per page and never rejects', async () => {
    stubApi({ '/api/i18n/languages': new Error('offline') })
    const { loadCommunityLanguages } = await load()
    await expect(Promise.all([loadCommunityLanguages(), loadCommunityLanguages()])).resolves.toBeDefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('switches to a community language: overlay text where there is some, English elsewhere', async () => {
    stubApi({
      '/api/i18n/languages': [lang({ dir: 'rtl' })],
      '/api/i18n/overlay/xq': { 'common.actions.save': 'Xsave' },
    })
    const { setLanguage, getLanguage, t } = await load()
    await setLanguage('xq')
    expect(getLanguage()).toBe('xq')
    expect(t('common.actions.save')).toBe('Xsave')
    expect(t('common.actions.cancel')).toBe('Cancel')
    expect(document.documentElement.dir).toBe('rtl')
  })
})

describe('applyLiveChanges (the in-app editor)', () => {
  it('sets new text, restores bundled text, and falls back to English for a removed override', async () => {
    const { setLanguage, applyLiveChanges, t } = await load()
    await setLanguage('de')
    applyLiveChanges('de', { 'common.actions.save': 'Sichern' })
    expect(t('common.actions.save')).toBe('Sichern')

    applyLiveChanges('de', { 'common.actions.save': null }, { 'common.actions.save': 'Speichern' })
    expect(t('common.actions.save')).toBe('Speichern')

    applyLiveChanges('de', { 'common.actions.cancel': null })
    expect(t('common.actions.cancel')).toBe('Cancel')
  })

  it('re-announces the language so the screen re-renders', async () => {
    const { setLanguage, applyLiveChanges, default: i18n } = await load()
    await setLanguage('de')
    const changed = vi.fn()
    i18n.on('languageChanged', changed)
    applyLiveChanges('de', { 'common.actions.save': 'x' })
    expect(changed).toHaveBeenCalledWith('de')
    i18n.off('languageChanged', changed)
  })

  it('ignores English, malformed keys, and paths that do not exist', async () => {
    const { setLanguage, applyLiveChanges, t } = await load()
    applyLiveChanges('en', { 'common.actions.save': 'Hacked' })
    await setLanguage('de')
    expect(() => applyLiveChanges('de', { 'no space allowed': 'x', 'nope.missing.key': null })).not.toThrow()
    expect(t('common.actions.save')).toBe('Speichern')
  })
})

describe('bundled files', () => {
  it('gives the editor English as bundled and any language flat, without the overlay', async () => {
    stubApi({ '/api/i18n/overlay/de': { 'common.actions.save': 'Sichern' } })
    const { getEnglishResources, loadBundledFlat } = await load()
    expect(getEnglishResources().common.actions.save).toBe('Save')
    expect((await loadBundledFlat('en'))['common.actions.save']).toBe('Save')
    const de = await loadBundledFlat('de')
    expect(de['common.actions.save']).toBe('Speichern')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a language with no bundled files is empty', async () => {
    const { loadBundledFlat } = await load()
    expect(await loadBundledFlat('xq')).toEqual({})
  })
})

describe('a locale file that fails to load', () => {
  afterEach(() => {
    vi.doUnmock('../../../src/locales/de/common.json')
  })

  it('costs only that area: English shows there, the rest is German, and a reload is tried once', async () => {
    vi.doMock('../../../src/locales/de/common.json', () => { throw new Error('chunk gone') })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { setLanguage, t } = await load()
    await setLanguage('de')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('de: 1 file(s) failed to load: common'))
    expect(h.reloadOnceForChunk).toHaveBeenCalledWith('locale:de')
    expect(t('common.actions.save')).toBe('Save')
    expect(t('watch.title', { defaultValue: '' })).not.toBe('')
  })
})

describe('formatting', () => {
  const NOW = new Date('2026-06-15T12:00:00Z')
  const ago = (s) => new Date(NOW.getTime() - s * 1000)
  const DAY = 86400

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })

  it.each([
    [30, 'just now'],
    [90, '1 minute ago'],
    [3 * 3600, '3 hours ago'],
    [DAY, 'yesterday'],
    [3 * DAY, '3 days ago'],
    [400 * DAY, 'last year'],
  ])('formatTimeAgo: %i seconds ago reads "%s"', async (s, text) => {
    const { formatTimeAgo } = await load()
    expect(formatTimeAgo(ago(s))).toBe(text)
  })

  it('formatTimeAgo handles strings, the narrow style and bad input', async () => {
    const { formatTimeAgo } = await load()
    expect(formatTimeAgo(ago(3 * DAY).toISOString(), { style: 'narrow' })).toBe('3d ago')
    expect(formatTimeAgo('not a date')).toBe('')
  })

  it('formatTimeAgo follows the current language', async () => {
    const { formatTimeAgo, setLanguage } = await load()
    await setLanguage('de')
    expect(formatTimeAgo(ago(2 * DAY))).toBe('vorgestern')
    expect(formatTimeAgo(ago(5))).toBe('gerade eben')
  })

  it.each([
    ['en', 5 * DAY, '5d ago'],
    ['es', 5 * DAY, 'hace 5 d'],
    ['fr', 5 * DAY, 'il y a 5 j'],
    ['ru', 5 * DAY, '5 дн. назад'],
    ['de', 5 * DAY, 'vor 5 Tg.'],
    ['de', 2 * 3600, 'vor 2 Std.'],
    ['nl', 5 * DAY, '5 d'],
    ['fil', 5 * DAY, '5 araw'],
    ['sw', 31 * DAY, 'mwezi 1'],
    ['sw', 160 * DAY, 'miezi 5'],
  ])('formatTimeAgoCompact in %s: %i seconds ago reads "%s"', async (lang, s, text) => {
    const { formatTimeAgoCompact, setLanguage } = await load()
    await setLanguage(lang)
    // Some languages separate with a no-break space; compare the visible text.
    expect(formatTimeAgoCompact(ago(s)).replace(/\s/g, ' ')).toBe(text)
  })

  it('formatTimeAgoCompact reads a future date (clock skew) and the last minute as "just now"', async () => {
    const { formatTimeAgoCompact } = await load()
    expect(formatTimeAgoCompact(new Date(NOW.getTime() + 60000))).toBe('just now')
    expect(formatTimeAgoCompact(ago(59))).toBe('just now')
    expect(formatTimeAgoCompact('garbage')).toBe('')
  })

  it.each([
    [999, 999],
    [1250, '1k'],
    [15300, '15k'],
    [-2500, '-2k'],
    [2_750_000, '2M'],
    ['1200', '1k'],
    ['abc', 'abc'],
  ])('formatCountCompact(%j) is %j', async (n, out) => {
    const { formatCountCompact } = await load()
    expect(formatCountCompact(n)).toBe(out)
  })

  it.each([
    [0, 'today'],
    [-2, 'today'],
    [1, 'yesterday'],
    [6, '6 days ago'],
    [14, '2 weeks ago'],
    [90, '3 months ago'],
    [800, '2 years ago'],
  ])('formatDaysAgo: %i days back reads "%s"', async (days, text) => {
    const { formatDaysAgo } = await load()
    expect(formatDaysAgo(ago(days * DAY))).toBe(text)
  })

  it('formatDaysAgo returns nothing for an invalid date', async () => {
    const { formatDaysAgo } = await load()
    expect(formatDaysAgo('nope')).toBe('')
  })

  it('formatNumber groups digits per language and has a compact form', async () => {
    const { formatNumber, setLanguage } = await load()
    expect(formatNumber(1234567)).toBe('1,234,567')
    expect(formatNumber('x')).toBe('0')
    expect(formatNumber(1250, { compact: true })).toBe('1.3K')
    await setLanguage('de')
    expect(formatNumber(1234567)).toBe('1.234.567')
  })

  it('formatDate formats per language and returns nothing for an invalid date', async () => {
    const { formatDate, setLanguage } = await load()
    // Local midday (no "Z"): the same calendar day in every time zone the suite runs in.
    expect(formatDate('2026-03-04T12:00:00')).toBe('Mar 4, 2026')
    expect(formatDate(new Date('2026-03-04T12:00:00'), { year: 'numeric' })).toBe('2026')
    expect(formatDate('nope')).toBe('')
    await setLanguage('de')
    expect(formatDate('2026-03-04T12:00:00')).toBe('04.03.2026')
  })
})
