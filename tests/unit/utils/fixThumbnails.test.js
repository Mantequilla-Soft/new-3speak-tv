// Card thumbnails (src/utils/fixThumbnails.js): which stored thumbnail form goes
// through which resize route, so cards load a small image and never a broken one.
import { describe, it, expect } from 'vitest'
import bs58 from 'bs58'
import {
  fixVideoThumbnail, fallbackImg, hiveProxy, hiveProxyRefuses, viaImageCache, squareCover, LANDSCAPE_LARGE,
} from '../../../src/utils/fixThumbnails.js'

const CID = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG'
const proxied = (url) => {
  const m = url.match(/^\/img\/h\/p\/([1-9A-HJ-NP-Za-km-z]+)\?(.*)$/)
  if (!m) return null
  return { source: new TextDecoder().decode(bs58.decode(m[1])), query: m[2] }
}

describe('fixVideoThumbnail: missing values', () => {
  it('falls back to the bundled image for nothing, blanks and non-strings', () => {
    expect(fixVideoThumbnail(null)).toBe(fallbackImg)
    expect(fixVideoThumbnail({})).toBe(fallbackImg)
    expect(fixVideoThumbnail({ thumbnail: '   ' })).toBe(fallbackImg)
    expect(fixVideoThumbnail({ thumbnail: 42 })).toBe(fallbackImg)
    expect(fixVideoThumbnail({ thumbnail: 'ipfs://' })).toBe(fallbackImg)
  })

  it('reads the first thumbnail field that is set', () => {
    const v = { thumbnail: 'https://a.example/last.jpg', spkvideo: { thumbnail_url: 'https://a.example/mid.jpg' }, images: { thumbnail: 'https://a.example/first.jpg' } }
    expect(proxied(fixVideoThumbnail(v)).source).toBe('https://a.example/first.jpg')
    expect(proxied(fixVideoThumbnail({ thumbnail_url: 'https://a.example/t.jpg' })).source).toBe('https://a.example/t.jpg')
  })
})

describe('fixVideoThumbnail: IPFS', () => {
  it('ipfs:// URIs go through the resize proxy via the one gateway it accepts', () => {
    const out = proxied(fixVideoThumbnail({ thumbnail: `ipfs://${CID}` }))
    expect(out.source).toBe(`https://ipfs-3speak.b-cdn.net/ipfs/${CID}`)
    expect(out.query).toBe('format=jpeg&mode=cover&width=340&height=191')
  })

  it('shorts ask for a portrait crop', () => {
    expect(proxied(fixVideoThumbnail({ thumbnail: `ipfs://${CID}` }, true)).query).toBe('format=jpeg&mode=cover&width=360&height=640')
  })

  it('every 3Speak IPFS gateway URL is normalised to the proxy-able host', () => {
    for (const host of ['ipfs.3speak.tv', 'hotipfs-3speak-1.b-cdn.net', 'ipfs-audio.3speak.tv', 'IPFS-3SPEAK.B-CDN.NET']) {
      expect(proxied(fixVideoThumbnail({ thumbnail: `https://${host}/ipfs/${CID}/thumb.png` })).source, host)
        .toBe(`https://ipfs-3speak.b-cdn.net/ipfs/${CID}/thumb.png`)
    }
  })

  it('a bare CID is treated like an ipfs:// URI', () => {
    expect(proxied(fixVideoThumbnail({ thumbnail: CID })).source).toBe(`https://ipfs-3speak.b-cdn.net/ipfs/${CID}`)
  })

  it('an http URL wrongly wrapped in an IPFS path is unwrapped', () => {
    expect(fixVideoThumbnail({ thumbnail: 'https://ipfs.3speak.tv/ipfs/https://img.example/a.jpg' })).toBe('https://img.example/a.jpg')
  })
})

