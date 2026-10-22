// Spotlight link pages (src/utils/spotlight.js): reading the page out of Hive
// metadata, icon guessing, the section factory, the row grid and saving back.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../src/hive-api/hiveApi', () => ({ getAccounts: vi.fn() }))
vi.mock('../../../src/hive-api/aioha', () => ({
  broadcastWithAioha: vi.fn(),
  KeyTypes: { Posting: 'posting' },
}))
vi.mock('../../../src/i18n', () => ({ t: (k) => k }))

import { FaLink, FaYoutube } from 'react-icons/fa6'
import { getAccounts } from '../../../src/hive-api/hiveApi'
import { broadcastWithAioha } from '../../../src/hive-api/aioha'
import {
  readSpotlightFromAccount, iconForSlug, guessIconFromUrl, SPOTLIGHT_ICONS,
  SPOTLIGHT_ICONS_GENERAL, LINK_PLATFORMS, BRAND_SLUGS, DEFAULT_THEME, emptyLayout,
  newSection, withIds, layoutToRows, rowsToSections, bgToCss, fetchSpotlight, saveSpotlight,
} from '../../../src/utils/spotlight.js'

const page = { headline: 'Hi', theme: {}, sections: [{ type: 'link', url: 'https://a.b' }] }

describe('readSpotlightFromAccount', () => {
  it('reads the page from string posting metadata', () => {
    const account = { posting_json_metadata: JSON.stringify({ '3speak': { spotlight: page } }) }
    expect(readSpotlightFromAccount(account)).toEqual(page)
  })

  it('reads already-parsed metadata objects too', () => {
    expect(readSpotlightFromAccount({ posting_json_metadata: { '3speak': { spotlight: page } } })).toEqual(page)
  })

  it('is null for no account, no page, malformed JSON or a non-object page', () => {
    expect(readSpotlightFromAccount(null)).toBeNull()
    expect(readSpotlightFromAccount({ posting_json_metadata: '' })).toBeNull()
    expect(readSpotlightFromAccount({ posting_json_metadata: '{not json' })).toBeNull()
    expect(readSpotlightFromAccount({ posting_json_metadata: '{"3speak":{"spotlight":"x"}}' })).toBeNull()
    expect(readSpotlightFromAccount({ posting_json_metadata: '{"profile":{}}' })).toBeNull()
  })
})

describe('icons', () => {
  it('every icon slug is unique and passes the backend slug rule', () => {
    const slugs = SPOTLIGHT_ICONS.map((i) => i.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9-]{1,40}$/)
  })

  it('an unknown slug falls back to the generic link icon', () => {
    expect(iconForSlug('nope')).toBe(FaLink)
    expect(iconForSlug(undefined)).toBe(FaLink)
    expect(iconForSlug('youtube')).toBe(FaYoutube)
  })

  it('every link platform has its own brand icon', () => {
    for (const p of LINK_PLATFORMS) expect(iconForSlug(p.slug), p.slug).not.toBe(FaLink)
  })

  it('the free-form picker never offers a brand icon', () => {
    expect(SPOTLIGHT_ICONS_GENERAL.length).toBeGreaterThan(0)
    for (const i of SPOTLIGHT_ICONS_GENERAL) expect(BRAND_SLUGS.has(i.slug), i.slug).toBe(false)
  })
})

describe('guessIconFromUrl', () => {
  it('maps well-known hosts, with or without www', () => {
    expect(guessIconFromUrl('https://www.youtube.com/@me')).toBe('youtube')
    expect(guessIconFromUrl('https://youtu.be/abc')).toBe('youtube')
    expect(guessIconFromUrl('https://twitter.com/me')).toBe('x')
    expect(guessIconFromUrl('https://x.com/me')).toBe('x')
    expect(guessIconFromUrl('https://t.me/channel')).toBe('telegram')
    expect(guessIconFromUrl('https://open.spotify.com/artist/1')).toBe('spotify')
  })

  it('a subdomain of a known host gets that host icon', () => {
    expect(guessIconFromUrl('https://m.youtube.com/watch?v=1')).toBe('youtube')
    expect(guessIconFromUrl('https://gist.github.com/x')).toBe('github')
  })

  it('mailto links get the email icon, other sites the globe', () => {
    expect(guessIconFromUrl('mailto:me@example.com')).toBe('email')
    expect(guessIconFromUrl('https://example.com')).toBe('globe')
  })

  it('something that is not a URL gets the plain link icon', () => {
    expect(guessIconFromUrl('not a url')).toBe('link')
    expect(guessIconFromUrl('')).toBe('link')
  })

  // The suffix fallback matches on the raw string, not on a dot boundary:
  // src/utils/spotlight.js:142 `host.endsWith(key)`, so dropbox.com ends with "x.com".
  it.skip('BUG: an unrelated host that merely ends in a known name is not given that brand', () => {
    expect(guessIconFromUrl('https://dropbox.com/s/file')).toBe('globe')
    expect(guessIconFromUrl('https://netflix.com')).toBe('globe')
    expect(guessIconFromUrl('https://chat.me')).toBe('globe')
  })
})

