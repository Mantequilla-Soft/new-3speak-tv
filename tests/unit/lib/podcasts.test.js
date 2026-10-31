// Outside podcasts ("External" on /audio): how a tip is split between the
// recipients a feed lists, and the OPML files podcast apps exchange.
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { splitSats, hiveAccountOf, tipOptions } from '../../../src/lib/podcastTips.js'
import { parseOpml, buildOpml, episodeToTrack, feedKey, followErrorText } from '../../../src/lib/podcasts.js'

const host = { name: 'Host', type: 'lnaddress', address: 'host@getalby.com', split: 90 }
const cohost = { name: 'Cohost', type: 'node', address: '03' + 'a'.repeat(64), split: 10 }
const app = { name: 'App', type: 'node', address: '02' + 'b'.repeat(64), split: 5, fee: true }

describe('splitSats', () => {
  it('shares by split and never loses a sat', () => {
    const out = splitSats([host, cohost], 1001)
    expect(out.map((r) => r.sats)).toEqual([901, 100])
  })

  it('takes fee recipients off the top as a percentage', () => {
    const out = splitSats([host, cohost, app], 1000)
    const by = Object.fromEntries(out.map((r) => [r.name, r.sats]))
    expect(by.App).toBe(50)
    expect(by.Host + by.Cohost).toBe(950)
    expect(by.Host).toBe(855)
  })

  it('drops shares that round to nothing', () => {
    expect(splitSats([host, cohost], 5).map((r) => r.name)).toEqual(['Host'])
  })
})

describe('value block helpers', () => {
  it('finds the Hive account behind customKey 818818', () => {
    expect(hiveAccountOf({ recipients: [{ ...cohost, customKey: '818818', customValue: 'Someone' }] })).toBe('someone')
    expect(hiveAccountOf({ recipients: [host] })).toBeNull()
  })

  it('only a lone Lightning address can be paid by QR', () => {
    expect(tipOptions({ recipients: [host] }).single).toMatchObject({ address: 'host@getalby.com' })
    expect(tipOptions({ recipients: [host, cohost] }).single).toBeNull()
    expect(tipOptions(null).payable).toBe(false)
  })
})

describe('OPML', () => {
  it('round-trips the feeds a user follows', () => {
    const subs = [{ title: 'A & B "show"', url: 'https://feeds.example.com/a.xml?x=1&y=2' }, { title: '', url: 'http://b.example/rss' }]
    const parsed = parseOpml(buildOpml(subs, 'alice'))
    expect(parsed).toEqual([
      { url: 'https://feeds.example.com/a.xml?x=1&y=2', title: 'A & B "show"' },
      { url: 'http://b.example/rss', title: 'http://b.example/rss' },
    ])
  })

  it('reads nested outlines, skips duplicates and non-feeds', () => {
    const opml = `<?xml version="1.0"?><opml version="1.0"><body><outline text="Group">
      <outline text="One" xmlUrl="https://one.example/feed"/>
      <outline text="One again" xmlUrl="https://one.example/feed"/>
      <outline text="Not a feed" htmlUrl="https://two.example"/>
    </outline></body></opml>`
    expect(parseOpml(opml)).toEqual([{ url: 'https://one.example/feed', title: 'One' }])
  })

  it('refuses something that is not XML', () => {
    expect(() => parseOpml('<<<nope')).toThrow()
  })
})

describe('episodeToTrack', () => {
  it('builds an external track that never carries a 3Speak permlink', () => {
    const track = episodeToTrack(
      { id: 'f:1', feed_id: 'f', title: 'Ep', audio_url: 'https://cdn/x.mp3', duration: 60 },
      { title: 'Show', image: 'https://cdn/c.jpg', value: { recipients: [host] }, url: 'https://feed' },
    )
    expect(track).toMatchObject({ external: true, src: 'https://cdn/x.mp3', show: 'Show', thumbnail_url: 'https://cdn/c.jpg', duration: 60 })
    expect(track.permlink).toBeUndefined()
    expect(track.post_permlink).toBeUndefined()
  })
})

