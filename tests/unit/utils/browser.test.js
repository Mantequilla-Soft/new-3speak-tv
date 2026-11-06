// Browser checks for the teleprompter's voice scroll (src/utils/browser.js):
// only real Chromium engines qualify, and a bare language code is promoted to a
// tag the speech recognizer accepts.
import { describe, it, expect, vi } from 'vitest'
import { isChromium, normalizeSpeechLang } from '../../../src/utils/browser.js'

const withNavigator = (nav) => vi.stubGlobal('navigator', nav)

describe('isChromium', () => {
  it.each([
    [[{ brand: 'Chromium', version: '130' }, { brand: 'Google Chrome', version: '130' }], true],
    [[{ brand: 'Not A;Brand', version: '99' }], false],
  ])('trusts UA client hints %j -> %s', (brands, yes) => {
    withNavigator({ userAgentData: { brands }, userAgent: 'Firefox/1' })
    expect(isChromium()).toBe(yes)
  })

  it.each([
    ['Chrome on Windows', 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36', true],
    ['Edge', 'Mozilla/5.0 AppleWebKit/537.36 Chrome/130 Safari/537.36 Edg/130.0', true],
    ['Opera', 'Mozilla/5.0 AppleWebKit/537.36 OPR/110.0', true],
    ['Firefox', 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0', false],
    ['Chrome on iPhone (WebKit)', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) CriOS/130.0 Mobile Safari/604.1', false],
    ['Safari on iPad', 'Mozilla/5.0 (iPad; CPU OS 17_0) AppleWebKit/605.1.15 Version/17.0 Safari/604.1', false],
    ['Safari on macOS', 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15', false],
  ])('falls back to the user agent: %s -> %s', (_name, userAgent, yes) => {
    withNavigator({ userAgent })
    expect(isChromium()).toBe(yes)
  })

  it('is false with no navigator or user agent', () => {
    withNavigator({})
    expect(isChromium()).toBe(false)
    vi.stubGlobal('navigator', undefined)
    expect(isChromium()).toBe(false)
  })
})

describe('normalizeSpeechLang', () => {
  it.each([
    ['en', 'en-US'],
    ['DE', 'de-DE'],
    ['pt', 'pt-BR'],
    [' zh ', 'zh-CN'],
    ['pt-PT', 'pt-PT'],
    ['xx', 'en-US'],
    ['', 'en-US'],
    [undefined, 'en-US'],
  ])('%j -> %s', (input, tag) => {
    expect(normalizeSpeechLang(input)).toBe(tag)
  })
})
