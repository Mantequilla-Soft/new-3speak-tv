// Hosts whose live streams show nowhere (utils/config FEED_EXCLUDED_HOSTS):
// the default list, and hidesHostStreams, which still lets the host see their own.
import { describe, it, expect } from 'vitest'
import { FEED_EXCLUDED_HOSTS, hidesHostStreams } from '../../../src/utils/config.js'

describe('hidden stream hosts', () => {
  it('badadib and ashenadib by default', () => {
    expect([...FEED_EXCLUDED_HOSTS]).toEqual(['badadib', 'ashenadib'])
  })

  it('hides their rooms from everyone, guests too, but not from the host', () => {
    expect(hidesHostStreams('ashenadib', 'someone')).toBe(true)
    expect(hidesHostStreams('AshenAdib', null)).toBe(true)
    expect(hidesHostStreams('ashenadib', 'ashenadib')).toBe(false)
    expect(hidesHostStreams('someone', 'ashenadib')).toBe(false)
    expect(hidesHostStreams('', 'x')).toBe(false)
  })
})