describe('fixVideoThumbnail: hosts', () => {
  it('an already sized Hive proxy URL is served through our cache untouched', () => {
    expect(fixVideoThumbnail({ thumbnail: 'https://images.hive.blog/p/abc?format=jpeg&width=340' })).toBe('/img/h/p/abc?format=jpeg&width=340')
    expect(fixVideoThumbnail({ thumbnail: 'https://images.hive.blog/640x0/https://x/y.jpg' })).toBe('/img/h/640x0/https://x/y.jpg')
  })

  it('a Hive /p/ URL for a short is re-requested in portrait', () => {
    expect(fixVideoThumbnail({ thumbnail: 'https://images.hive.blog/p/abc?format=jpeg&width=340&height=191' }, true))
      .toBe('/img/h/p/abc?format=jpeg&mode=cover&width=360&height=640')
  })

  it('raw Ecency images go through Ecency\'s own resizer, never Hive\'s', () => {
    const src = 'https://images.ecency.com/DQm123/photo.jpg'
    expect(fixVideoThumbnail({ thumbnail: src }))
      .toBe(`https://images.ecency.com/p/${bs58.encode(Buffer.from(src))}?format=jpeg&mode=cover&width=340&height=191`)
    expect(fixVideoThumbnail({ thumbnail: 'https://images.ecency.com/p/xyz?format=webp' })).toBe('https://images.ecency.com/p/xyz?format=webp')
    expect(fixVideoThumbnail({ thumbnail: 'https://images.ecency.com/p/xyz?format=webp' }, true))
      .toBe('https://images.ecency.com/p/xyz?format=jpeg&mode=cover&width=360&height=640')
  })

  it('the retired media.3speak.tv host shows the local fallback', () => {
    expect(fixVideoThumbnail({ thumbnail: 'https://media.3speak.tv/x/thumb.jpg' })).toBe('/images/speak.jpg')
  })

  it('our own images.3speak.tv goes through the /img/t/ crop route', () => {
    expect(fixVideoThumbnail({ thumbnail: 'https://images.3speak.tv/a/b.jpg?v=2' })).toBe('/img/t/a/b.jpg')
    expect(fixVideoThumbnail({ thumbnail: 'https://images.3speak.tv/a/b.jpg' }, true)).toBe('/img/t/a/b.jpg?s=p')
  })

  it('any other web image is downscaled through the Hive proxy', () => {
    const out = proxied(fixVideoThumbnail({ thumbnail: ' https://i.imgur.com/x.png ' }))
    expect(out.source).toBe('https://i.imgur.com/x.png')
  })

  it('a wide card can ask for a larger size', () => {
    expect(proxied(fixVideoThumbnail({ thumbnail: 'https://x.example/a.png' }, false, LANDSCAPE_LARGE)).query)
      .toBe('format=jpeg&mode=cover&width=960&height=540')
  })

  it('anything else (a local path) is returned as-is', () => {
    expect(fixVideoThumbnail({ thumbnail: '/images/local.png' })).toBe('/images/local.png')
  })
})

describe('proxy helpers', () => {
  it('knows which hosts the Hive proxy refuses', () => {
    expect(hiveProxyRefuses('https://images.3speak.tv/x.jpg')).toBe(true)
    expect(hiveProxyRefuses('http://img.3speak.tv/x.jpg')).toBe(true)
    expect(hiveProxyRefuses('https://images.hive.blog/x.jpg')).toBe(false)
    expect(hiveProxyRefuses(null)).toBe(false)
  })

  it('hiveProxy leaves refused hosts alone', () => {
    expect(hiveProxy('https://images.3speak.tv/x.jpg', { w: 1, h: 1 })).toBe('https://images.3speak.tv/x.jpg')
  })

  it('viaImageCache only rewrites images.hive.blog', () => {
    expect(viaImageCache('https://images.hive.blog/u/a/avatar')).toBe('/img/h/u/a/avatar')
    expect(viaImageCache('https://other.example/x')).toBe('https://other.example/x')
    expect(viaImageCache(undefined)).toBe('')
  })

  it('squareCover crops our own covers via /img/a/ and others via the proxy', () => {
    expect(squareCover('https://images.3speak.tv/covers/c.png?x=1', 128)).toBe('/img/a/covers/c.png?px=128')
    expect(proxied(squareCover('https://x.example/c.png')).query).toBe('format=jpeg&mode=cover&width=512&height=512')
    expect(squareCover('/local.png')).toBe('/local.png')
    expect(squareCover(null)).toBe('')
  })
})
