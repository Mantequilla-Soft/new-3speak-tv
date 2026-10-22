// The editor teleprompter's word matcher (src/utils/scriptMatcher.js): it
// follows a reader through the script from what the speech recognizer hears.
import { describe, it, expect } from 'vitest'
import createMatcher, {
  normalize, tokenize, levenshtein, fuzzyEqual, LOOKAHEAD,
} from '../../../src/utils/scriptMatcher.js'

const matcherFor = (text) => {
  const words = tokenize(text)
  return { words, m: createMatcher(words) }
}

describe('normalize and tokenize', () => {
  it('lowercases and drops punctuation but keeps letters of any script and digits', () => {
    expect(normalize('Hello,')).toBe('hello')
    expect(normalize('"Don\'t!"')).toBe('dont')
    expect(normalize('Größe')).toBe('größe')
    expect(normalize('日本語')).toBe('日本語')
    expect(normalize('2026')).toBe('2026')
    expect(normalize('—')).toBe('')
  })

  it('splits words and records the line breaks in front of each one', () => {
    const t = tokenize('Line one\nLine two\n\nNew para')
    expect(t.map((w) => [w.text, w.br])).toEqual([
      ['Line', 0], ['one', 0], ['Line', 1], ['two', 0], ['New', 2], ['para', 0],
    ])
    expect(t[0].norm).toBe('line')
  })

  it('ignores leading blank lines and handles empty input', () => {
    expect(tokenize('\n\n  Hello')).toEqual([{ text: 'Hello', norm: 'hello', br: 0 }])
    expect(tokenize('')).toEqual([])
    expect(tokenize(null)).toEqual([])
  })
})

describe('levenshtein and fuzzyEqual', () => {
  it('measures edit distance and gives up past the bound', () => {
    expect(levenshtein('kitten', 'sitting', 5)).toBe(3)
    expect(levenshtein('same', 'same', 1)).toBe(0)
    expect(levenshtein('kitten', 'sitting', 1)).toBe(2)
    expect(levenshtein('a', 'abcdef', 2)).toBe(3)
  })

  it('accepts small spelling differences in longer words', () => {
    expect(fuzzyEqual('recognise', 'recognize')).toBe(true)
    expect(fuzzyEqual('hello', 'hallo')).toBe(true)
    expect(fuzzyEqual('teleprompter', 'teleprompters')).toBe(true)
  })

  it('short words must match exactly so the/they/then do not mix', () => {
    expect(fuzzyEqual('the', 'they')).toBe(false)
    expect(fuzzyEqual('then', 'than')).toBe(false)
    expect(fuzzyEqual('the', 'the')).toBe(true)
  })

  it('needs the same first letter and a close length', () => {
    expect(fuzzyEqual('house', 'mouse')).toBe(false)
    expect(fuzzyEqual('market', 'marketing')).toBe(false)
    expect(fuzzyEqual('', 'hello')).toBe(false)
  })
})

describe('createMatcher', () => {
  it('moves the pointer forward word by word', () => {
    const { m } = matcherFor('The quick brown fox jumps over the lazy dog')
    expect(m.advance(['the', 'quick'])).toBe(2)
    expect(m.advance(['brown'])).toBe(3)
    expect(m.matched).toBe(3)
  })

  it('may jump a few skipped words but not further than the lookahead', () => {
    const { m } = matcherFor('The quick brown fox jumps over the lazy dog')
    expect(m.advance(['fox'])).toBe(4)
    const far = matcherFor('one two three four five six seven')
    expect(far.m.advance(['six'])).toBe(0)
    expect(LOOKAHEAD).toBe(4)
  })

  it('never moves backwards', () => {
    const { m } = matcherFor('alpha bravo charlie delta echo')
    m.advance(['alpha', 'bravo', 'charlie'])
    expect(m.advance(['alpha'])).toBe(3)
  })

  it('steps over punctuation-only tokens', () => {
    const { m } = matcherFor('Hello — world')
    expect(m.advance(['hello'])).toBe(2)
    expect(m.advance(['world'])).toBe(3)
  })

  it('matches a script word the recognizer split in two', () => {
    const { m } = matcherFor('please reshare this video')
    expect(m.advance(['please', 're', 'share', 'this'])).toBe(3)
  })

  it('matches two script words the recognizer merged into one', () => {
    const { m } = matcherFor('the tele prompter works')
    expect(m.advance(['the', 'teleprompter', 'works'])).toBe(4)
  })

  it('catches up when the reader skips a passage', () => {
    const { m } = matcherFor('alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike')
    expect(m.advance(['india', 'juliet', 'kilo'])).toBe(11)
    expect(m.resyncs).toBe(1)
    expect(m.advance(['lima'])).toBe(12)
  })

  it('does not jump on one common word matching far ahead', () => {
    const { m } = matcherFor('we start here and then far later the word banana shows up and the end')
    expect(m.advance(['banana'])).toBe(0)
    expect(m.advance(['xyz', 'qqq'])).toBe(0)
    expect(m.resyncs).toBe(0)
  })

  it('stops at the end of the script', () => {
    const { words, m } = matcherFor('short script')
    expect(m.advance(['short', 'script', 'and', 'more'])).toBe(words.length)
  })

  it('ignores empty recognizer words', () => {
    const { m } = matcherFor('one two')
    expect(m.advance(['', null, 'one'])).toBe(1)
  })

  it('resets the pointer for a different script, not for the same list', () => {
    const { words, m } = matcherFor('one two three')
    m.advance(['one', 'two'])
    m.setWords(words)
    expect(m.matched).toBe(2)
    m.setWords(tokenize('one two three'))
    expect(m.matched).toBe(0)
  })

  it('reset() starts over', () => {
    const { m } = matcherFor('one two three')
    m.advance(['one', 'two'])
    m.reset()
    expect(m.matched).toBe(0)
    expect(m.miss).toBe(0)
  })

  it('works with an empty script', () => {
    expect(createMatcher().advance(['hello'])).toBe(0)
  })
})
