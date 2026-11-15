// Sounds (src/lib/sounds.js): ids shared with the checker, the sound chip's
// page, the credit "Use this sound" publishes with, and the checker reads.
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  isSoundId, shortSoundId, parseSoundId, soundIdOfSound, soundPathOf, libraryCreditSoundId, soundCredit,
  fetchSound, fetchTrendingSounds,
} from '../../../src/lib/sounds.js'
import { sanitizeMusicCredits, soundAuthorsOf } from '../../../src/utils/soundCredits.js'

afterEach(() => { vi.unstubAllGlobals() })

describe('sound ids', () => {
  it('a post\'s own audio is named by its Hive author and permlink', () => {
    expect(shortSoundId('@Badadib', 'Audiogram-1')).toBe('short_badadib_audiogram-1')
    expect(parseSoundId('short_badadib_audiogram-1')).toEqual({ kind: 'short', author: 'badadib', permlink: 'audiogram-1' })
    expect(parseSoundId('lib-carefree')).toEqual({ kind: 'library', slug: 'carefree' })
    expect(parseSoundId('ext-0123456789')).toEqual({ kind: 'external' })
    expect(shortSoundId('ba', 'x')).toBeNull()
    expect(isSoundId('short_ba_x')).toBe(false)
    expect(isSoundId('nope')).toBe(false)
  })

  it('a post names its sound by id, else by the sound page address', () => {
    expect(soundIdOfSound({ title: 'Beat', id: 'short_badadib_beat-1' })).toBe('short_badadib_beat-1')
    expect(soundIdOfSound({ title: 'Beat', url: 'https://3speak.tv/sound/lib-carefree' })).toBe('lib-carefree')
    expect(soundIdOfSound({ title: 'Beat', url: 'https://3speak.tv/sound/%E0%A4' })).toBeNull()
    expect(soundIdOfSound({ title: 'Beat' })).toBeNull()
    expect(soundIdOfSound(null)).toBeNull()
  })

  it('the sound chip: the song\'s page, the Short\'s own sound, or none', () => {
    expect(soundPathOf({ sound: { title: 'C', id: 'lib-carefree' }, author: 'fan', hivePermlink: 'p' })).toBe('/sound/lib-carefree')
    expect(soundPathOf({ sound: null, author: 'badadib', hivePermlink: 'orig-1' })).toBe('/sound/short_badadib_orig-1')
    // A song named only by its title (older posts): the checker knows it, the chip has no address
    expect(soundPathOf({ sound: { title: 'Old song' }, author: 'fan', hivePermlink: 'p' })).toBeNull()
    // Not on Hive (no permlink): no page
    expect(soundPathOf({ sound: null, author: 'fan', hivePermlink: null })).toBeNull()
  })

  it('a library credit goes under lib-<its library id>', () => {
    expect(libraryCreditSoundId({ id: 'carefree', source: 'incompetech.com' })).toBe('lib-carefree')
    expect(libraryCreditSoundId({ id: 'short_badadib_beat-1', source: '3speak' })).toBe('short_badadib_beat-1')
    expect(libraryCreditSoundId({ id: 'snd-2', source: '3speak' })).toBeNull()
    expect(libraryCreditSoundId({ id: 'Not A Slug!' })).toBeNull()
  })
})

describe('the credit "Use this sound" publishes with', () => {
  it('a Short\'s audio is a 3Speak sound of its creator: they get the 5% split', () => {
    const credit = soundCredit({ id: 'short_badadib_beat-1', title: 'My beat' })
    expect(credit).toEqual({
      id: 'short_badadib_beat-1', title: 'My beat', artist: '@badadib', source: '3speak', account: 'badadib',
      sourceUrl: 'https://3speak.tv/sound/short_badadib_beat-1',
    })
    const clean = sanitizeMusicCredits([credit])
    expect(clean).toHaveLength(1)
    expect(soundAuthorsOf(clean, 'fan')).toEqual(['badadib'])
  })

  it('a library song keeps its own credit', () => {
    expect(soundCredit({ id: 'lib-carefree', title: 'Carefree', artist: 'Kevin MacLeod', source: 'incompetech.com', url: 'https://incompetech.example/c', license: 'CC BY 4.0' })).toEqual({
      id: 'lib-carefree', title: 'Carefree', artist: 'Kevin MacLeod', source: 'incompetech.com', sourceUrl: 'https://incompetech.example/c', license: 'CC BY 4.0',
    })
    expect(soundCredit({ id: 'lib-x' })).toBeNull()
    expect(soundCredit({ id: 'bad' })).toBeNull()
    expect(soundCredit({ id: 'short_badadib_beat-1' }).title).toBe('@badadib')
  })
})

describe('reading the checker', () => {
  it('a sound, a missing one, and the trending list', async () => {
    const fetchMock = vi.fn(async (url) => {
      if (url.includes('/sounds/trending')) return new Response(JSON.stringify({ sounds: [{ id: 'lib-carefree', uses: 3 }] }))
      if (url.includes('lib-carefree')) return new Response(JSON.stringify({ sound: { id: 'lib-carefree' }, shorts: [] }))
      if (url.includes('lib-gone')) return new Response('{}', { status: 404 })
      return new Response('{}', { status: 500 })
    })
    vi.stubGlobal('fetch', fetchMock)
    expect((await fetchSound('lib-carefree', { sort: 'top' })).sound.id).toBe('lib-carefree')
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/sounds\/lib-carefree\?sort=top&page=1&limit=24$/)
    expect(await fetchSound('lib-gone')).toBeNull()
    expect(await fetchSound('not valid')).toBeNull()
    await expect(fetchSound('lib-broken')).rejects.toThrow()
    expect(await fetchTrendingSounds()).toEqual([{ id: 'lib-carefree', uses: 3 }])
  })
})
