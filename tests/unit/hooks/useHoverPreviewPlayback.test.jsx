// Card hover previews beyond the fade-out (src/hooks/useHoverPreview.jsx; the
// fade is in useHoverPreview.test.jsx): every displayed card warms its lowest-
// bitrate stream and cancels that when it scrolls away, a dead manifest is
// reported, hovering for half a second plays the clip in the one shared player,
// the scrub bar seeks it, overlay controls can hold it open, and on a phone in
// large-card mode the card at the centre of the screen plays by itself.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import React, { useEffect } from 'react'
import { render, act, fireEvent } from '@testing-library/react'

const player = vi.hoisted(() => ({ load: null, play: null, pause: null, destroy: null, destroyed: false }))
const api = vi.hoisted(() => ({ fetchSource: null }))
vi.mock('@mantequilla-soft/3speak-player', () => ({ ThreeSpeakApi: class { fetchSource(...a) { return api.fetchSource(...a) } } }))
vi.mock('../../../src/utils/playerUrl', () => ({ getPlayerUrl: () => 'https://play.test' }))
vi.mock('../../../src/lib/lowResPreviewPlayer', () => ({ createLowResPreviewPlayer: () => player }))
const dead = vi.hoisted(() => ({ report: vi.fn() }))
vi.mock('../../../src/lib/reportUnavailable', () => ({ reportVideoUnavailable: (...a) => dead.report(...a) }))
const settings = vi.hoisted(() => ({ previewEnabled: true, cardSize: 'small' }))
vi.mock('../../../src/lib/store', () => ({ useAppStore: (sel) => sel({ previewEnabled: settings.previewEnabled }) }))
vi.mock('../../../src/hooks/useCardSize', () => ({ default: () => settings.cardSize }))
const subs = vi.hoisted(() => ({ prefetch: vi.fn(), cues: [] }))
vi.mock('../../../src/hooks/useSubtitles', () => ({ default: () => ({ cues: subs.cues, subtitleStyle: {} }), prefetchSubtitles: (...a) => subs.prefetch(...a) }))
vi.mock('../../../src/components/SubtitleOverlay/SubtitleOverlay', () => ({ default: ({ cues }) => <div className="subs">{cues.length}</div> }))

let observers
class FakeIO {
  constructor(cb, opts) { this.cb = cb; this.opts = opts; this.disconnect = vi.fn(); observers.push(this) }
  observe() {}
  show(el, isIntersecting = true) { this.cb([{ target: el, isIntersecting }]) }
}
let fetchMock
let useHoverPreview
let preview

const CARDS = [
  { key: 'badadib/a', author: 'badadib', permlink: 'a', status: 'published' },
  { key: 'badadib/b', author: 'badadib', permlink: 'b', status: 'published' },
  { key: 'badadib/enc', author: 'badadib', permlink: 'enc', status: 'encoding' },
]

function Grid({ controls }) {
  const hook = useHoverPreview({ renderControls: controls })
  // Handed to the tests after each render (not during it, which React forbids).
  useEffect(() => { preview = hook })
  const view = hook
  return (
    <div data-testid="grid" {...view.containerProps}>
      {CARDS.map((c) => (
        <div key={c.key} data-testid={c.key} className="card" {...view.getCardProps(c.key, c.author, c.permlink, `${c.permlink}.jpg`, c.status, `Title ${c.permlink}`)}>
          <div className="img-wrap" />
        </div>
      ))}
      {view.overlay}
    </div>
  )
}

const advance = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
const overlay = (r) => r.container.querySelector('.card-hover-overlay')
const urls = () => fetchMock.mock.calls.map(([u]) => u)
const hover = async (r, key) => { fireEvent.mouseEnter(r.getByTestId(key)); await advance(500) }

function setHoverCapable(can) {
  window.matchMedia = (q) => ({ matches: q.includes('hover: hover') ? can : false, addEventListener() {}, removeEventListener() {} })
}

const MASTER = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=5000000\n1080p/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=800000\n\n480p/index.m3u8\n'

beforeEach(async () => {
  vi.useFakeTimers()
  observers = []
  vi.stubGlobal('IntersectionObserver', FakeIO)
  Object.assign(settings, { previewEnabled: true, cardSize: 'small' })
  subs.cues = []
  subs.prefetch.mockReset()
  dead.report.mockReset()
  Object.assign(player, {
    load: vi.fn(async () => {}), play: vi.fn(async () => {}), pause: vi.fn(), destroy: vi.fn(), destroyed: false,
  })
  api.fetchSource = vi.fn(async (author, permlink) => ({ url: `https://cdn.test/${permlink}/manifest.m3u8` }))
  fetchMock = vi.fn(async (url) => {
    if (url.endsWith('manifest.m3u8')) return { status: 200, text: async () => MASTER }
    if (url.endsWith('index.m3u8')) return { status: 200, text: async () => '#EXTM3U\n#EXTINF:4,\nseg0.ts\n' }
    return { status: 200, text: async () => '' }
  })
  vi.stubGlobal('fetch', fetchMock)
  setHoverCapable(true)
  vi.resetModules()
  useHoverPreview = (await import('../../../src/hooks/useHoverPreview.jsx')).default
})
afterEach(() => vi.useRealTimers())

