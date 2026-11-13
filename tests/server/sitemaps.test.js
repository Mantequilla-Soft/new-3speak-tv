// The thumbnail each sitemap video entry carries (server/sitemaps.cjs).
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { thumbnailUrl } = require('../../server/sitemaps.cjs')

const CID = 'bafkreid35b2rrxw4gh56b3rpxpegpwtvd3pav7kgwooovnfndnpy5uuada'

describe('sitemap thumbnails', () => {
  it('serve every IPFS thumbnail from ipfs-audio, whatever gateway it was stored with', () => {
    for (const stored of [
      `ipfs://${CID}`,
      `https://ipfs.3speak.tv/ipfs/${CID}`,
      `https://ipfs-3speak.b-cdn.net/ipfs/${CID}`,
      `https://hotipfs-3speak-1.b-cdn.net/ipfs/${CID}`,
      `https://ipfs-audio.3speak.tv/ipfs/${CID}`,
    ]) {
      expect(thumbnailUrl(stored), stored).toBe(`https://ipfs-audio.3speak.tv/ipfs/${CID}`)
    }
  })

  it('leave other image hosts alone and drop what cannot be a thumbnail', () => {
    expect(thumbnailUrl('https://images.3speak.tv/images/a.webp')).toBe('https://images.3speak.tv/images/a.webp')
    expect(thumbnailUrl('https://media.3speak.tv/x/thumbnails/default.png')).toBe(null)
    expect(thumbnailUrl('not a url')).toBe(null)
    expect(thumbnailUrl('')).toBe(null)
  })
})
