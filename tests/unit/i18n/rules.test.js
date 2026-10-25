// Community translation rules (src/i18n/rules.js). The validation cases shared
// with the server copy live in server/i18n-editor.test.cjs; this file covers the
// helpers and edge cases that file does not.
import { describe, it, expect } from 'vitest'
import {
  flatten, tokens, baseKey, pluralCategories, isValidKeyShape, validateEntry, validateBatch,
  validateLanguageName, proofHash, PLURAL_SUFFIX,
} from '../../../src/i18n/rules.js'

const en = {
  'watch.title': 'Watch',
  'watch.nested': 'See $t(common.plain)',
  'items.count_one': 'Upload a video',
  'items.count_other': '{{count}} videos by {{user}}',
}

describe('flatten', () => {
  it('turns nested objects into dotted keys and leaves arrays and nulls as values', () => {
    expect(flatten({ a: { b: 'x', c: { d: 'y' } }, list: [1, 2], n: null })).toEqual({ 'a.b': 'x', 'a.c.d': 'y', list: [1, 2], n: null })
    expect(flatten({ b: 'x' }, 'area')).toEqual({ 'area.b': 'x' })
  })
})

describe('tokens', () => {
  it('collects placeholders (ignoring formats and spaces) and tag names, sorted', () => {
    expect(tokens('<b>{{ count, number }}</b> by {{user}}<br/>')).toEqual(['<b>', '<b>', '<br>', '{{count}}', '{{user}}'])
    expect(tokens('plain')).toEqual([])
    expect(tokens(5)).toEqual([])
  })
})

describe('keys', () => {
  it('baseKey strips a plural suffix only', () => {
    expect(baseKey('a.count_other')).toBe('a.count')
    expect(baseKey('a.count_few')).toBe('a.count')
    expect(baseKey('a.other')).toBe('a.other')
    expect(PLURAL_SUFFIX.test('x_many')).toBe(true)
  })

  it('a key needs at least two safe segments and at most 200 characters', () => {
    expect(isValidKeyShape('watch.title')).toBe(true)
    expect(isValidKeyShape('watch')).toBe(false)
    expect(isValidKeyShape('watch..title')).toBe(false)
    expect(isValidKeyShape('watch.ti tle')).toBe(false)
    expect(isValidKeyShape('a.prototype')).toBe(false)
    expect(isValidKeyShape(`a.${'b'.repeat(198)}`)).toBe(true)
    expect(isValidKeyShape(`a.${'b'.repeat(199)}`)).toBe(false)
    expect(isValidKeyShape(42)).toBe(false)
  })

  it('plural categories come from Intl, with one/other for unknown codes', () => {
    expect(pluralCategories('ru')).toEqual(expect.arrayContaining(['one', 'few', 'many', 'other']))
    expect(pluralCategories('ja')).toEqual(['other'])
    expect(pluralCategories('not a code!')).toEqual(['one', 'other'])
  })
})

describe('validateEntry edge cases', () => {
  const ru = pluralCategories('ru')

  it('blocks vbscript and data:text/html URLs too', () => {
    expect(validateEntry('watch.title', 'vbscript:x', en, ru)).toMatch(/Script URLs/)
    expect(validateEntry('watch.title', 'DATA : text/html,<b>', en, ru)).toMatch(/Script URLs/)
  })

  it('a nested $t reference is fine when English uses one', () => {
    expect(validateEntry('watch.nested', 'Ver $t(common.plain)', en, ru)).toBeNull()
  })

  it('a plural form may use a placeholder English uses in another form', () => {
    // Russian "one" also covers 21, 31... so it needs {{count}} even though English "one" has none.
    expect(validateEntry('items.count_one', '{{count}} видео от {{user}}', en, ru)).toBeNull()
    expect(validateEntry('items.count_few', '{{count}} видео от {{user}}', en, ru)).toBeNull()
    expect(validateEntry('items.count_many', '{{count}} видео', en, ru)).toMatch(/Missing \{\{user\}\}/)
    expect(validateEntry('items.count_few', '{{count}} {{user}} {{who}}', en, ru)).toMatch(/Unknown \{\{who\}\}/)
  })

  it('a plural form only has to keep the placeholders of its own English form, as check.mjs does', () => {
    expect(validateEntry('items.count_one', 'Загрузите видео', en, ru)).toBeNull()
  })

  it('carriage returns count as control characters', () => {
    expect(validateEntry('watch.title', 'a\rb', en, ru)).toMatch(/control characters/)
  })
})

describe('validateBatch', () => {
  it('collects sets, deletes and per-key errors in one pass', () => {
    const r = validateBatch({ 'watch.title': 'Смотреть', 'bad key': null, 'watch.nested': null, 'watch.missing': 'x' }, en, ['one', 'other'], { 'watch.nested': 'old' })
    expect(r.sets).toEqual({ 'watch.title': 'Смотреть' })
    expect(r.deletes).toEqual(['watch.nested'])
    expect(r.errors).toEqual({ 'bad key': 'Invalid key', 'watch.missing': 'This key does not exist in English' })
  })
})

describe('validateLanguageName', () => {
  it('accepts native names in any script and trims them', () => {
    expect(validateLanguageName('  Українська ')).toBeNull()
    expect(validateLanguageName('中文 (简体)')).toBeNull()
  })

  it('rejects line breaks, controls and template characters', () => {
    for (const bad of ['a\nb', 'a\u0001', 'a`b', 'a$b', 'a{b', 'a\\b', 42]) expect(validateLanguageName(bad), JSON.stringify(bad)).not.toBeNull()
    expect(validateLanguageName('x'.repeat(40))).toBeNull()
  })
})

describe('proofHash', () => {
  it('is stable and notices any edit', () => {
    expect(proofHash('Watch')).toBe(proofHash('Watch'))
    expect(proofHash('Watch')).not.toBe(proofHash('watch'))
    expect(proofHash(12)).toBe(proofHash('12'))
  })
})