describe('sanitizeShowNotes', async () => {
  const { sanitizeShowNotes } = await import('../../../src/lib/podcastFormat.js')
  it('keeps text, lists and links, drops scripts, images, handlers and odd URLs', () => {
    const out = sanitizeShowNotes(
      '<p onclick="x()">Hi <b>there</b><script>alert(1)</script></p><img src="https://t/p.gif">'
      + '<ul><li><a href="https://ok.example/x" style="color:red">ok</a></li><li><a href="javascript:alert(1)">bad</a></li></ul>'
      + '<iframe src="https://evil"></iframe>',
    )
    expect(out).not.toMatch(/script|onclick|<img|iframe|javascript:|style=/)
    expect(out).toContain('<b>there</b>')
    expect(out).toContain('href="https://ok.example/x"')
    expect(out).toContain('target="_blank"')
    expect(out).toContain('rel="noopener noreferrer nofollow ugc"')
  })
  it('turns plain addresses into links, leaving existing links and punctuation alone', () => {
    const out = sanitizeShowNotes('Eva auf Instagram: https://www.instagram.com/evaschulz/.\nMehr: www.ardkultur.de (Portal) und <a href="https://x.example">https://x.example</a>')
    expect(out).toContain('<a href="https://www.instagram.com/evaschulz/" target="_blank" rel="noopener noreferrer nofollow ugc">https://www.instagram.com/evaschulz/</a>.')
    expect(out).toContain('<a href="https://www.ardkultur.de" target="_blank" rel="noopener noreferrer nofollow ugc">www.ardkultur.de</a> (Portal)')
    expect(out.match(/<a /g)).toHaveLength(3)
  })
  it('keeps a bracketed URL whole', () => {
    expect(sanitizeShowNotes('See https://en.wikipedia.org/wiki/Foo_(bar) now')).toContain('href="https://en.wikipedia.org/wiki/Foo_(bar)"')
  })
  it('turns plain-text notes into lines, escaped', () => {
    expect(sanitizeShowNotes('Line one\nLine <two>')).toBe('Line one<br>Line &lt;two&gt;')
    expect(sanitizeShowNotes('Eva &amp; Ralph')).toBe('Eva &amp; Ralph')
    expect(sanitizeShowNotes('')).toBe('')
  })
})

describe('audioPlayQueued', async () => {
  const { createAudioPlayerSlice } = await import('../../../src/lib/slices/createAudioPlayerSlice.js')
  const makeStore = () => {
    sessionStorage.clear()
    localStorage.clear()
    let state
    const set = (p) => { state = { ...state, ...(typeof p === 'function' ? p(state) : p) } }
    const get = () => state
    state = createAudioPlayerSlice(set, get)
    return get
  }
  const a = { _id: 'a' }, b = { _id: 'b' }, c = { _id: 'c' }

  it('keeps what was playing in the queue and plays the new one right after it', () => {
    const get = makeStore()
    get().audioPlay(a)
    get().audioPlayQueued(b)
    expect(get().audioCurrent._id).toBe('b')
    expect(get().audioQueue.map((i) => i._id)).toEqual(['a', 'b'])
    get().audioAddToQueue(c)
    get().audioPlay(get().audioQueue[0])            // back to a
    get().audioPlayQueued(c)                         // c moves up, right after a
    expect(get().audioQueue.map((i) => i._id)).toEqual(['a', 'c', 'b'])
    expect(get().audioCurrent._id).toBe('c')
  })

  it('with nothing playing, simply queues and plays', () => {
    const get = makeStore()
    get().audioPlayQueued(a)
    expect(get().audioQueue.map((i) => i._id)).toEqual(['a'])
    expect(get().audioCurrent._id).toBe('a')
  })
})

describe('feedKey (is a directory result a show you follow?)', () => {
  it('ignores the scheme, www. and a trailing slash, as the checker does', () => {
    expect(feedKey('http://www.Example.com/feed/')).toBe('example.com/feed')
    expect(feedKey('https://example.com/feed')).toBe('example.com/feed')
    expect(feedKey('https://example.com:8443/feed?x=1')).toBe('example.com:8443/feed?x=1')
  })

  it('keeps anything that is not a URL as it is', () => {
    expect(feedKey('not a url')).toBe('not a url')
  })
})

describe('followErrorText', () => {
  it('names the app that keeps its feeds to itself', () => {
    expect(followErrorText('closed_platform', { platform: 'Spotify' })).toContain('Spotify')
  })

  it('has a message for every directory answer', () => {
    for (const code of ['apple_only', 'directory_not_found', 'directory_down']) {
      expect(followErrorText(code)).not.toBe(followErrorText('something_else'))
    }
  })
})
