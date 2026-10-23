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
    // A snap: the short's Hive post is a reply titled after its container, and
    // the checker knows it by that post as well as by its asset id.
    hivePost('alice', 'snap-post', {
      parent_author: 'peak.snaps',
      title: 'RE: Snaps Container // 10/23/2026',
      body: 'https://play.3speak.tv/embed?v=alice/snapasset\n\nMy dog learns to surf\n\nmore text',
    }),
    {
      url: 'https://checker.test.invalid/videodetails/alice/snap-post',
      json: { owner: 'alice', permlink: 'snapasset', short: true, embed_url: '@alice/snap-post', thumbnail_url: 'https://images.3speak.tv/s2.jpg', duration: 15 },
    },
    // Hive's node is down for this one.
    { url: 'https://api.hive.blog', method: 'POST', body: { method: 'bridge.get_post', params: { author: 'bob', permlink: 'flaky' } }, status: 502, json: {} },
    // Lists: a tag with videos, a tag with none, a community.
    {
      url: 'https://checker.test.invalid/videos/tag/cooking?page=1&limit=40&type=videos',
      json: { total: 2, videos: [
        { owner: 'alice', permlink: 'my-video', title: 'Cooking with fire', duration: 125, images: { thumbnail: 'https://images.3speak.tv/thumb.jpg' } },
        { owner: 'alice', permlink: 'spicy-one', title: 'Something nsfw', isNsfwContent: true },
      ] },
    },
    { url: 'https://checker.test.invalid/videos/tag/emptytag?page=1&limit=40&type=videos', json: { total: 0, videos: [] } },
    {
      url: 'https://api.hive.blog', method: 'POST', body: { method: 'bridge.get_community', params: { name: 'hive-100001' } },
      json: { result: { name: 'hive-100001', title: 'Cooks', about: 'People who cook on camera.', subscribers: 1200, lang: 'en' } },
    },
    {
      url: 'https://api.hive.blog', method: 'POST', body: { method: 'bridge.get_community', params: { name: 'hive-100002' } },
      json: { error: { code: -32602, message: 'Assert Exception:given community name is not valid' } },
    },
    { url: 'https://checker.test.invalid/feeds/community/hive-100001/new?page=1&limit=40', json: { videos: [{ owner: 'alice', permlink: 'my-video', title: 'Cooking with fire' }] } },
    // Every other video id: the checker has no such video.
    { url: 'https://checker.test.invalid/videodetails/', prefix: true, status: 404, json: { error: 'Video not found' } },
    // Anything else on Hive: no such post.
    { url: 'https://api.hive.blog', method: 'POST', json: { result: null } },
  ],
}

let og
beforeAll(async () => { og = await startOg({ fixtures: FIXTURES }) })
afterAll(async () => { await og?.stop() })

const oembed = (params) => og.rawRequest(`/oembed?${new URLSearchParams(params)}`, { headers: { Host: '3speak.tv' } })
const crawl = (path, ua = 'Twitterbot/1.0', host = '3speak.tv') => og.rawRequest(path, { headers: { Host: host, 'User-Agent': ua } })
const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
const canonical = (html) => { const m = /<link rel="canonical" href="([^"]*)"/.exec(html); return m && m[1] }
const jsonLd = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
  .flatMap((m) => { const d = JSON.parse(m[1]); return Array.isArray(d) ? d : [d] })
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
      expect(meta(r.text, 'og:title')).toBe('3Speak: the video platform where creators and viewers earn')
      expect(meta(r.text, 'og:site_name')).toBe('3Speak')
    }
  })

  it('a link preview of a deleted video keeps the generic card, out of the index', async () => {
    const r = await crawl('/watch?v=alice/nothing-here')
    expect(r.status).toBe(200)
    expect(r.text).toMatch(/<meta name="robots" content="noindex/)
  })

  it('a HEAD request gets headers and no body', async () => {
    const r = await og.rawRequest('/watch?v=alice/my-video', { method: 'HEAD', headers: { Host: '3speak.tv', 'User-Agent': 'Twitterbot/1.0' } })
    expect(r.status).toBe(200)
    expect(r.text).toBe('')
  })
})

