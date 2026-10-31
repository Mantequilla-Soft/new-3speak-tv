// Share images of communities and profiles (server/og-cards.cjs): which name a
// card shows, how a long name is fitted, the file it is kept in. Twemoji and
// Google Fonts are not called: fetch is stubbed where a name needs them.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { createRequire } from 'module'
import fs from 'fs'
import os from 'os'
import path from 'path'

const require = createRequire(import.meta.url)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-cards-'))
process.env.OG_CARD_DIR = dir
const cards = require('../../server/og-cards.cjs')
const jpeg = require('../../server/node_modules/jpeg-js')

const ON_3SPEAK = [' on 3Speak']

afterEach(() => vi.unstubAllGlobals())
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('the name on a profile card', () => {
  it('is the display name, with "@handle on 3Speak" under it', async () => {
    expect(await cards.profileText('alice', 'Alice Cook')).toMatchObject({
      headline: 'Alice Cook', subtitle: [['@alice', true], ON_3SPEAK],
    })
  })

  it('is the @handle when there is no display name, or it is the handle itself', async () => {
    for (const name of ['', '   ', undefined, 'alice', '@alice']) {
      expect((await cards.profileText('alice', name)).headline).toBe('@alice')
    }
  })

  it('is the display name when it only capitalises the handle', async () => {
    expect(await cards.profileText('meno', 'MenO')).toMatchObject({
      headline: 'MenO', subtitle: [['@meno', true], ON_3SPEAK],
    })
  })

  it('is the @handle when the name has characters the card cannot draw', async () => {
    // Arabic (needs shaping), stacked combining marks, strikethrough letters,
    // nothing but emoji.
    for (const name of ['محمد علي', 'Z̷̢̛a̸l̴g̵o̶', 't̷i̷b̷f̷o̷x̷', '🔥🔥🔥']) {
      expect((await cards.profileText('alice', name)).headline).toBe('@alice')
    }
  })

  it('keeps accented, Greek and Cyrillic names', async () => {
    for (const name of ['Nguyễn Thị Minh Khai', 'Ελένη', 'Дмитрий', 'Zoë Ñúñez']) {
      expect((await cards.profileText('alice', name)).headline).toBe(name)
    }
  })

  it('keeps emoji Twemoji has, and gives up on ones it has not', async () => {
    vi.stubGlobal('fetch', async () => new Response('<svg xmlns="http://www.w3.org/2000/svg"/>', { status: 200 }))
    expect((await cards.profileText('alice', 'Alice 🌸')).headline).toBe('Alice 🌸')
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }))
    expect((await cards.profileText('alice', 'Alice 🫠🫠')).headline).toBe('@alice')
  })
})

describe('the name on a community card', () => {
  it('is the community title', async () => {
    expect(await cards.communityText('hive-1', 'RU° [closed]')).toMatchObject({
      headline: 'RU° [closed]', subtitle: [['Community', true], ON_3SPEAK],
    })
  })

  it('is the id when the title is in a script the card cannot draw', async () => {
    expect((await cards.communityText('hive-150894', 'انجمن آریازتک')).headline).toBe('hive-150894')
  })
})

