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
    for (const name of ['', '   ', undefined, 'alice', 'Alice', '@alice']) {
      expect((await cards.profileText('alice', name)).headline).toBe('@alice')
    }
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
  })
})
