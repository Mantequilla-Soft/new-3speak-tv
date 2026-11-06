// Bundled translations (src/locales/<lang>/*.json) against English. Every
// language ships every area file and every English text, uses only the plural
// forms its grammar has, keeps the placeholders and tags English uses, and
// passes the same safety rules the in-app editor applies (src/i18n/rules.js).
// A failure here names the language, the key and what is wrong with it.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { LANGUAGES, LANGUAGE_CODES, DEFAULT_LANGUAGE } from '../../../src/i18n/languages.js'
import { flatten, validateEntry, pluralCategories, PLURAL_SUFFIX, baseKey } from '../../../src/i18n/rules.js'

const ROOT = path.resolve(__dirname, '../../../src/locales')
const AREAS = fs.readdirSync(path.join(ROOT, 'en')).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort()
const readArea = (lang, area) => JSON.parse(fs.readFileSync(path.join(ROOT, lang, `${area}.json`), 'utf8'))
const readFlat = (lang) => Object.assign({}, ...AREAS.map((a) => flatten(readArea(lang, a), a)))

const EN = readFlat('en')
const OTHERS = LANGUAGE_CODES.filter((c) => c !== DEFAULT_LANGUAGE)

describe('the language list', () => {
  it('has unique codes, English first, and a folder for every language', () => {
    expect(new Set(LANGUAGE_CODES).size).toBe(LANGUAGE_CODES.length)
    expect(LANGUAGES[0].code).toBe(DEFAULT_LANGUAGE)
    const folders = fs.readdirSync(ROOT).filter((d) => fs.statSync(path.join(ROOT, d)).isDirectory()).sort()
    expect(folders).toEqual([...LANGUAGE_CODES].sort())
  })

  it('names every language in itself and in English', () => {
    for (const l of LANGUAGES) {
      expect(l.native, l.code).toBeTruthy()
      expect(l.english, l.code).toBeTruthy()
    }
  })
})

describe.each(OTHERS)('%s', (lang) => {
  const categories = pluralCategories(lang)
  let flat

  it('has the same area files as English', () => {
    const files = fs.readdirSync(path.join(ROOT, lang)).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort()
    expect(files).toEqual(AREAS)
    flat = readFlat(lang)
  })

  it('translates every English text (plural texts in every form the language uses)', () => {
    flat ||= readFlat(lang)
    const missing = []
    for (const key of Object.keys(EN)) {
      const m = key.match(PLURAL_SUFFIX)
      if (!m) {
        if (!(key in flat)) missing.push(key)
      } else if (m[1] === 'other') {
        for (const c of categories) if (!(`${baseKey(key)}_${c}` in flat)) missing.push(`${baseKey(key)}_${c}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('has no stray keys, and every text keeps its placeholders and passes the editor rules', () => {
    flat ||= readFlat(lang)
    const problems = Object.entries(flat)
      .map(([key, value]) => [key, validateEntry(key, value, EN, categories)])
      .filter(([, err]) => err)
      .map(([key, err]) => `${key}: ${err}`)
    expect(problems).toEqual([])
  })
})