describe('which cards preview', () => {
  it('playable cards get the hover props; encoding, scheduled and draft ones get none', () => {
    const r = render(<Grid />)
    expect(r.getByTestId('badadib/a').dataset).toMatchObject({ postkey: 'badadib/a', author: 'badadib', permlink: 'a', thumb: 'a.jpg' })
    expect(r.getByTestId('badadib/enc').dataset.postkey).toBeUndefined()
  })

  it('with previews turned off there is no overlay and no card props', () => {
    settings.previewEnabled = false
    const r = render(<Grid />)
    expect(overlay(r)).toBeNull()
    expect(r.getByTestId('badadib/a').dataset.postkey).toBeUndefined()
  })

  it('a phone in small-card mode does not preview', () => {
    setHoverCapable(false)
    const r = render(<Grid />)
    expect(overlay(r)).toBeNull()
    expect(preview.canHover).toBe(false)
  })
})

describe('warming displayed cards', () => {
  it('fetches the source and warms the LOWEST-bitrate variant and its first segment', async () => {
    const r = render(<Grid />)
    expect(observers[0].opts).toEqual({ rootMargin: '300px 0px' })
    observers[0].show(r.getByTestId('badadib/a'))
    await advance(0)
    expect(api.fetchSource).toHaveBeenCalledWith('badadib', 'a')
    expect(urls()).toEqual([
      'https://cdn.test/a/manifest.m3u8',
      'https://cdn.test/a/480p/index.m3u8',
      'https://cdn.test/a/480p/seg0.ts',
    ])
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ mode: 'cors', credentials: 'omit' })
  })

  it('a media playlist (no variants) warms its first segment directly', async () => {
    fetchMock.mockImplementation(async (url) => (url.endsWith('manifest.m3u8')
      ? { status: 200, text: async () => '#EXTM3U\n#EXTINF:4,\nhttps://other.test/s0.ts\n' } : { status: 200, text: async () => '' }))
    const r = render(<Grid />)
    observers[0].show(r.getByTestId('badadib/a'))
    await advance(0)
    expect(urls()).toEqual(['https://cdn.test/a/manifest.m3u8', 'https://other.test/s0.ts'])
  })

  it.each([404, 410])('a manifest answering %i is reported as unavailable', async (status) => {
    fetchMock.mockResolvedValue({ status, text: async () => 'gone' })
    const r = render(<Grid />)
    observers[0].show(r.getByTestId('badadib/a'))
    await advance(0)
    expect(dead.report).toHaveBeenCalledWith('badadib', 'a', 'https://cdn.test/a/manifest.m3u8')
  })

  // The lookup starts a tick after the card shows: it waits for the Spotlight
  // hero's video first (lib/heroPriority.js; nothing held here, so one tick).
  it('a card scrolling away before its lookup starts looks nothing up', async () => {
    const r = render(<Grid />)
    const card = r.getByTestId('badadib/a')
    observers[0].show(card)
    observers[0].show(card, false)
    await advance(0)
    expect(api.fetchSource).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    // Coming back starts again.
    observers[0].show(card)
    await advance(0)
    expect(api.fetchSource).toHaveBeenCalledTimes(1)
  })

  it('a card scrolling away mid-lookup cancels its download, and nothing is reported', async () => {
    let resolveSource
    api.fetchSource.mockImplementationOnce(() => new Promise((res) => { resolveSource = res }))
    const r = render(<Grid />)
    const card = r.getByTestId('badadib/a')
    observers[0].show(card)
    await advance(0)
    expect(api.fetchSource).toHaveBeenCalledTimes(1)
    observers[0].show(card, false)
    resolveSource({ url: 'https://cdn.test/a/manifest.m3u8' })
    await advance(0)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(dead.report).not.toHaveBeenCalled()
    // Coming back starts again.
    observers[0].show(card)
    await advance(0)
    expect(api.fetchSource).toHaveBeenCalledTimes(2)
  })

  it('each card is warmed once', async () => {
    const r = render(<Grid />)
    observers[0].show(r.getByTestId('badadib/a'))
    await advance(0)
    observers[0].show(r.getByTestId('badadib/a'))
    await advance(0)
    expect(api.fetchSource).toHaveBeenCalledTimes(1)
  })

  it('a failed source lookup is ignored', async () => {
    api.fetchSource.mockRejectedValue(new Error('404'))
    const r = render(<Grid />)
    observers[0].show(r.getByTestId('badadib/a'))
    await advance(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('unmounting disconnects the observer, aborts downloads and destroys the player', async () => {
    api.fetchSource.mockImplementation(() => new Promise(() => {}))
    const r = render(<Grid />)
    observers[0].show(r.getByTestId('badadib/b'))
    await hover(r, 'badadib/a')
    r.unmount()
    expect(observers[0].disconnect).toHaveBeenCalled()
    expect(player.destroy).toHaveBeenCalled()
  })
})

describe('hovering a card on desktop', () => {
  it('starts after half a second, over the thumbnail, with the warmed source', async () => {
    const r = render(<Grid />)
    observers[0].show(r.getByTestId('badadib/a'))
    await advance(0)
    fireEvent.mouseEnter(r.getByTestId('badadib/a'))
    expect(subs.prefetch).toHaveBeenCalledWith('badadib', 'a')
    await advance(499)
    expect(overlay(r).classList.contains('active')).toBe(false)
    await advance(1)
    expect(overlay(r).classList.contains('active')).toBe(true)
    expect(player.load).toHaveBeenCalledWith({ url: 'https://cdn.test/a/manifest.m3u8' })
    expect(player.play).toHaveBeenCalled()
    expect(r.container.querySelector('.card-hover-poster').getAttribute('src')).toBe('a.jpg')
  })

  it('without a warmed source the player is given author/permlink', async () => {
    api.fetchSource.mockImplementation(() => new Promise(() => {}))
    const r = render(<Grid />)
    await hover(r, 'badadib/b')
    expect(player.load).toHaveBeenCalledWith('badadib/b')
  })

  it('shows the clip once its first frame is decoded, with captions', async () => {
    subs.cues = [{ start: 0, end: 1, text: 'Hi' }]
    const r = render(<Grid />)
    await hover(r, 'badadib/a')
    expect(overlay(r).classList.contains('ready')).toBe(false)
    act(() => { r.container.querySelector('video').dispatchEvent(new Event('loadeddata')) })
    expect(overlay(r).classList.contains('ready')).toBe(true)
    expect(r.container.querySelector('.subs').textContent).toBe('1')
  })

  it('a player already destroyed does not play', async () => {
    player.destroyed = true
    const r = render(<Grid />)
    await hover(r, 'badadib/a')
    expect(player.load).toHaveBeenCalled()
    expect(player.play).not.toHaveBeenCalled()
  })

  it('moving to another card switches the preview; leaving the grid ends it', async () => {
    const r = render(<Grid />)
    await hover(r, 'badadib/a')
    await hover(r, 'badadib/b')
    expect(player.load).toHaveBeenLastCalledWith({ url: 'https://cdn.test/b/manifest.m3u8' })
    fireEvent.mouseLeave(r.getByTestId('grid'))
    await advance(300)
    expect(player.pause).toHaveBeenCalled()
    expect(overlay(r).classList.contains('active')).toBe(false)
  })

  it('re-entering the same card does not restart it', async () => {
    const r = render(<Grid />)
    await hover(r, 'badadib/a')
    await hover(r, 'badadib/a')
    expect(player.load).toHaveBeenCalledTimes(1)
  })

  it('the scrub bar follows playback and seeks where it is pressed and dragged', async () => {
    const r = render(<Grid />)
    await hover(r, 'badadib/a')
    const video = r.container.querySelector('video')
    Object.defineProperty(video, 'duration', { configurable: true, value: 100 })
    video.currentTime = 25
    act(() => { video.dispatchEvent(new Event('timeupdate')) })
    const fill = r.container.querySelector('.card-hover-bar-fill')
    expect(fill.style.width).toBe('25%')

    const bar = r.container.querySelector('.card-hover-bar')
    bar.getBoundingClientRect = () => ({ left: 0, width: 200 })
    fireEvent.pointerDown(bar, { clientX: 150 })
    expect(video.currentTime).toBe(75)
    act(() => { window.dispatchEvent(new MouseEvent('pointermove', { clientX: 300 })) })
    expect(video.currentTime).toBe(100)
    // While dragging, playback does not move the bar.
    video.currentTime = 10
    act(() => { video.dispatchEvent(new Event('timeupdate')) })
    expect(fill.style.width).toBe('100%')
    act(() => { window.dispatchEvent(new MouseEvent('pointerup')) })
    act(() => { video.dispatchEvent(new Event('timeupdate')) })
    expect(fill.style.width).toBe('10%')
  })

  it('overlay controls get the hovered video and can hold the preview open', async () => {
    let lock
    const controls = vi.fn(({ setLock }) => { lock = setLock; return <button>menu</button> })
    const r = render(<Grid controls={controls} />)
    await hover(r, 'badadib/a')
    expect(controls).toHaveBeenLastCalledWith(expect.objectContaining({ author: 'badadib', permlink: 'a', title: 'Title a' }))
    expect(overlay(r).getAttribute('aria-hidden')).toBeNull()
    act(() => lock(true))
    fireEvent.mouseLeave(r.getByTestId('grid'))
    expect(overlay(r).classList.contains('active')).toBe(true)
    // Releasing the lock ends it, since no mouseleave will follow.
    act(() => lock(false))
    expect(r.queryByText('menu')).toBeNull()
  })

  it('a lock reported false on mount does not end the preview', async () => {
    let lock
    const r = render(<Grid controls={({ setLock }) => { lock = setLock; return <span>c</span> }} />)
    await hover(r, 'badadib/a')
    act(() => lock(false))
    expect(r.getByText('c')).toBeTruthy()
  })

  it('startPreview plays a card at once, without a hover', async () => {
    const r = render(<Grid />)
    act(() => preview.startPreview('badadib/b', 'Swapped'))
    expect(overlay(r).classList.contains('active')).toBe(true)
    // The player kit loads on demand (first preview on the page): no hover
    // delay, just the import resolving.
    await advance(0)
    expect(player.load).toHaveBeenCalledWith('badadib/b')
    expect(subs.prefetch).toHaveBeenCalledWith('badadib', 'b')
    act(() => preview.startPreview('badadib/missing'))
    expect(player.load).toHaveBeenCalledTimes(1)
  })
})

describe('on a phone with large cards', () => {
  let rects
  beforeEach(() => {
    setHoverCapable(false)
    settings.cardSize = 'large'
    rects = { 'badadib/a': { top: 0, bottom: 300, height: 300 }, 'badadib/b': { top: 320, bottom: 620, height: 300 } }
    window.innerHeight = 800
    vi.stubGlobal('requestAnimationFrame', (fn) => setTimeout(fn, 16))
    vi.stubGlobal('cancelAnimationFrame', (id) => clearTimeout(id))
  })

  function mountPhone() {
    const r = render(<Grid />)
    for (const [key, rect] of Object.entries(rects)) {
      const node = r.getByTestId(key)
      node.getBoundingClientRect = () => ({ left: 0, width: 400, ...rect })
      node.querySelector('.img-wrap').getBoundingClientRect = () => ({ left: 0, width: 400, ...rect })
    }
    return r
  }

  it('plays the card straddling the middle of the screen, with no hover and no scrub bar', async () => {
    const r = mountPhone()
    expect(preview.canHover).toBe(false)
    await advance(300)
    expect(player.load).toHaveBeenCalledWith('badadib/b')
    expect(subs.prefetch).toHaveBeenCalledWith('badadib', 'b')
    expect(r.container.querySelector('.card-hover-bar')).toBeNull()
    expect(overlay(r).style.top).toBe('320px')
  })

  it('switches as scrolling brings another card to the middle', async () => {
    const r = mountPhone()
    await advance(300)
    rects['badadib/a'] = { top: 250, bottom: 550, height: 300 }
    rects['badadib/b'] = { top: 570, bottom: 870, height: 300 }
    for (const [key, rect] of Object.entries(rects)) {
      r.getByTestId(key).getBoundingClientRect = () => ({ left: 0, width: 400, ...rect })
      r.getByTestId(key).querySelector('.img-wrap').getBoundingClientRect = () => ({ left: 0, width: 400, ...rect })
    }
    act(() => { window.dispatchEvent(new Event('scroll')) })
    await advance(16)
    expect(player.load).toHaveBeenLastCalledWith('badadib/a')
  })

  it('no card at the middle stops the preview', async () => {
    rects['badadib/b'] = { top: 900, bottom: 1200, height: 300 }
    const r = mountPhone()
    await advance(1800)
    expect(player.load).not.toHaveBeenCalled()
    expect(overlay(r).classList.contains('active')).toBe(false)
  })

  it('stops following the scroll once unmounted', async () => {
    const r = mountPhone()
    r.unmount()
    await advance(2000)
    window.dispatchEvent(new Event('scroll'))
    await advance(20)
    expect(player.load).not.toHaveBeenCalled()
  })
})
