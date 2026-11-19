// @vitest-environment jsdom
// The spoken language of an upload (utils/contentLanguage.js): the last pick in
// this browser, else the site language when it is one of the list, else English.
import { describe, it, expect, beforeEach, vi } from 'vitest'

const lang = { current: 'de' }
vi.mock('i18next', () => ({ default: { get resolvedLanguage() { return lang.current } } }))
const { readContentLanguage, writeContentLanguage, languageNamer, NO_SPEECH } = await import('../../../src/utils/contentLanguage.js')

beforeEach(() => { localStorage.clear(); lang.current = 'de' })

describe('content language', () => {
  it('starts on the site language, or English when that is not in the list', () => {
    expect(readContentLanguage()).toBe('de')
    lang.current = 'pt-BR'
    expect(readContentLanguage()).toBe('pt')
    lang.current = 'xx'
    expect(readContentLanguage()).toBe('en')
  })

  it('remembers the last pick, no speech included, and ignores unknown codes', () => {
    writeContentLanguage('ja')
    expect(readContentLanguage()).toBe('ja')
    writeContentLanguage(NO_SPEECH)
    expect(readContentLanguage()).toBe('zxx')
    writeContentLanguage('klingon')
    expect(readContentLanguage()).toBe('zxx')
  })

  it('names a language in the reader\'s language', () => {
    expect(languageNamer('en')('de')).toBe('German')
    expect(languageNamer('de')('de')).toBe('Deutsch')
  })
})
