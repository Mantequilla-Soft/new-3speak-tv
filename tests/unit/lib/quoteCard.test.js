// Quote cards (src/lib/quoteCard.js): the line, its fit on the card, and the
// snap that links to the moment and names the video as its source.
import { describe, it, expect, vi } from 'vitest'
import { cleanQuote, wrapLines, fitQuote, fitLine, quoteBody, quoteMetadata, momentUrl, stamp, drawQuoteCard, MAX_QUOTE } from '../../../src/lib/quoteCard.js'

// 10 px per character at size 20, scaling with the size
const measureAt = (s, size) => s.length * size / 2

describe('the line', () => {
  it('one paragraph, outer quotes off, at most MAX_QUOTE characters', () => {
    expect(cleanQuote('  "Hello\n  world"  ')).toBe('Hello world')
    expect(cleanQuote('x'.repeat(400))).toHaveLength(MAX_QUOTE)
    expect(stamp(754)).toBe('12:34')
    expect(stamp(3909)).toBe('1:05:09')
  })

  it('wraps on words; a word too long for a line is cut', () => {
    expect(wrapLines('aa bb cc', 50, (s) => s.length * 10)).toEqual(['aa bb', 'cc'])
    expect(wrapLines('abcdefghij', 40, (s) => s.length * 10)).toEqual(['abcd', 'efgh', 'ij'])
  })

  it('the biggest size that fits, else the smallest with the rest cut', () => {
    expect(fitQuote('short line', { width: 400, height: 200, max: 40, min: 20 }, measureAt)).toEqual({ size: 40, lines: ['short line'] })
    const long = fitQuote('word '.repeat(80).trim(), { width: 100, height: 75, max: 40, min: 20 }, measureAt)
    expect(long.size).toBe(20)
    expect(long.lines).toHaveLength(3)
    expect(long.lines[2].endsWith('…')).toBe(true)
  })

  it('fitLine: unchanged when it fits, else cut with an ellipsis that still fits', () => {
    const m = (s) => s.length * 10
    expect(fitLine('short', 100, m)).toBe('short')
    const cut = fitLine('a much longer title', 100, m)
    expect(cut.endsWith('…')).toBe(true)
    expect(m(cut)).toBeLessThanOrEqual(100)
  })
})

describe('the snap', () => {
  it('links to the moment; text has the poster\'s words, the card, the line, who said it', () => {
    expect(momentUrl('bob', 'talk', 754.6)).toBe('https://3speak.tv/watch?v=bob/talk&t=754')
    expect(momentUrl('bob', 'talk', 0)).toBe('https://3speak.tv/watch?v=bob/talk')
    const body = quoteBody({ quote: 'Ship it.', author: 'bob', permlink: 'talk', title: 'My [best] talk', start: 754, imageUrl: 'https://img/q.png', comment: 'So true' })
    expect(body).toBe('So true\n\n![Ship it.](https://img/q.png)\n\n> Ship it.\n\n— @bob, [My best talk](https://3speak.tv/watch?v=bob/talk&t=754)')
  })

  it('metadata: the card as image, the moment as link, the video as source', () => {
    expect(quoteMetadata({ author: 'bob', permlink: 'talk', start: 754, end: 760, imageUrl: 'https://img/q.png' })).toEqual({
      format: 'markdown',
      tags: ['3speak', 'quote'],
      image: ['https://img/q.png'],
      links: ['https://3speak.tv/watch?v=bob/talk&t=754'],
      '3speak': { source: { kind: 'quote', author: 'bob', permlink: 'talk', start: 754, end: 760 } },
    })
  })

  it('drawing: background, accent, the line and the names land on the canvas', () => {
    const calls = []
    const ctx = new Proxy({ measureText: (s) => ({ width: String(s).length * 20 }) }, {
      get: (t, k) => (k in t ? t[k] : (...a) => calls.push([k, ...a])),
      set: (t, k, v) => { t[k] = v; return true },
    })
    drawQuoteCard(ctx, { quote: 'Ship it.', author: 'bob', title: 'Talk', start: 754, mark: null })
    const texts = calls.filter((c) => c[0] === 'fillText').map((c) => c[1])
    expect(texts).toEqual(expect.arrayContaining(['“', 'Ship it.', '@bob', 'Talk · 12:34', '3speak.tv']))
    expect(calls.some((c) => c[0] === 'fillRect')).toBe(true)
  })
})