describe('what the other cards say', () => {
  it('a badge: its title, else its account', async () => {
    expect(await cards.badgeText('badge-146701', 'OG PhotoGamers')).toMatchObject({
      headline: 'OG PhotoGamers', subtitle: [['Badge', true], ON_3SPEAK],
    })
    expect((await cards.badgeText('badge-146701', '')).headline).toBe('badge-146701')
  })

  it('a tag: the #tag, with a # in the empty frame', () => {
    expect(cards.tagText('cooking')).toMatchObject({ headline: '#cooking', subtitle: [['Topic', true], ON_3SPEAK], initial: '#' })
  })

  it('an invite: who invited you', () => {
    expect(cards.inviteText('alice')).toMatchObject({ headline: 'Join me on 3Speak', subtitle: [['@alice', true], [' invited you']] })
  })

  it('a stream: its title, LIVE and the host; a conference room says whose room it is', async () => {
    const room = { host: 'meno', mode: 'standalone', title: 'Room title', post: { title: 'Building share cards' } }
    expect(await cards.streamText(room)).toMatchObject({
      headline: 'Building share cards', subtitle: [['LIVE', 'live'], ['@meno', true], ON_3SPEAK],
    })
    expect(await cards.streamText({ ...room, mode: 'conference', post: {} })).toMatchObject({
      headline: 'Room title', subtitle: [['@meno', true], ['’s room on 3Speak']],
    })
    expect((await cards.streamText({ ...room, post: { title: 'محمد علي' } })).headline).toBe('@meno is live')
  })

  it('a playlist says whether it is an album, a podcast or a playlist, and whose', async () => {
    expect(await cards.playlistText({ name: 'Summer Songs', owner: 'alice', album: { year: 2026 } })).toMatchObject({
      headline: 'Summer Songs', subtitle: [['Album', true], [' by '], ['@alice', true]],
    })
    expect((await cards.playlistText({ name: 'Talks', owner: 'alice', medium: 'podcast' })).subtitle[0]).toEqual(['Podcast', true])
    expect((await cards.playlistText({ name: 'Mix', owner: 'alice' })).subtitle[0]).toEqual(['Playlist', true])
  })

  it('an audio post: its title, a song or audio, and whose', async () => {
    expect(await cards.audioText('alice', 'Sunday Tune', true)).toMatchObject({
      headline: 'Sunday Tune', subtitle: [['Song', true], [' by '], ['@alice', true]],
    })
    expect((await cards.audioText('alice', '', false)).headline).toBe('@alice')
  })
})

describe('fitting the name', () => {
  it('draws a short name big, on one line', () => {
    expect(cards.fitHeadline('Threespeak')).toEqual({ size: 104, lines: ['Threespeak'] })
  })

  it('shrinks a long name onto at most three lines', () => {
    const { size, lines } = cards.fitHeadline('Maximilian Alexander von Hohenzollern-Sigmaringen the Third')
    expect(lines.length).toBeLessThanOrEqual(3)
    expect(size).toBeLessThan(80)
    expect(lines.join(' ')).toBe('Maximilian Alexander von Hohenzollern-Sigmaringen the Third')
  })

  it('shrinks a word before it breaks it', () => {
    expect(cards.fitHeadline('hive-150894').lines).toEqual(['hive-150894'])
  })

  it('breaks a word that fits at no size, and cuts what is left with an ellipsis', () => {
    const { lines } = cards.fitHeadline('x'.repeat(200))
    expect(lines).toHaveLength(3)
    expect(lines[2].endsWith('…')).toBe(true)
  })
})

describe('the card file', () => {
  let card
  beforeAll(async () => {
    card = Buffer.from(await cards.renderCard({ headline: 'Alice Cook', subtitle: [['@alice', true], ON_3SPEAK], avatar: null }))
  }, 30000)

  it('is a 1200x630 JPEG', () => {
    const img = jpeg.decode(card, { useTArray: true })
    expect([img.width, img.height]).toEqual([1200, 630])
  })

  it('is versioned in its URL once it exists, and not rewritten when nothing changed', async () => {
    expect(cards.cardUrl('https://3speak.tv', 'user', 'alice')).toBe('https://3speak.tv/api/og-card/user/alice.jpg')
    expect(await cards.saveCard('user', 'alice', card)).toBe(true)
    const url = cards.cardUrl('https://3speak.tv', 'user', 'alice')
    expect(url).toMatch(/^https:\/\/3speak\.tv\/api\/og-card\/user\/alice\.jpg\?v=[0-9a-z]+$/)
    expect(await cards.saveCard('user', 'alice', card)).toBe(false)
    expect(cards.cardUrl('https://3speak.tv', 'user', 'alice')).toBe(url)
  })

  it('has no URL version for an id no account or community can have', () => {
    expect(cards.cardVersion('user', '../etc/passwd')).toBe('')
    expect(cards.cardVersion('community', 'hive-x')).toBe('')
    expect(cards.cardVersion('audio', 'alice/../../etc')).toBe('')
    expect(cards.cardVersion('tag', 'Not A Tag')).toBe('')
    expect(cards.cardVersion('stream', '../x')).toBe('')
  })

  it('names an invite card by its code and keeps it under the inviter', async () => {
    expect(await cards.saveCard('invite', 'alice', card)).toBe(true)
    expect(cards.cardUrl('https://3speak.tv', 'invite', 'alice', 'abcde12345'))
      .toMatch(/^https:\/\/3speak\.tv\/api\/og-card\/invite\/abcde12345\.jpg\?v=[0-9a-z]+$/)
  })

  it('keeps an audio card under its author', async () => {
    expect(await cards.saveCard('audio', 'alice/sunday-tune', card)).toBe(true)
    expect(fs.existsSync(path.join(dir, 'audio', 'alice', 'sunday-tune.jpg'))).toBe(true)
    expect(cards.cardUrl('https://3speak.tv', 'audio', 'alice/sunday-tune'))
      .toMatch(/^https:\/\/3speak\.tv\/api\/og-card\/audio\/alice\/sunday-tune\.jpg\?v=/)
  })
})

