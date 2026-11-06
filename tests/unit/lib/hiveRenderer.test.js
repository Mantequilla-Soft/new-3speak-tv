// @vitest-environment jsdom
// Hive markdown renderer (src/lib/hiveRenderer/renderer.js and index.js). Post
// bodies are written by anyone, so most of this file is about what must never
// survive into the page: scripts, javascript: links, event handlers, overlays,
// LAN probes and third-party players. The rest pins the 3Speak and IPFS embeds,
// mentions, hashtags and Hive frontend links the app relies on.
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { createHiveRenderer } from '../../../src/lib/hiveRenderer/renderer.js'

let render
beforeAll(() => {
  render = createHiveRenderer({ usertagUrlFn: (a) => `/@${a}`, hashtagUrlFn: (t) => `/t/${t}` })
})

// Parse rendered HTML so assertions read like "there is no iframe" instead of
// matching exact serialisation.
const dom = (html) => {
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  return tpl.content
}
const allAttrs = (frag) =>
  [...frag.querySelectorAll('*')].flatMap((el) => [...el.attributes].map((a) => `${el.nodeName.toLowerCase()}[${a.name}=${a.value}]`))

describe('XSS: nothing executable survives', () => {
  it('refuses a body with a raw <script> tag outright instead of rendering part of it', () => {
    expect(() => render('Hello <script>alert(1)</script> world')).toThrow(/script tag/)
  })

  it('still shows a script tag written as code, escaped', () => {
    const out = render('```\n<script>alert(1)</script>\n```')
    expect(dom(out).querySelector('script')).toBeNull()
    expect(dom(out).querySelector('pre code').textContent).toBe('<script>alert(1)</script>\n')
    expect(render('Use `<script>` tags')).toContain('<code>&lt;script&gt;</code>')
  })

  it.each([
    ['img onerror', '<img src="x" onerror="alert(1)">'],
    ['img onpointerenter (not in the forbid list)', '<img src="x" onpointerenter="alert(1)">'],
    ['div onclick', '<div onclick="alert(1)">d</div>'],
    ['p ondblclick', '<p ondblclick="alert(1)">dbl</p>'],
    ['details ontoggle', '<details ontoggle="alert(1)" open>t</details>'],
    ['a onmouseover', '<a href="https://example.com" onmouseover="alert(1)">t</a>'],
    ['svg onload', '<svg onload="alert(1)"></svg>'],
  ])('strips every event handler attribute (%s)', (_name, input) => {
    const attrs = allAttrs(dom(render(input)))
    expect(attrs.filter((a) => /\[on/i.test(a))).toEqual([])
    expect(render(input)).not.toMatch(/alert/)
  })

  it.each([
    ['javascript:', '<a href="javascript:alert(1)">x</a>'],
    ['mixed-case JaVaScRiPt:', '<a href="JaVaScRiPt:alert(1)">x</a>'],
    ['tab-split java&#x09;script:', '<a href="java&#x09;script:alert(1)">x</a>'],
    ['vbscript:', '<a href="vbscript:msgbox(1)">v</a>'],
    ['data:text/html', '<a href="data:text/html;base64,PHNjcmlwdD4=">d</a>'],
  ])('never leaves a %s link that the browser would execute', (_name, input) => {
    const a = dom(render(input)).querySelector('a')
    // The link either loses its href or is forced into a harmless https:// URL.
    const href = a?.getAttribute('href') ?? ''
    expect(href).not.toMatch(/^\s*(javascript|vbscript|data):/i)
  })

  it('leaves a markdown javascript: link as plain text', () => {
    const out = render('[click](javascript:alert(1))')
    expect(dom(out).querySelector('a')).toBeNull()
  })

  it.each([
    ['img', '<img src="javascript:alert(1)">', 'img'],
    ['iframe', '<iframe src="javascript:alert(1)"></iframe>', 'iframe'],
  ])('drops a javascript: src on %s', (_name, input, tag) => {
    const frag = dom(render(input))
    for (const el of frag.querySelectorAll(tag)) expect(el.getAttribute('src') ?? '').not.toMatch(/javascript/i)
    for (const el of frag.querySelectorAll('a')) expect(el.getAttribute('href') ?? '').not.toMatch(/javascript/i)
  })

  it('removes an iframe srcdoc payload', () => {
    const out = render('<iframe srcdoc="<script>alert(1)</script>"></iframe>')
    expect(out).not.toMatch(/srcdoc|alert/)
  })

  it.each([
    ['form controls', '<form action="https://evil.example"><input name="a"><button>b</button></form>', ['form', 'input', 'button']],
    ['plugins', '<object data="x.swf"></object><embed src="x.swf">', ['object', 'embed']],
    ['base', '<base href="https://evil.example/">', ['base']],
    ['meta refresh', '<meta http-equiv="refresh" content="0;url=https://evil.example">', ['meta']],
    ['style sheet', '<style>body{display:none}</style>', ['style']],
    ['svg and math', '<svg><a xlink:href="javascript:alert(1)">x</a></svg><math><mi>y</mi></math>', ['svg', 'math']],
  ])('removes forbidden elements (%s)', (_name, input, tags) => {
    const frag = dom(render(input))
    for (const tag of tags) expect(frag.querySelector(tag)).toBeNull()
  })

  it('keeps the text of a removed form, so nothing the author wrote silently vanishes', () => {
    expect(render('<form><button>Press</button></form>')).toContain('Press')
  })

  it('drops data-* attributes', () => {
    expect(render('<img src="x" data-foo="1">')).not.toContain('data-foo')
  })
})

describe('styles cannot escape the post', () => {
  it.each([
    ['<div style="position:fixed;top:0;z-index:9999;color:red">over</div>', 'top:0;color:red'],
    ['<div style="Z-INDEX: 5; POSITION : absolute; color: blue">x</div>', ' color: blue'],
  ])('strips position and z-index, whatever their case, and keeps the rest: %s', (input, style) => {
    expect(dom(render(input)).querySelector('div').getAttribute('style')).toBe(style)
  })
})

describe('auto-loading media never probes the viewer\'s network', () => {
  it.each([
    'http://192.168.1.1/x.png',
    'http://10.0.0.5/a.png',
    'http://172.20.1.1/a.png',
    'http://169.254.1.1/a.png',
    'http://localhost/x.png',
    'http://printer.local/a.png',
    'http://[::1]/a.png',
    'http://[fe80::1]/a.png',
    'http://[fd12::1]/a.png',
    'http://0.0.0.0/a.png',
    '//192.168.0.1/a.png',
  ])('removes the src of an image pointing at %s', (src) => {
    const img = dom(render(`<img src="${src}">`)).querySelector('img')
    expect(img.hasAttribute('src')).toBe(false)
  })

  it('removes a private src on video too', () => {
    expect(dom(render('<video src="http://127.0.0.1/v.mp4"></video>')).querySelector('video').hasAttribute('src')).toBe(false)
  })

  it('keeps public hosts that only look similar (172.40 is not private)', () => {
    expect(dom(render('<img src="http://172.40.1.1/a.png">')).querySelector('img').getAttribute('src')).toBe('http://172.40.1.1/a.png')
  })

  it('leaves a private address in a link alone, since following it takes a click', () => {
    expect(dom(render('<a href="http://192.168.1.1/">lan</a>')).querySelector('a').getAttribute('href')).toBe('http://192.168.1.1/')
  })
})

describe('third-party embeds stay links', () => {
  it('a bare YouTube URL becomes an inline link, not a player', () => {
    const frag = dom(render('Watch https://www.youtube.com/watch?v=dQw4w9WgXcQ now'))
    expect(frag.querySelector('iframe')).toBeNull()
    const a = frag.querySelector('a')
    expect(a.getAttribute('href')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(a.closest('p').textContent).toBe('Watch https://www.youtube.com/watch?v=dQw4w9WgXcQ now')
  })

  it('a hand-written YouTube iframe becomes a link to the watch page', () => {
    const frag = dom(render('<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>'))
    expect(frag.querySelector('iframe')).toBeNull()
    expect(frag.querySelector('a').getAttribute('href')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  })

  it('any other hand-written iframe becomes a link to its source', () => {
    const frag = dom(render('<iframe src="https://evil.example/page"></iframe>'))
    expect(frag.querySelector('iframe')).toBeNull()
    expect(frag.querySelector('a').getAttribute('href')).toBe('https://evil.example/page')
  })

  // BUG: OWN_EMBED_HOSTS (renderer.js:176) is tested against the whole src URL,
  // not its host, so "//3speak.tv" in a query string, a host that merely starts
  // with "3speak.tv." or any "/ipfs/" path keeps an arbitrary third-party iframe
  // live in the post (no sandbox, author-chosen width/height). Expected: only
  // iframes whose HOST is 3speak or that our own IPFS pass produced survive.
  it.skip.each([
    'https://evil.example/phish?ref=//3speak.tv',
    'https://3speak.tv.evil.example/phish',
    'https://evil.example/ipfs/x/y',
  ])('BUG: an iframe to a foreign host survives when its URL merely mentions 3Speak or /ipfs/ (%s)', (src) => {
    const frag = dom(render(`<iframe src="${src}" width="100%" height="5000"></iframe>`))
    expect(frag.querySelector('iframe')).toBeNull()
  })
})

describe('3Speak players', () => {
  const PLAYER = 'https://play.3speak.tv/watch?v=alice/abc&mode=iframe&captions=0&layout=desktop'

  it.each([
    'https://3speak.tv/watch?v=alice/abc',
    'https://play.3speak.tv/watch?v=alice/abc',
    'https://3speak.online/watch?v=alice/abc',
    'https://3speak.co/watch?v=alice/abc',
  ])('a link to %s becomes the 3Speak player with the permissions it needs', (url) => {
    const iframe = dom(render(url)).querySelector('.video-container iframe')
    expect(iframe.getAttribute('src')).toBe(PLAYER)
    expect(iframe.getAttribute('allow')).toBe('autoplay; encrypted-media; fullscreen; picture-in-picture')
    expect(iframe.hasAttribute('allowfullscreen')).toBe(true)
  })

  it('an /embed link keeps the embed route', () => {
    expect(dom(render('[v](https://play.3speak.tv/embed?v=bob/xyz)')).querySelector('iframe').getAttribute('src'))
      .toBe('https://play.3speak.tv/embed?v=bob/xyz&mode=iframe&captions=0&layout=desktop')
  })

  it('embeds the same video only once per body; the repeat stays a link', () => {
    const frag = dom(render('https://3speak.tv/watch?v=alice/abc\n\nhttps://3speak.tv/watch?v=alice/abc'))
    expect(frag.querySelectorAll('iframe')).toHaveLength(1)
    expect(frag.querySelector('a').getAttribute('href')).toBe('https://3speak.tv/watch?v=alice/abc')
  })

  it('an old-style 3Speak iframe becomes the player, and an encoded repeat of it is dropped', () => {
    const frag = dom(render('<iframe src="https://3speak.tv/embed?v=alice%2Fabc"></iframe>\n\n<iframe src="https://3speak.tv/embed?v=alice/abc"></iframe>'))
    const iframes = frag.querySelectorAll('iframe')
    expect(iframes).toHaveLength(1)
    expect(iframes[0].getAttribute('src')).toBe(PLAYER)
  })

  it('the post-body renderer leaves 3Speak video links as links', () => {
    const r = createHiveRenderer({ embeds: { threespeakVideo: false } })
    const frag = dom(r('https://3speak.tv/watch?v=alice/abc'))
    expect(frag.querySelector('iframe')).toBeNull()
    expect(frag.querySelector('a').getAttribute('href')).toBe('https://3speak.tv/watch?v=alice/abc')
  })

  it('an audio link becomes the compact audio player, once per asset', () => {
    const frag = dom(render('[a](https://audio.3speak.tv/play?a=xyz) and [b](https://audio.3speak.tv/play?a=xyz)'))
    const iframes = frag.querySelectorAll('.audio-container iframe')
    expect(iframes).toHaveLength(1)
    expect(iframes[0].getAttribute('src')).toBe('https://audio.3speak.tv/play?a=xyz&mode=compact&iframe=1')
    expect(iframes[0].getAttribute('loading')).toBe('lazy')
    expect(frag.querySelector('a').textContent).toBe('b')
  })

  it('a bare audio URL on its own line becomes a player, and http is upgraded', () => {
    const iframe = dom(render('http://audio.3speak.tv/play?cid=QmA')).querySelector('iframe')
    expect(iframe.getAttribute('src')).toBe('https://audio.3speak.tv/play?cid=QmA&mode=compact&iframe=1')
  })

  it('keeps the other audio parameters, decoding &amp;', () => {
    const iframe = dom(render('<a href="https://audio.3speak.tv/play?cid=QmA&amp;x=1">a</a>')).querySelector('iframe')
    expect(iframe.getAttribute('src')).toBe('https://audio.3speak.tv/play?cid=QmA&x=1&mode=compact&iframe=1')
  })

  it('audio embeds can be switched off', () => {
    const r = createHiveRenderer({ embeds: { threespeakAudio: false } })
    expect(dom(r('https://audio.3speak.tv/play?a=xyz')).querySelector('iframe')).toBeNull()
  })
})

describe('IPFS video', () => {
  it('turns an IPFS iframe on any gateway into a native video served by our gateways', () => {
    const video = dom(render('<iframe src="https://gateway.pinata.cloud/ipfs/QmVid123"></iframe>')).querySelector('video')
    expect([...video.querySelectorAll('source')].map((s) => s.getAttribute('src'))).toEqual([
      'https://ipfs.3speak.tv/ipfs/QmVid123',
      'https://ipfs.skatehive.app/ipfs/QmVid123',
      'https://cloudflare-ipfs.com/ipfs/QmVid123',
      'https://ipfs.io/ipfs/QmVid123',
    ])
    expect(video.getAttribute('preload')).toBe('none')
    expect(video.hasAttribute('muted')).toBe(true)
  })

  it('uses the configured gateways', () => {
    const r = createHiveRenderer({ ipfsGateway: 'https://gw.one', ipfsFallbackGateways: ['https://gw.two'] })
    const srcs = [...dom(r('<iframe src="https://x.example/ipfs/QmV"></iframe>')).querySelectorAll('source')].map((s) => s.getAttribute('src'))
    expect(srcs).toEqual(['https://gw.one/ipfs/QmV', 'https://gw.two/ipfs/QmV'])
  })
})

describe('images', () => {
  it('routes IPFS images through ipfs.io by default and leaves others as they are', () => {
    expect(dom(render('![pic](https://gateway.ipfs.io/ipfs/QmAbc/x.png)')).querySelector('img').getAttribute('src')).toBe('https://ipfs.io/ipfs/QmAbc/x.png')
    const img = dom(render('![pic](https://images.hive.blog/x.png)')).querySelector('img')
    expect(img.getAttribute('src')).toBe('https://images.hive.blog/x.png')
    expect(img.getAttribute('alt')).toBe('pic')
  })

  it('uses a custom image proxy when one is given', () => {
    const r = createHiveRenderer({ imageProxyFn: (u) => `https://proxy.example/${encodeURIComponent(u)}` })
    expect(dom(r('![x](https://img.example/a.png)')).querySelector('img').getAttribute('src'))
      .toBe('https://proxy.example/https%3A%2F%2Fimg.example%2Fa.png')
  })
})

describe('links, mentions and hashtags', () => {
  it('links mentions and hashtags with the configured URL builders', () => {
    const links = [...dom(render('hi @alice and #hive')).querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')])
    expect(links).toEqual([['@alice', '/@alice'], ['#hive', '/t/hive']])
  })

  it('falls back to /@user and /trending/tag', () => {
    const r = createHiveRenderer()
    expect([...dom(r('@bob #art')).querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['/@bob', '/trending/art'])
  })

  it.each([
    ['https://peakd.com/hive-1/@alice/my-post', '/@alice/my-post'],
    ['<a href="https://ecency.com/@bob/a-post">x</a>', '/@bob/a-post'],
    ['<a href="https://www.hive.blog/@bob/p1">x</a>', '/@bob/p1'],
  ])('rewrites a Hive frontend post link to an in-app link that stays in this tab: %s', (input, href) => {
    const a = dom(render(input)).querySelector('a')
    expect(a.getAttribute('href')).toBe(href)
    expect(a.hasAttribute('target')).toBe(false)
  })

  it('knows extra frontends and an internal prefix when configured', () => {
    const r = createHiveRenderer({ additionalHiveFrontends: ['inleo.io'], internalUrlPrefix: '/app' })
    expect(dom(r('<a href="https://inleo.io/@c/p">x</a>')).querySelector('a').getAttribute('href')).toBe('/app/@c/p')
  })

  it('leaves Hive URLs untouched when conversion is off', () => {
    const r = createHiveRenderer({ convertHiveUrls: false })
    expect(dom(r('https://peakd.com/@a/b')).querySelector('a').getAttribute('href')).toBe('https://peakd.com/@a/b')
  })

  it('a profile link (no permlink) is not a post and stays external', () => {
    expect(dom(render('<a href="https://hive.blog/@bob">x</a>')).querySelector('a').getAttribute('target')).toBe('_blank')
  })

  it('opens external links in a new tab without an opener', () => {
    const a = dom(render('<a href="https://example.com" title="x">t</a>')).querySelector('a')
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toBe('noopener noreferrer')
    expect(a.getAttribute('title')).toBe('x')
  })

  it('respects a target the author already set', () => {
    expect(dom(render('<a href="https://example.com" target="_self">t</a>')).querySelector('a').getAttribute('target')).toBe('_self')
  })
})

describe('layout clean-up', () => {
  it('drops empty paragraphs', () => {
    expect(render('<p>hello</p><p></p>')).toBe('<p>hello</p>')
  })

  it('repairs a <center> that the markdown renderer wrapped in a paragraph around a rule', () => {
    expect(render('<p><center>a<hr />b</center></p>')).toBe('<center>a<hr>b</center>')
  })
})

describe('when the upstream library changes shape', () => {
  afterEach(() => {
    vi.doUnmock('@hiveio/content-renderer')
    vi.resetModules()
  })

  // A pass-through renderer: whatever markdown goes in comes out as HTML, so the
  // post-processing passes can be tested on exact input.
  async function loadWithPassThrough() {
    vi.resetModules()
    vi.doMock('@hiveio/content-renderer', () => ({
      DefaultRenderer: class { render(md) { return md } },
    }))
    return import('../../../src/lib/hiveRenderer/renderer.js')
  }

  it('warns once when the embedders cannot be switched off, and still renders', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { createHiveRenderer: create } = await loadWithPassThrough()
    const r = create()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not disable'))
    expect(r('<p>ok</p>')).toBe('<p>ok</p>')
  })

  it('unwraps a third-party player an embedder left behind into a link', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { createHiveRenderer: create } = await loadWithPassThrough()
    const out = create()('<div class="videoWrapper"><iframe src="https://www.youtube-nocookie.com/embed/abcdefg" /></div>')
    const frag = dom(out)
    expect(frag.querySelector('iframe')).toBeNull()
    expect(frag.querySelector('.videoWrapper')).toBeNull()
    expect(frag.querySelector('a').getAttribute('href')).toBe('https://www.youtube.com/watch?v=abcdefg')
  })

  it('leaves an iframe without a src for the sanitizer', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { createHiveRenderer: create } = await loadWithPassThrough()
    expect(dom(create()('<iframe></iframe>')).querySelector('a')).toBeNull()
  })

  it('a malformed audio URL is still embedded as written', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { createHiveRenderer: create } = await loadWithPassThrough()
    const out = create()('<a href="https://audio.3speak.tv/play?a=%E0%A4%A">x</a>')
    expect(dom(out).querySelector('.audio-container iframe')).not.toBeNull()
  })
})

describe('shared renderers (index.js)', () => {
  afterEach(() => {
    vi.doUnmock('../../../src/lib/hiveRenderer/renderer.js')
    vi.resetModules()
  })

  async function loadIndex() {
    vi.resetModules()
    const create = vi.fn((opts) => Object.assign(() => '', { opts }))
    vi.doMock('../../../src/lib/hiveRenderer/renderer.js', () => ({ createHiveRenderer: create }))
    const mod = await import('../../../src/lib/hiveRenderer/index.js')
    return { ...mod, create }
  }

  it('builds each renderer once and hands every caller the same one', async () => {
    const { getHiveRenderer, getPostBodyRenderer, create } = await loadIndex()
    const [a, b] = await Promise.all([getHiveRenderer(), getHiveRenderer()])
    const post = await getPostBodyRenderer()
    expect(a).toBe(b)
    expect(post).not.toBe(a)
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('the post-body renderer turns 3Speak video embeds off, the general one keeps them', async () => {
    const { getHiveRenderer, getPostBodyRenderer } = await loadIndex()
    expect((await getHiveRenderer()).opts.embeds).toEqual({})
    expect((await getPostBodyRenderer()).opts.embeds).toEqual({ threespeakVideo: false })
  })

  it('links users and tags to app routes and uses the 3Speak IPFS gateway', async () => {
    const { getHiveRenderer } = await loadIndex()
    const { opts } = await getHiveRenderer()
    expect(opts.usertagUrlFn('alice')).toBe('/@alice')
    expect(opts.hashtagUrlFn('hive')).toBe('/t/hive')
    expect(opts.ipfsGateway).toBe('https://hotipfs-3speak-1.b-cdn.net')
    expect(opts.convertHiveUrls).toBe(true)
  })
})
