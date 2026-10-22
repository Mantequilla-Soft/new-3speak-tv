// The embed snippet from the watch page's share menu (src/utils/embedCode.js).
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../src/utils/config', () => ({ EMBED_PLAYER_BASE: 'https://play.3speak.tv' }))

const { buildEmbedSrc, buildEmbedHtml, EMBED_SIZES } = await import('../../../src/utils/embedCode.js')

const srcOf = (html) => /src="([^"]+)"/.exec(html)[1]
const titleOf = (html) => /title="([^"]*)"/.exec(html)[1]

describe('buildEmbedSrc', () => {
  it('points at the public player /watch page in iframe mode', () => {
    expect(buildEmbedSrc('alice', 'my-vid')).toBe('https://play.3speak.tv/watch?v=alice/my-vid&mode=iframe')
  })

  it('encodes author and permlink so they cannot add query parameters', () => {
    expect(buildEmbedSrc('a&b', 'x?y=1#z')).toBe('https://play.3speak.tv/watch?v=a%26b/x%3Fy%3D1%23z&mode=iframe')
  })
})

describe('buildEmbedHtml', () => {
  it('is responsive by default: a 16:9 padding box around a full-size iframe', () => {
    const html = buildEmbedHtml('alice', 'my-vid', { title: 'My video' })
    expect(html.startsWith('<div style="position:relative;padding-bottom:56.25%;')).toBe(true)
    expect(html.endsWith('</div>')).toBe(true)
    expect(srcOf(html)).toBe('https://play.3speak.tv/watch?v=alice/my-vid&mode=iframe')
    expect(html).toContain('width:100%;height:100%')
    expect(html).toContain('allowfullscreen')
    expect(html).toContain('allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"')
    expect(titleOf(html)).toBe('My video')
  })

  it('gives fixed sizes their width and height', () => {
    for (const s of EMBED_SIZES.filter((x) => x.width)) {
      const html = buildEmbedHtml('alice', 'my-vid', { size: s.id })
      expect(html.startsWith('<iframe ')).toBe(true)
      expect(html).toContain(`width="${s.width}" height="${s.height}"`)
    }
  })

  it('falls back to responsive for an unknown size', () => {
    expect(buildEmbedHtml('a', 'b', { size: 'huge' })).toBe(buildEmbedHtml('a', 'b'))
  })

  it('escapes quotes, ampersands and angle brackets in the title', () => {
    const html = buildEmbedHtml('a', 'b', { title: 'Tom & "Jerry" <live>' })
    expect(titleOf(html)).toBe('Tom &amp; &quot;Jerry&quot; &lt;live&gt;')
    expect(html.match(/<iframe/g)).toHaveLength(1)
  })

  it('uses a generic title when the video has none', () => {
    expect(titleOf(buildEmbedHtml('a', 'b'))).toBe('3Speak video')
    expect(titleOf(buildEmbedHtml('a', 'b', { title: '   ' }))).toBe('3Speak video')
    expect(titleOf(buildEmbedHtml('a', 'b', { title: null }))).toBe('3Speak video')
  })

  it('keeps unicode titles', () => {
    expect(titleOf(buildEmbedHtml('a', 'b', { title: 'Café ☕ 日本' }))).toBe('Café ☕ 日本')
  })

  it('offers responsive first in the share menu', () => {
    expect(EMBED_SIZES[0].id).toBe('responsive')
  })
})
