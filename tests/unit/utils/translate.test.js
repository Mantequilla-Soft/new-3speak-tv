// @vitest-environment jsdom
// Content translation (src/utils/translate.js): the target language a viewer
// picked (or their interface language), the title languages the translator
// offers, and the markdown clean-up before text is sent to be translated.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ post: vi.fn(), lang: vi.fn() }))
vi.mock('axios', () => ({ default: { post: h.post } }))
vi.mock('../../../src/utils/config', () => ({ TRANSLATE_API_URL: 'https://translate.example' }))
vi.mock('../../../src/i18n', () => ({ getLanguage: h.lang }))

import {
  SUPPORTED_LANGUAGES, TITLE_LANGUAGES, getTargetLanguage, setTargetLanguage, translateText,
} from '../../../src/utils/translate.js'

beforeEach(() => {
  localStorage.clear()
  h.lang.mockReset().mockReturnValue('de')
  h.post.mockReset().mockResolvedValue({ data: { translatedText: 'Hallo' } })
})

describe('target language', () => {
  it('follows the interface language until the viewer picks one', () => {
    expect(getTargetLanguage()).toBe('de')
    setTargetLanguage('ja')
    expect(getTargetLanguage()).toBe('ja')
    expect(localStorage.getItem('3speak-translate-lang')).toBe('ja')
  })
})

describe('language lists', () => {
  it('has unique codes and offers only translator languages for titles', () => {
    const codes = SUPPORTED_LANGUAGES.map((l) => l.code)
    expect(new Set(codes).size).toBe(codes.length)
    expect(TITLE_LANGUAGES.map((l) => l.code)).toEqual(['en', 'zh', 'hi', 'es', 'fr', 'ar', 'bn', 'pt', 'ru', 'ja', 'de'])
  })
})

describe('translateText', () => {
  const sent = () => h.post.mock.calls.at(-1)[1].q

  it('posts plain text to the translator and returns the translation', async () => {
    expect(await translateText('Hello', 'de')).toBe('Hallo')
    expect(h.post).toHaveBeenCalledWith('https://translate.example/translate', { q: 'Hello', source: 'auto', target: 'de', format: 'text' })
  })

  it.each([
    ['links keep their text', 'See [the docs](https://x.example)', 'See the docs'],
    ['images go', 'Look ![cat](https://img/cat.png) here', 'Look  here'],
    ['html goes', 'a <b>bold</b> <img src=x> move', 'a bold  move'],
    ['emphasis markers go', '**bold** and _it_ and ***both***', 'bold and it and both'],
    ['inline code keeps its text', 'run `npm test` now', 'run npm test now'],
    ['headings, quotes, rules and list markers go', '# Title\n> quote\n---\n- item\n2. step', 'Title\nquote\nitem\nstep'],
    ['blank lines collapse', 'a\n\n\n\n\nb', 'a\n\nb'],
    ['the reply footer goes', 'Nice video\n<br><sup>replied to [12:30](https://x) on [3speak](https://3speak.tv)</sup>', 'Nice video'],
    ['the markdown reply footer goes', 'Nice\n**replied to [12:30](https://x) on 3speak', 'Nice'],
  ])('cleans markdown: %s', async (_name, input, output) => {
    await translateText(input, 'de')
    expect(sent()).toBe(output)
  })

  it('drops fenced code blocks', async () => {
    await translateText('before\n```js\nconst x = 1\n```\nafter', 'de')
    expect(sent()).not.toContain('const x')
  })

  it('plain mode only trims, so "- " lines stay a list', async () => {
    await translateText('  - one\n- two  ', 'fr', 'en', { plain: true })
    expect(h.post.mock.calls[0][1]).toEqual({ q: '- one\n- two', source: 'en', target: 'fr', format: 'text' })
  })

  it.each([
    ['only an image', '![x](https://img/x.png)', {}],
    ['empty plain text', null, { plain: true }],
  ])('sends nothing for %s', async (_name, input, opts) => {
    expect(await translateText(input, 'de', 'auto', opts)).toBe('')
    expect(h.post).not.toHaveBeenCalled()
  })

  it('passes a translator failure through', async () => {
    h.post.mockRejectedValue(new Error('503'))
    await expect(translateText('Hello', 'de')).rejects.toThrow('503')
  })
})
