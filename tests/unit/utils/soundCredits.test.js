// Music credits from the shorts editor (src/utils/soundCredits.js): what goes
// into the post body, json_metadata.video.sound and the sound-creator split.
import { describe, it, expect } from 'vitest'
import {
  sanitizeMusicCredits, soundAuthorsOf, soundCreditsMarkdown, primarySoundMetadata, soundLabel, MAX_SOUND_AUTHORS,
} from '../../../src/utils/soundCredits.js'
import { splitSystemTail } from '../../../src/utils/videoTimeline.js'

const CC = {
  id: 'song-1', title: 'Sunny Day', artist: 'Kevin', source: 'Free Music Archive',
  sourceUrl: 'https://fma.example/sunny', license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
}
const OWN = { id: 'snd-2', title: 'My Beat', source: '3speak', account: '@Alice', sourceUrl: 'https://3speak.tv/watch?v=alice/beat' }

describe('sanitizeMusicCredits', () => {
  it('keeps a library song and a 3Speak sound with a valid account', () => {
    expect(sanitizeMusicCredits([CC, OWN])).toEqual([
      { ...CC, account: null },
      { id: 'snd-2', title: 'My Beat', artist: '@alice', source: '3speak', sourceUrl: 'https://3speak.tv/watch?v=alice/beat', license: null, licenseUrl: null, account: 'alice' },
    ])
  })

  it('strips markdown and html so a title cannot inject into the post body', () => {
    const [c] = sanitizeMusicCredits([{ title: '[click](https://evil)\n<script>*x*</script>', artist: '`a`|b#' }])
    expect(c.title).toBe('clickhttps://evil scriptx/script')
    expect(c.title).not.toMatch(/[[\]()*<>`#|]/)
    expect(c.artist).toBe('ab')
  })

  it('drops non-http links', () => {
    const [c] = sanitizeMusicCredits([{ title: 'x', sourceUrl: 'javascript:alert(1)', licenseUrl: 'not a url' }])
    expect(c.sourceUrl).toBeNull()
    expect(c.licenseUrl).toBeNull()
  })

  it('drops untitled entries, repeats and a 3Speak sound without a real account', () => {
    expect(sanitizeMusicCredits([
      { title: '' }, null, 'x',
      CC, { ...CC, title: 'Same id' },
      { title: 'Bad', source: '3speak', account: 'ab' },
      { title: 'Bad2', source: '3speak', account: 'UPPER_case!' },
      { title: 'Bad3', source: '3speak' },
    ]).map((c) => c.title)).toEqual(['Sunny Day'])
  })

  it('uses the title as id when there is none', () => {
    expect(sanitizeMusicCredits([{ title: 'A' }, { title: 'A' }, { title: 'B' }]).map((c) => c.id)).toEqual(['A', 'B'])
  })

  it('keeps at most four songs', () => {
    expect(sanitizeMusicCredits(Array.from({ length: 10 }, (_, i) => ({ title: `S${i}` })))).toHaveLength(4)
  })

  it('caps long text', () => {
    const [c] = sanitizeMusicCredits([{ title: 'x'.repeat(500), license: 'L'.repeat(100) }])
    expect(c.title).toHaveLength(100)
    expect(c.license).toHaveLength(40)
  })

  it('returns [] for anything that is not a list', () => {
    expect(sanitizeMusicCredits(null)).toEqual([])
    expect(sanitizeMusicCredits({ title: 'x' })).toEqual([])
  })
})

describe('soundAuthorsOf', () => {
  it('lists 3Speak sound creators once each, never the poster, at most two', () => {
    const credits = [{ account: 'bob' }, { account: 'me' }, { account: 'bob' }, { account: null }, { account: 'carol' }, { account: 'dave' }]
    expect(soundAuthorsOf(credits, 'me')).toEqual(['bob', 'carol'])
    expect(MAX_SOUND_AUTHORS).toBe(2)
    expect(soundAuthorsOf(null, 'me')).toEqual([])
  })
})

describe('soundCreditsMarkdown', () => {
  it('credits a CC song with its source and the full license name', () => {
    const md = soundCreditsMarkdown(sanitizeMusicCredits([CC]))
    expect(md).toBe('\n\n---\n*Music: "Sunny Day" Kevin ([Free Music Archive](https://fma.example/sunny)). Licensed under [Creative Commons: By Attribution 4.0 License](https://creativecommons.org/licenses/by/4.0/)*')
  })

  it('credits a 3Speak sound with a link to its creator', () => {
    expect(soundCreditsMarkdown(sanitizeMusicCredits([OWN])))
      .toBe('\n\n---\n*Sound: ["My Beat"](https://3speak.tv/watch?v=alice/beat) by [@alice](https://3speak.tv/user/alice)*')
    expect(soundCreditsMarkdown(sanitizeMusicCredits([{ ...OWN, sourceUrl: undefined }])))
      .toBe('\n\n---\n*Sound: "My Beat" by [@alice](https://3speak.tv/user/alice)*')
  })

  it('writes a plain source and license without links', () => {
    expect(soundCreditsMarkdown([{ title: 'T', artist: 'A', source: 'Lib', license: 'Custom' }]))
      .toBe('\n\n---\n*Music: "T" A (Lib). Licensed under Custom*')
  })

  it('is empty without songs', () => {
    expect(soundCreditsMarkdown([])).toBe('')
    expect(soundCreditsMarkdown(null)).toBe('')
  })

  it('is recognised as a 3Speak section so chapters land above it', () => {
    const body = `My text${soundCreditsMarkdown(sanitizeMusicCredits([CC, OWN]))}`
    expect(splitSystemTail(body).main).toBe('My text\n')
  })
})

describe('primarySoundMetadata and soundLabel', () => {
  it('stores the first song for the soundtrack ticker', () => {
    const [cc, own] = sanitizeMusicCredits([CC, OWN])
    expect(primarySoundMetadata([cc, own])).toEqual({
      title: 'Sunny Day', artist: 'Kevin', source: 'Free Music Archive', url: 'https://fma.example/sunny', license: 'CC BY 4.0',
    })
    expect(primarySoundMetadata([own])).toEqual({
      title: 'My Beat', artist: '@alice', account: 'alice', source: '3speak', url: 'https://3speak.tv/watch?v=alice/beat',
    })
    expect(primarySoundMetadata([])).toBeNull()
    expect(primarySoundMetadata(null)).toBeNull()
  })

  it('labels a short with its song, or the creator original audio', () => {
    expect(soundLabel({ title: 'Sunny Day', artist: 'Kevin' }, 'alice')).toBe('Sunny Day - Kevin')
    expect(soundLabel({ title: 'Solo' }, 'alice')).toBe('Solo')
    expect(soundLabel(null, 'alice')).toBe('alice - Original Audio')
    expect(soundLabel({ title: '' }, 'alice')).toBe('alice - Original Audio')
    expect(soundLabel({ title: 42 }, 'alice')).toBe('alice - Original Audio')
  })

  it('cleans a label read from untrusted metadata', () => {
    expect(soundLabel({ title: '<b>Hi</b>', artist: '[x](y)' }, 'a')).toBe('bHi/b - xy')
  })
})