describe('the other card shapes', () => {
  it('draws a cover in a square frame and a LIVE marker, still 1200x630', async () => {
    const png1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    for (const opts of [
      { headline: 'Summer Songs', subtitle: [['Album', true], [' by '], ['@alice', true]], avatar: png1x1, shape: 'square' },
      { headline: 'On air', subtitle: [['LIVE', 'live'], ['@meno', true], ON_3SPEAK], avatar: null },
      { ...cards.tagText('cooking'), avatar: null },
    ]) {
      const img = jpeg.decode(Buffer.from(await cards.renderCard(opts)), { useTArray: true })
      expect([img.width, img.height]).toEqual([1200, 630])
    }
  }, 30000)
})

describe('outside podcast cards', () => {
  it('a show: its name, and who makes it', async () => {
    expect(await cards.podcastText({ title: 'Podnews Daily', author: 'Podnews LLC' })).toMatchObject({
      headline: 'Podnews Daily', subtitle: [['Podcast', true], [' by '], ['Podnews LLC', true]],
    })
    expect((await cards.podcastText({ title: 'No Author' })).subtitle).toEqual([['Podcast', true], ON_3SPEAK])
  })

  it('an episode: its title, its number and the show, a long show name in its short form', async () => {
    expect(await cards.episodeText({ title: 'Pilot', season: 2, episode: 14 }, { title: 'Short Show' })).toMatchObject({
      headline: 'Pilot', subtitle: [['S2 E14', true], [' of '], ['Short Show', true]],
    })
    expect((await cards.episodeText({ title: 'Who is buying?' }, { title: 'Podnews Daily - podcast industry and podcasting news' })).subtitle)
      .toEqual([['Episode', true], [' of '], ['Podnews Daily', true]])
  })

  it('cuts the last name of a subtitle that would run into the cover', () => {
    const [, , [name]] = cards.fitSubtitle([['Podcast', true], [' by '], ['A'.repeat(80), true]])
    expect(name.endsWith('…')).toBe(true)
    expect(name.length).toBeLessThan(80)
  })

  it('names an episode card by feed and hash, and drops show and episode cards after 30 days', async () => {
    const card = Buffer.from(await cards.renderCard({ headline: 'Show', subtitle: [['Podcast', true]], avatar: null }))
    const feed = 'a'.repeat(24)
    expect(await cards.saveCard('podcast', feed, card)).toBe(true)
    expect(await cards.saveCard('episode', `${feed}_AbCdEfGh-_123456`, card)).toBe(true)
    expect(cards.cardUrl('https://3speak.tv', 'episode', `${feed}_AbCdEfGh-_123456`))
      .toMatch(/^https:\/\/3speak\.tv\/api\/og-card\/episode\/a{24}_AbCdEfGh-_123456\.jpg\?v=/)
    expect(cards.cardVersion('episode', `${feed}:AbCdEfGh-_123456`)).toBe('')
    expect(await cards.pruneExpired()).toBe(0)
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000)
    fs.utimesSync(path.join(dir, 'episode', `${feed}_AbCdEfGh-_123456.jpg`), old, old)
    expect(await cards.pruneExpired()).toBe(1)
    expect(fs.existsSync(path.join(dir, 'episode', `${feed}_AbCdEfGh-_123456.jpg`))).toBe(false)
    expect(fs.existsSync(path.join(dir, 'podcast', `${feed}.jpg`))).toBe(true)
  }, 30000)
})
