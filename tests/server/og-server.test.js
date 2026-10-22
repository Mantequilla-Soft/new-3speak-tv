// The share-card sidecar (server/og-server.cjs): /oembed validation and sizing, and
// the Open Graph HTML crawlers get. Hive and checker lookups are answered from
// fixtures (see helpers/preload.cjs); Discord/Telegram teaser videos (ffmpeg) and
// the live transcript/comment lookups are not exercised.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startOg } from './helpers/server.js'

const hivePost = (author, permlink, extra = {}) => ({
  url: 'https://api.hive.blog',
  method: 'POST',
  body: { method: 'bridge.get_post', params: { author, permlink } },
  json: {
    result: {
      author,
      permlink,
      title: 'Cooking with <b>fire</b> & friends',
      body: 'A long enough description of this video so that it reads like a real post body.',
      json_metadata: { app: '3speak/0.3.0', tags: ['cooking'], video: { info: { duration: 125 } }, image: ['https://images.3speak.tv/thumb.jpg'] },
      created: '2026-01-02T03:04:05',
      children: 0,
      stats: {},
      ...extra,
    },
  },
})

const FIXTURES = {
  fetch: [
    hivePost('alice', 'my-video'),
    hivePost('alice', 'spicy', { json_metadata: { app: '3speak/0.3.0', tags: ['nsfw'] } }),
    {
      url: 'https://checker.test.invalid/videodetails/alice/short1',
      json: { owner: 'alice', permlink: 'short1', embed_title: 'A short', thumbnail_url: 'https://images.3speak.tv/s.jpg', duration: 20 },
    },
    // Anything else on Hive: no such post.
    { url: 'https://api.hive.blog', method: 'POST', json: { result: null } },
  ],
}

let og
beforeAll(async () => { og = await startOg({ fixtures: FIXTURES }) })
afterAll(async () => { await og?.stop() })

const oembed = (params) => og.rawRequest(`/oembed?${new URLSearchParams(params)}`, { headers: { Host: '3speak.tv' } })
const crawl = (path, ua = 'Twitterbot/1.0') => og.rawRequest(path, { headers: { Host: '3speak.tv', 'User-Agent': ua } })
const meta = (html, property) => {
  const m = new RegExp(`<meta (?:property|name)="${property}" content="([^"]*)"`).exec(html)
  return m && m[1]
}

describe('og sidecar', () => {
  it('answers its health probe', async () => {
    const r = await og.rawRequest('/og-health')
    expect(r.status).toBe(200)
    expect(JSON.parse(r.text)).toEqual({ ok: true })
  })
})

describe('/oembed', () => {
  it('only speaks JSON', async () => {
    const r = await oembed({ url: 'https://3speak.tv/watch?v=alice/my-video', format: 'xml' })
    expect(r.status).toBe(501)
    expect(r.text).toBe('Only format=json is supported')
  })

  it('refuses URLs that are not 3Speak videos without looking anything up', async () => {
    og.clearNetLog()
    for (const url of ['', 'not a url', 'https://youtube.com/watch?v=alice/my-video', 'https://3speak.tv.evil.example/watch?v=alice/my-video', 'https://3speak.tv/about', 'https://3speak.tv/watch?v=novideo', 'javascript:alert(1)']) {
      const r = await oembed({ url })
      expect(r.status, url).toBe(404)
      expect(r.text).toBe('Not a 3Speak video URL')
    }
    expect(og.netLog()).toEqual([])
  })

  it('404s a video that does not exist', async () => {
    const r = await oembed({ url: 'https://3speak.tv/watch?v=alice/nothing-here' })
    expect(r.status).toBe(404)
    expect(r.text).toBe('Video not found')
  })

  it('describes a video as an embeddable 16:9 player', async () => {
    const r = await oembed({ url: 'https://3speak.tv/watch?v=alice/my-video' })
    expect(r.status).toBe(200)
    expect(r.headers['access-control-allow-origin']).toBe('*')
    const body = JSON.parse(r.text)
    expect(body).toMatchObject({
      version: '1.0', type: 'video', provider_name: '3Speak', author_name: 'alice',
      title: 'Cooking with <b>fire</b> & friends', width: 640, height: 360,
    })
    expect(body.html).toContain('src="https://play.3speak.tv/watch?v=alice/my-video&amp;mode=iframe"')
    expect(body.html).toContain('title="3Speak video: Cooking with &lt;b&gt;fire&lt;/b&gt; &amp; friends"')
    expect(body.html).not.toContain('<b>')
  })

  it('shrinks the player to maxwidth and maxheight, keeping the ratio', async () => {
    const url = 'https://3speak.tv/watch?v=alice/my-video'
    const size = async (p) => { const b = JSON.parse((await oembed({ url, ...p })).text); return [b.width, b.height] }
    expect(await size({ maxwidth: '320' })).toEqual([320, 180])
    expect(await size({ maxheight: '90' })).toEqual([160, 90])
    expect(await size({ maxwidth: '2000' })).toEqual([640, 360])
    expect(await size({ maxwidth: 'abc', maxheight: '-5' })).toEqual([640, 360])
  })

  it('gives a short a 9:16 player', async () => {
    const r = await oembed({ url: 'https://3speak.tv/shorts?v=alice/short1', maxwidth: '180' })
    const body = JSON.parse(r.text)
    expect([body.width, body.height]).toEqual([180, 320])
    expect(body.title).toBe('A short')
  })

  it('refuses to embed an NSFW video', async () => {
    const r = await oembed({ url: 'https://3speak.tv/watch?v=alice/spicy' })
    expect(r.status).toBe(401)
    expect(r.text).toBe('This video cannot be embedded')
  })
})

describe('crawler cards', () => {
  it('a watch link gets the video\'s Open Graph and Twitter tags', async () => {
    const r = await crawl('/watch?v=alice/my-video')
    expect(r.status).toBe(200)
    expect(r.headers['content-type']).toBe('text/html; charset=utf-8')
    expect(r.headers['cache-control']).toBe('no-store')
    expect(meta(r.text, 'og:title')).toBe('Cooking with &lt;b&gt;fire&lt;/b&gt; &amp; friends')
    expect(meta(r.text, 'og:type')).toBe('video.other')
    expect(meta(r.text, 'og:url')).toBe('https://3speak.tv/watch?v=alice/my-video')
    expect(meta(r.text, 'twitter:card')).toBeTruthy()
    expect(r.text).toContain('type="application/json+oembed"')
  })

  it('an NSFW video is carded but kept out of search and has no oEmbed', async () => {
    const r = await crawl('/watch?v=alice/spicy')
    expect(r.text).toMatch(/<meta name="robots" content="noindex/)
    expect(r.text).not.toContain('application/json+oembed')
  })

  it('anything that is not a video gets the generic site card', async () => {
    for (const path of ['/watch?v=alice/nothing-here', '/some/unknown/page']) {
      const r = await crawl(path)
      expect(r.status).toBe(200)
      expect(meta(r.text, 'og:title')).toBe('3S | Real People - Real Stories')
      expect(meta(r.text, 'og:site_name')).toBe('3Speak')
    }
  })

  it('a HEAD request gets headers and no body', async () => {
    const r = await og.rawRequest('/watch?v=alice/my-video', { method: 'HEAD', headers: { Host: '3speak.tv', 'User-Agent': 'Twitterbot/1.0' } })
    expect(r.status).toBe(200)
    expect(r.text).toBe('')
  })
})
