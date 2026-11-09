// utils/audiogramLink.js: a Short made from an audiogram and its episode. The
// episode comes from the Short's metadata; the "🎧 Full episode" line in its
// text is dropped on the Shorts page (a card shows it instead).
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../src/utils/uploadThumbnail', () => ({ uploadThumbnail: vi.fn() }))
vi.mock('../../../src/utils/uploadVideoAsset', () => ({ uploadVideoAsset: vi.fn() }))
vi.mock('../../../src/utils/snapsContainer', () => ({ resolveSnapsContainer: vi.fn() }))

const { audiogramOfMeta, stripEpisodeLine, episodePath } = await import('../../../src/utils/audiogramLink.js')
const { audiogramShortBody } = await import('../../../src/utils/audiogramShorts.js')

describe('audiogramOfMeta', () => {
  it('reads the episode from the metadata, as an object or a string', () => {
    const jm = { '3speak': { audiogram: { author: 'Alice', permlink: 'my-episode' } } }
    expect(audiogramOfMeta(jm)).toEqual({ author: 'alice', permlink: 'my-episode' })
    expect(audiogramOfMeta(JSON.stringify(jm))).toEqual({ author: 'alice', permlink: 'my-episode' })
    expect(episodePath(audiogramOfMeta(jm))).toBe('/audio/alice/my-episode')
  })

  it('nothing for other shorts or anything odd', () => {
    for (const bad of [null, '', '{bad', {}, { '3speak': {} }, { '3speak': { audiogram: { author: 'a', permlink: 'p' } } },
      { '3speak': { audiogram: { author: 'alice', permlink: '../x' } } }, { '3speak': { audiogram: 'alice/x' } }]) {
      expect(audiogramOfMeta(bad)).toBe(null)
    }
  })
})

describe('stripEpisodeLine', () => {
  it('drops the line from the Short\'s text, keeps the words', () => {
    const body = audiogramShortBody({ embedUrl: 'https://play.3speak.tv/embed?v=alice/abc', description: 'Listen to this', episode: { author: 'alice', permlink: 'ep', title: 'My Episode' }, author: 'alice', permlink: 'p' })
    const out = stripEpisodeLine(body)
    expect(out).toContain('Listen to this')
    expect(out).not.toContain('Full episode')
    expect(out).not.toContain('/audio/alice/ep')
    // a caption as the Shorts page has it (plain text, links kept)
    expect(stripEpisodeLine('Listen to this\n🎧 Full episode: [My Episode](https://3speak.tv/audio/alice/ep)')).toBe('Listen to this')
    // translated label: the 🎧 and the audio link are what count
    expect(stripEpisodeLine('Hör rein\n🎧 Ganze Folge: [Folge](https://3speak.tv/audio/alice/ep)')).toBe('Hör rein')
  })

  it('leaves other text alone', () => {
    expect(stripEpisodeLine('Just a 🎧 short [link](https://example.com)')).toBe('Just a 🎧 short [link](https://example.com)')
    expect(stripEpisodeLine('')).toBe('')
    expect(stripEpisodeLine(null)).toBe(null)
  })
})
