// `:shortcode:` emoji typing (src/lib/emojiShortcodes.js), shared by the chat
// composer and the comment boxes.
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { emojiSuggestions, convertClosedShortcode, insertPickedEmoji, POPULAR_EMOJIS, loadEmojiData } from '../../../src/lib/emojiShortcodes.js'

// The emoji names load on demand (kept out of the first page download).
beforeAll(() => loadEmojiData())

describe('before the emoji names have loaded', () => {
  it('nothing is suggested or converted yet, and the load starts', async () => {
    // A fresh copy of the module: no emoji data yet.
    vi.resetModules()
    const fresh = await import('../../../src/lib/emojiShortcodes.js')
    expect(fresh.emojiDataReady()).toBe(false)
    expect(fresh.emojiSuggestions('nice :', 6)).toBe(null)
    expect(fresh.convertClosedShortcode(':fire:', 6)).toBe(null)
    await fresh.loadEmojiData()
    expect(fresh.emojiSuggestions('nice :', 6)).toBe(fresh.POPULAR_EMOJIS)
  })
})

describe('emojiSuggestions', () => {
  it('a bare ":" offers the popular ones', () => {
    expect(emojiSuggestions('nice :', 6)).toBe(POPULAR_EMOJIS)
    expect(POPULAR_EMOJIS.map((e) => e.emoji)).toContain('🔥')
  })

  it('":fi" filters, at most 8', () => {
    const items = emojiSuggestions(':fi', 3)
    expect(items.length).toBeLessThanOrEqual(8)
    expect(items.map((e) => e.name)).toContain('fire')
  })

  it('the exact name first, then names starting with it', () => {
    const names = emojiSuggestions(':fire', 5).map((e) => e.name)
    expect(names[0]).toBe('fire')
    expect(names.indexOf('fireworks')).toBeLessThan(names.indexOf('woman_firefighter'))
  })

  it('"+" and "-" are matched as text, not a broken pattern', () => {
    expect(emojiSuggestions(':+', 2).map((e) => e.emoji)).toContain('👍')
    expect(emojiSuggestions(':-1', 3).map((e) => e.emoji)).toContain('👎')
  })

  it('needs a space or the start before the ":" (no list inside 10:30 or a URL)', () => {
    expect(emojiSuggestions('at 10:30', 8)).toBeNull()
    expect(emojiSuggestions('https:', 6)).toBeNull()
  })

  it('looks only before the cursor', () => {
    expect(emojiSuggestions(':fi and more', 3)).not.toBeNull()
    expect(emojiSuggestions(':fi and more', 12)).toBeNull()
  })
})

describe('convertClosedShortcode', () => {
  it('":fire:" becomes 🔥 with the cursor after it', () => {
    expect(convertClosedShortcode('so hot :fire: yes', 13)).toEqual({ value: 'so hot 🔥 yes', cursor: 7 + '🔥'.length })
  })

  it('an unknown name stays as typed', () => {
    expect(convertClosedShortcode(':notanemojiatall:', 17)).toBeNull()
  })
})

describe('insertPickedEmoji', () => {
  it('replaces the open ":word" and adds a space', () => {
    expect(insertPickedEmoji('wow :fi', 7, '🔥')).toEqual({ value: 'wow 🔥 ', cursor: 4 + '🔥 '.length })
  })
})