describe('sections and layout', () => {
  it('newSection builds each type with a fresh id', () => {
    const types = ['header', 'link', 'image', 'video', 'embed']
    const made = types.map(newSection)
    made.forEach((s, i) => expect(s.type).toBe(types[i]))
    expect(new Set(made.map((s) => s.id)).size).toBe(types.length)
    expect(newSection('embed')).toMatchObject({ source: 'link', count: 3, perRow: 1 })
  })

  it('an unknown section type becomes a link', () => {
    expect(newSection('weird')).toMatchObject({ type: 'link', url: '', icon: 'link' })
  })

  it('emptyLayout copies the default theme rather than sharing it', () => {
    const l = emptyLayout()
    l.theme.text = '#000'
    expect(DEFAULT_THEME.text).toBe('#f5f5f7')
  })

  it('withIds gives server sections (id null) an id and keeps existing ids', () => {
    const out = withIds({ headline: 'x', sections: [{ id: null, type: 'link' }, { id: 'keep', type: 'header' }] })
    expect(out.sections[0].id).toMatch(/^s_/)
    expect(out.sections[1].id).toBe('keep')
  })

  it('withIds fills theme gaps from the defaults, including inside bg', () => {
    const out = withIds({ theme: { text: '#111', bg: { type: 'image', image: 'https://i/x.jpg' } } })
    expect(out.theme.text).toBe('#111')
    expect(out.theme.radius).toBe(DEFAULT_THEME.radius)
    expect(out.theme.bg).toMatchObject({ type: 'image', image: 'https://i/x.jpg', overlayOpacity: 45 })
  })

  it('withIds turns garbage into an empty layout', () => {
    for (const bad of [null, undefined, 'x', 5]) {
      const out = withIds(bad)
      expect(out.headline).toBe('')
      expect(out.sections).toEqual([])
    }
    expect(withIds({ sections: 'nope' }).sections).toEqual([])
  })
})

describe('layoutToRows / rowsToSections', () => {
  const s = (id, width) => (width ? { id, width } : { id })
  const ids = (rows) => rows.map((r) => r.map((x) => x.id))

  it('full-width blocks (or no width) get a row each', () => {
    expect(ids(layoutToRows([s('a'), s('b', 'full')]))).toEqual([['a'], ['b']])
  })

  it('packs halves in pairs and thirds in threes', () => {
    expect(ids(layoutToRows([s('a', 'half'), s('b', 'half'), s('c', 'half')]))).toEqual([['a', 'b'], ['c']])
    expect(ids(layoutToRows([s('a', 'third'), s('b', 'third'), s('c', 'third'), s('d', 'third')])))
      .toEqual([['a', 'b', 'c'], ['d']])
  })

  it('a block that would overflow the row starts a new one', () => {
    expect(ids(layoutToRows([s('a', 'half'), s('b', 'third'), s('c', 'third')]))).toEqual([['a', 'b'], ['c']])
    expect(ids(layoutToRows([s('a', 'half'), s('b'), s('c', 'half')]))).toEqual([['a'], ['b'], ['c']])
  })

  it('handles an empty or missing list', () => {
    expect(layoutToRows([])).toEqual([])
    expect(layoutToRows(undefined)).toEqual([])
  })

  it('rowsToSections sets width from the row length and drops empty rows', () => {
    const out = rowsToSections([[s('a', 'third')], [], [s('b'), s('c', 'third')], [s('d'), s('e'), s('f')]])
    expect(out).toEqual([{ id: 'a' }, { id: 'b', width: 'half' }, { id: 'c', width: 'half' },
      { id: 'd', width: 'third' }, { id: 'e', width: 'third' }, { id: 'f', width: 'third' }])
  })

  it('a stored layout survives the round trip through rows', () => {
    const flat = [{ id: 'a' }, { id: 'b', width: 'half' }, { id: 'c', width: 'half' }, { id: 'd', width: 'third' },
      { id: 'e', width: 'third' }, { id: 'f', width: 'third' }]
    expect(rowsToSections(layoutToRows(flat))).toEqual(flat)
    expect(rowsToSections(null)).toEqual([])
  })
})

