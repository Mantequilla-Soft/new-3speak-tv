// Cheap video previews (src/lib/lowResPreviewPlayer.js): a muted SDK player
// locked to the LOWEST-BITRATE rendition, whatever order the encoder listed
// them in, and for the scrubber an abort when the smallest rung would only
// re-download what playback already streams. The SDK player and hls.js are
// replaced by small fakes.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ players: [], hls: null }))
vi.mock('@mantequilla-soft/3speak-player', () => ({
  Player: class {
    constructor(opts) { this.opts = opts; this.attach = vi.fn(); h.players.push(this) }
    async load(ref) { this.hls = h.hls; return `loaded ${ref}` }
  },
}))
vi.mock('hls.js', () => ({ default: { Events: { MANIFEST_PARSED: 'hlsManifestParsed' } } }))
vi.mock('../../../src/utils/playerUrl', () => ({ getPlayerUrl: () => 'https://play.example' }))

import { createLowResPreviewPlayer } from '../../../src/lib/lowResPreviewPlayer.js'

// A fake hls.js instance: levels are known up front, or arrive with MANIFEST_PARSED.
function fakeHls(levels) {
  const handlers = {}
  return {
    levels,
    autoLevelCapping: -1,
    currentLevel: -1,
    stopLoad: vi.fn(),
    once: vi.fn((ev, fn) => { handlers[ev] = fn }),
    parse(next) { this.levels = next; handlers.hlsManifestParsed() },
  }
}

const LEGACY = [{ height: 240, bitrate: 300e3 }, { height: 480, bitrate: 900e3 }, { height: 720, bitrate: 2e6 }]
const EMBED = [{ height: 1080, bitrate: 5e6 }, { height: 720, bitrate: 2.5e6 }, { height: 360, bitrate: 600e3 }]

beforeEach(() => {
  h.players.length = 0
  h.hls = null
})

describe('player setup', () => {
  it('builds a muted, poster-less player with a small buffer and a low starting estimate', () => {
    const el = {}
    const player = createLowResPreviewPlayer(el, { loop: true })
    expect(player.opts).toMatchObject({
      apiBase: 'https://play.example', muted: true, loop: true, poster: false, debug: false,
      hlsConfig: { maxBufferLength: 10, backBufferLength: 10, abrEwmaDefaultEstimate: 200000, startFragPrefetch: true },
    })
    expect(player.attach).toHaveBeenCalledWith(el)
  })

  it('does not loop by default, and still returns what load returned', async () => {
    const player = createLowResPreviewPlayer({})
    expect(player.opts.loop).toBe(false)
    expect(await player.load('alice/v1')).toBe('loaded alice/v1')
  })
})

describe('locking to the lowest rendition', () => {
  it.each([
    ['the legacy encoder (smallest first)', LEGACY, 0],
    ['the embed encoder (largest first)', EMBED, 2],
    ['a ladder with a missing bitrate', [{ height: 720 }, { height: 240, bitrate: 1 }], 1],
  ])('picks by bitrate for %s', async (_name, levels, lowest) => {
    h.hls = fakeHls(levels)
    await createLowResPreviewPlayer({}).load('v')
    expect(h.hls.currentLevel).toBe(lowest)
    expect(h.hls.autoLevelCapping).toBe(lowest)
  })

  it('waits for the manifest when the levels are not known yet', async () => {
    h.hls = fakeHls([])
    await createLowResPreviewPlayer({}).load('v')
    expect(h.hls.once).toHaveBeenCalledWith('hlsManifestParsed', expect.any(Function))
    h.hls.parse(EMBED)
    expect(h.hls.currentLevel).toBe(2)
  })

  it('leaves a single rendition alone, and a manifest with no levels', async () => {
    h.hls = fakeHls([{ height: 360, bitrate: 1 }])
    await createLowResPreviewPlayer({}).load('v')
    expect(h.hls.currentLevel).toBe(-1)

    h.hls = fakeHls(null)
    await createLowResPreviewPlayer({}).load('v')
    h.hls.parse([])
    expect(h.hls.currentLevel).toBe(-1)
  })

  it('does nothing when the player plays natively without hls.js', async () => {
    const player = createLowResPreviewPlayer({})
    await expect(player.load('v')).resolves.toBe('loaded v')
  })
})

describe('the scrubber preview never duplicates playback', () => {
  const scrubber = (extra) => {
    const onNoPreviewRung = vi.fn()
    const player = createLowResPreviewPlayer({}, { requirePreviewRung: true, onNoPreviewRung, ...extra })
    return { player, onNoPreviewRung }
  }

  it.each([
    ['the smallest rung is the one playing', LEGACY, 240, true],
    ['the smallest rung is above the one playing', EMBED, 240, true],
    ['the smallest rung is below the one playing', LEGACY, 720, false],
  ])('with a known playback height: %s', async (_name, levels, playH, aborted) => {
    h.hls = fakeHls(levels)
    const { player, onNoPreviewRung } = scrubber({ getPlaybackHeight: () => playH })
    await player.load('v')
    expect(h.hls.stopLoad).toHaveBeenCalledTimes(aborted ? 1 : 0)
    expect(onNoPreviewRung).toHaveBeenCalledTimes(aborted ? 1 : 0)
  })

  it.each([
    ['a 360p rung is cheap', [{ height: 360, bitrate: 600e3 }, { height: 720, bitrate: 2e6 }], false],
    ['a 480p rung is not', [{ height: 480, bitrate: 900e3 }, { height: 720, bitrate: 2e6 }], true],
    ['no heights, a low bitrate is cheap', [{ bitrate: 400e3 }, { bitrate: 2e6 }], false],
    ['no heights, a high bitrate is not', [{ bitrate: 800e3 }, { bitrate: 2e6 }], true],
  ])('with an unknown playback height: %s', async (_name, levels, aborted) => {
    h.hls = fakeHls(levels)
    const { player, onNoPreviewRung } = scrubber({ getPlaybackHeight: () => 0 })
    await player.load('v')
    expect(onNoPreviewRung).toHaveBeenCalledTimes(aborted ? 1 : 0)
  })

  it('aborts quietly even if stopLoad throws or no callback was given', async () => {
    h.hls = fakeHls([{ height: 720, bitrate: 2e6 }, { height: 1080, bitrate: 5e6 }])
    h.hls.stopLoad.mockImplementation(() => { throw new Error('destroyed') })
    const player = createLowResPreviewPlayer({}, { requirePreviewRung: true })
    await expect(player.load('v')).resolves.toBe('loaded v')
    expect(h.hls.currentLevel).toBe(-1)
  })
})