describe('search engines', () => {
  it('get a real 404 for a video neither Hive nor the checker has', async () => {
    const r = await crawl('/watch?v=alice/nothing-here', GOOGLEBOT)
    expect(r.status).toBe(404)
    expect(r.text).toMatch(/<meta name="robots" content="noindex/)
  })

  it('get a 404 for a name no Hive account can have, without asking anyone', async () => {
    og.clearNetLog()
    for (const path of ['/watch?v=A_B/x', '/user/A_B', '/t/not%20a%20tag', '/community/hive-x']) {
      const r = await crawl(path, GOOGLEBOT)
      expect(r.status, path).toBe(404)
    }
    expect(og.netLog()).toEqual([])
  })

  it('get a 503 to retry later when Hive cannot answer, never a 404 or noindex', async () => {
    const r = await crawl('/watch?v=bob/flaky', GOOGLEBOT)
    expect(r.status).toBe(503)
    expect(r.headers['retry-after']).toBeTruthy()
  })

  it('see one canonical on 3speak.tv, whichever host or address was asked', async () => {
    const preview = await crawl('/watch?v=alice/my-video', GOOGLEBOT, 'preview.3speak.tv')
    expect(canonical(preview.text)).toBe('https://3speak.tv/watch?v=alice/my-video')
    expect(meta(preview.text, 'og:url')).toBe('https://preview.3speak.tv/watch?v=alice/my-video')
    const www = await crawl('/watch?v=alice/my-video', GOOGLEBOT, 'www.3speak.tv')
    expect(meta(www.text, 'og:url')).toBe('https://3speak.tv/watch?v=alice/my-video')
    const at = await crawl('/@alice/my-video', GOOGLEBOT)
    expect(canonical(at.text)).toBe('https://3speak.tv/watch?v=alice/my-video')
  })

  it('see a short as its /shorts page, titled by its caption, however it was reached', async () => {
    for (const path of ['/shorts?v=alice/snap-post', '/watch?v=alice/snap-post', '/shorts/stories?v=alice/snap-post']) {
      const r = await crawl(path, GOOGLEBOT)
      expect(r.status, path).toBe(200)
      expect(canonical(r.text), path).toBe('https://3speak.tv/shorts?v=alice/snapasset')
      expect(r.text, path).toContain('<title>My dog learns to surf - 3Speak</title>')
    }
  })

  it('get a VideoObject and a breadcrumb trail on a watch page', async () => {
    const ld = jsonLd((await crawl('/watch?v=alice/my-video', GOOGLEBOT)).text)
    const video = ld.find((d) => d['@type'] === 'VideoObject')
    expect(video).toMatchObject({ url: 'https://3speak.tv/watch?v=alice/my-video', duration: 'PT2M5S' })
    const crumbs = ld.find((d) => d['@type'] === 'BreadcrumbList')
    expect(crumbs.itemListElement.map((i) => i.item)).toEqual([
      'https://3speak.tv/', 'https://3speak.tv/user/alice', 'https://3speak.tv/watch?v=alice/my-video',
    ])
  })
})

describe('list pages', () => {
  it('a tag page lists its videos as links, NSFW left out', async () => {
    const r = await crawl('/t/Cooking', GOOGLEBOT)
    expect(r.status).toBe(200)
    expect(r.text).toContain('<title>#cooking videos - 3Speak</title>')
    expect(canonical(r.text)).toBe('https://3speak.tv/t/cooking')
    expect(r.text).toContain('href="https://3speak.tv/watch?v=alice/my-video"')
    expect(r.text).not.toContain('spicy-one')
    // Two videos: a thin page, kept out of the index but followed.
    expect(r.text).toMatch(/<meta name="robots" content="noindex, follow"/)
    const list = jsonLd(r.text).find((d) => d['@type'] === 'CollectionPage')
    expect(list.mainEntity.itemListElement).toHaveLength(1)
  })

  it('a tag with no videos at all is a 404', async () => {
    expect((await crawl('/t/emptytag', GOOGLEBOT)).status).toBe(404)
  })

  it('a community page has its name, about text and newest videos', async () => {
    const r = await crawl('/community/hive-100001', GOOGLEBOT)
    expect(r.status).toBe(200)
    expect(r.text).toContain('<title>Cooks community - 3Speak</title>')
    expect(r.text).toContain('People who cook on camera.')
    expect(r.text).toContain('href="https://3speak.tv/watch?v=alice/my-video"')
    expect(canonical(r.text)).toBe('https://3speak.tv/community/hive-100001')
  })

  it('an unknown community is a 404', async () => {
    expect((await crawl('/community/hive-100002', GOOGLEBOT)).status).toBe(404)
  })
})