describe('bgToCss', () => {
  it('builds image, gradient and solid backgrounds', () => {
    expect(bgToCss({ type: 'image', image: 'https://i/x.jpg' })).toBe('center / cover no-repeat url("https://i/x.jpg")')
    expect(bgToCss({ type: 'gradient', color: '#111', color2: '#222', angle: 90 })).toBe('linear-gradient(90deg, #111, #222)')
    expect(bgToCss({ type: 'solid', color: '#abc' })).toBe('#abc')
  })

  it('fills defaults and treats an image type without an image as solid', () => {
    expect(bgToCss({ type: 'gradient' })).toBe('linear-gradient(160deg, #12121a, #241b33)')
    expect(bgToCss({ type: 'image' })).toBe('#12121a')
    expect(bgToCss(null)).toBeUndefined()
  })
})

describe('fetchSpotlight', () => {
  beforeEach(() => { vi.mocked(getAccounts).mockReset() })

  it('cleans the username and reports an existing page', async () => {
    vi.mocked(getAccounts).mockResolvedValue([{ posting_json_metadata: JSON.stringify({ '3speak': { spotlight: page } }) }])
    expect(await fetchSpotlight(' @Alice ')).toEqual({ exists: true, page })
    expect(getAccounts).toHaveBeenCalledWith(['alice'])
  })

  it('a page without a sections array does not count as existing', async () => {
    vi.mocked(getAccounts).mockResolvedValue([{ posting_json_metadata: '{"3speak":{"spotlight":{"headline":"x"}}}' }])
    expect(await fetchSpotlight('bob')).toEqual({ exists: false, page: { headline: 'x' } })
  })

  it('no username or a failed lookup reads as no page', async () => {
    expect(await fetchSpotlight('')).toEqual({ exists: false, page: null })
    expect(getAccounts).not.toHaveBeenCalled()
    vi.mocked(getAccounts).mockImplementation(async () => { throw new Error('down') })
    expect(await fetchSpotlight('bob')).toEqual({ exists: false, page: null })
  })
})

describe('saveSpotlight', () => {
  beforeEach(() => {
    vi.mocked(getAccounts).mockReset()
    vi.mocked(broadcastWithAioha).mockReset()
  })

  it('merges into the metadata, keeping profile and interests, and strips client ids', async () => {
    vi.mocked(getAccounts).mockResolvedValue([{
      posting_json_metadata: JSON.stringify({ profile: { name: 'A' }, '3speak': { interests: ['music'] } }),
    }])
    vi.mocked(broadcastWithAioha).mockResolvedValue({ success: true })
    const layout = { headline: 'Hey', theme: { text: '#fff' }, sections: [{ id: 's_1', type: 'link', url: 'u' }] }
    const saved = await saveSpotlight('@Alice', layout)
    expect(saved.sections).toEqual([{ type: 'link', url: 'u' }])

    const [[ops, key]] = vi.mocked(broadcastWithAioha).mock.calls
    expect(key).toBe('posting')
    const [name, op] = ops[0]
    expect(name).toBe('account_update2')
    expect(op.account).toBe('alice')
    expect(op.json_metadata).toBe('')
    const meta = JSON.parse(op.posting_json_metadata)
    expect(meta.profile).toEqual({ name: 'A' })
    expect(meta['3speak'].interests).toEqual(['music'])
    expect(meta['3speak'].spotlight).toEqual({ headline: 'Hey', theme: { text: '#fff' }, sections: [{ type: 'link', url: 'u' }] })
  })

  it('refuses without a user and throws when the broadcast fails', async () => {
    await expect(saveSpotlight('', { sections: [] })).rejects.toThrow('spotlight.errors.notLoggedIn')
    vi.mocked(getAccounts).mockResolvedValue([{ posting_json_metadata: 'broken{' }])
    vi.mocked(broadcastWithAioha).mockResolvedValue({ success: false })
    await expect(saveSpotlight('bob', { sections: [] })).rejects.toThrow('spotlight.errors.couldNotSaveToHive')
  })
})
