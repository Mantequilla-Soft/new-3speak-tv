// "Other ways to support me" links (src/lib/supportLinks.js): only https pages on
// the listed payment sites get into the tip window.
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../src/lib/threespeakMeta.js', () => ({
  readThreespeakMeta: vi.fn(),
  saveThreespeakMeta: vi.fn(),
}))

const { parseSupportLink, readSupportLinks, SUPPORT_LINK_MAX } = await import('../../../src/lib/supportLinks.js')
const { readThreespeakMeta } = await import('../../../src/lib/threespeakMeta.js')

describe('parseSupportLink', () => {
  it.each([
    ['ko-fi.com/badadib', 'https://ko-fi.com/badadib', 'kofi'],
    ['https://www.patreon.com/badadib/', 'https://patreon.com/badadib', 'patreon'],
    ['paypal.me/badadib', 'https://paypal.me/badadib', 'paypal'],
    ['https://www.paypal.com/donate?hosted_button_id=X1', 'https://paypal.com/donate?hosted_button_id=X1', 'paypal'],
    ['github.com/sponsors/badadib', 'https://github.com/sponsors/badadib', 'github'],
    ['buymeacoffee.com/badadib#top', 'https://buymeacoffee.com/badadib', 'buymeacoffee'],
  ])('accepts %s', (input, url, id) => {
    const r = parseSupportLink(input)
    expect(r?.url).toBe(url)
    expect(r?.site.id).toBe(id)
  })

  it.each([
    'http://ko-fi.com/badadib',
    'https://ko-fi.com/',
    'https://paypal.com/signin',
    'github.com/badadib',
    'https://evil.example/ko-fi.com/badadib',
    'https://ko-fi.com.evil.example/badadib',
    'https://user@ko-fi.com/badadib',
    'https://ko-fi.com:8443/badadib',
    'javascript:alert(1)',
    '',
  ])('refuses %s', (input) => {
    expect(parseSupportLink(input)).toBeNull()
  })
})

describe('readSupportLinks', () => {
  it('drops entries that no longer pass and keeps at most the maximum', async () => {
    const many = Array.from({ length: SUPPORT_LINK_MAX + 2 }, (_, i) => `https://ko-fi.com/a${i}`)
    readThreespeakMeta.mockResolvedValueOnce({ supportLinks: ['https://evil.example/x', ...many] })
    const links = await readSupportLinks('badadib')
    expect(links).toHaveLength(SUPPORT_LINK_MAX)
    expect(links[0].url).toBe('https://ko-fi.com/a0')
  })

  it('is empty without the key', async () => {
    readThreespeakMeta.mockResolvedValueOnce({})
    expect(await readSupportLinks('badadib')).toEqual([])
  })
})
