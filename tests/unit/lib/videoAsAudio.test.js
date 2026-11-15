// "Play as audio" (src/lib/videoAsAudio.js) and the HLS playlist reading it
// shares with the video downloads (src/lib/hlsRenditions.js).
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  parseMaster, lowestRendition, renditionUpTo, parseMedia, buildMediaPlaylist, resolveRef,
} from '../../../src/lib/hlsRenditions.js'
import {
  videoAudioTrack, playVideoAsAudio, isVideoTrack, mseAvailable, lowestRenditionUrl, videoTrackId,
} from '../../../src/lib/videoAsAudio.js'
import { hlsPlayback } from '../../../src/components/GlobalAudioPlayer/playerMath.js'

const PLAY = 'https://play.example/hls?u=https%3A%2F%2Fipfs.example%2Fipfs%2FQmX%2Fmanifest.m3u8'
// The encoder lists renditions highest first, muxed (no audio-only group).
const MASTER = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=6500000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"
https://play.example/hls?u=1080
#EXT-X-STREAM-INF:BANDWIDTH=3500000,RESOLUTION=1280x720
https://play.example/hls?u=720
#EXT-X-STREAM-INF:BANDWIDTH=1800000,RESOLUTION=854x480
https://play.example/hls?u=480
`
const MEDIA = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:13
#EXT-X-PLAYLIST-TYPE:VOD
#EXTINF:8.333333,
https://play.example/seg/480p_0.ts?u=a
#EXTINF:3.9,
480p_1.ts
#EXT-X-ENDLIST
`

const text = (body, status = 200) => ({ ok: status < 400, status, text: async () => body })

afterEach(() => { vi.unstubAllGlobals() })

describe('reading playlists', () => {
  it('lists the renditions and picks the lowest, or the best at or under 480p', () => {
    const r = parseMaster(MASTER, PLAY)
    expect(r.map((x) => x.height)).toEqual([1080, 720, 480])
    expect(lowestRendition(r).url).toBe('https://play.example/hls?u=480')
    expect(renditionUpTo(r, 480).height).toBe(480)
    expect(renditionUpTo(r, 720).height).toBe(720)
    // All taller than asked: the lowest one
    expect(renditionUpTo(r, 240).height).toBe(480)
    expect(renditionUpTo([], 480)).toBeNull()
    expect(parseMaster(MEDIA, PLAY)).toEqual([])
  })

  it('reads a media playlist, resolving relative segments, and writes one back', () => {
    const m = parseMedia(MEDIA, 'https://ipfs.example/ipfs/QmX/480p/index.m3u8')
    expect(m.segments).toEqual([
      { url: 'https://play.example/seg/480p_0.ts?u=a', duration: 8.333333 },
      { url: 'https://ipfs.example/ipfs/QmX/480p/480p_1.ts', duration: 3.9 },
    ])
    expect(m.targetDuration).toBe(13)
    expect(m.encrypted).toBe(false)
    expect(parseMedia('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="k"\n#EXTINF:2,\na.ts', 'https://x.example/').encrypted).toBe(true)
    const back = buildMediaPlaylist(m.segments, (i) => `seg-${i}.ts`)
    expect(back).toContain('#EXT-X-TARGETDURATION:9')
    expect(back).toContain('#EXTINF:3.900000,\nseg-1.ts')
    expect(back.trim().endsWith('#EXT-X-ENDLIST')).toBe(true)
    expect(resolveRef('b.ts', 'https://x.example/a/index.m3u8')).toBe('https://x.example/a/b.ts')
  })
})

describe('a video as an audio-player track', () => {
  const fetchSource = vi.fn(async () => ({ play_url: PLAY, thumbnail_url: 'https://img.example/t.webp', duration: 104 }))

  it('streams the lowest rendition and keeps the post for comments, votes and tips', async () => {
    const fetchImpl = vi.fn(async () => text(MASTER))
    const track = await videoAudioTrack({ author: 'badadib', permlink: 'test-stream', title: 'Test stream' }, { fetchSource, fetchImpl })
    expect(track).toEqual({
      _id: 'video:badadib/test-stream',
      video: true,
      owner: 'badadib',
      post_permlink: 'test-stream',
      title: 'Test stream',
      thumbnail_url: 'https://img.example/t.webp',
      duration: 104,
      src: 'https://play.example/hls?u=480',
      mime: 'application/vnd.apple.mpegurl',
    })
    // No `permlink`: that names an embed-audio upload (listening rewards, audio ads)
    expect(track.permlink).toBeUndefined()
    expect(isVideoTrack(track)).toBe(true)
    expect(isVideoTrack({ _id: 'x', video: true })).toBe(false)
    expect(videoTrackId('a', 'b')).toBe('video:a/b')
  })

  it('a playlist it cannot read plays as it is', async () => {
    expect(await lowestRenditionUrl(PLAY, { fetchImpl: async () => text('', 500) })).toBe(PLAY)
    expect(await lowestRenditionUrl(PLAY, { fetchImpl: async () => text(MEDIA) })).toBe(PLAY)
  })

  it('nothing to play (processing, gone): no track', async () => {
    await expect(videoAudioTrack({ author: 'badadib', permlink: 'x' }, { fetchSource: async () => null })).rejects.toMatchObject({ code: 'no_source' })
    await expect(videoAudioTrack({ author: 'badadib', permlink: 'x' }, { fetchSource: async () => ({ play_url: PLAY, placeholder: true }) })).rejects.toMatchObject({ code: 'no_source' })
    await expect(videoAudioTrack({}, { fetchSource })).rejects.toMatchObject({ code: 'no_source' })
  })

  it('plays it, or carries on with it when it is already loaded', async () => {
    const fetchImpl = async () => text(MASTER)
    const store = { audioPlay: vi.fn(), audioRequestToggle: vi.fn(), audioCurrent: null, audioIsPlaying: false }
    await playVideoAsAudio({ author: 'badadib', permlink: 'p' }, store, { fetchSource, fetchImpl })
    expect(store.audioPlay).toHaveBeenCalledWith(expect.objectContaining({ _id: 'video:badadib/p' }))
    const paused = { ...store, audioPlay: vi.fn(), audioCurrent: { _id: 'video:badadib/p' } }
    await playVideoAsAudio({ author: 'badadib', permlink: 'p' }, paused, { fetchSource, fetchImpl })
    expect(paused.audioPlay).not.toHaveBeenCalled()
    expect(paused.audioRequestToggle).toHaveBeenCalledTimes(1)
    const playing = { ...paused, audioRequestToggle: vi.fn(), audioIsPlaying: true }
    await playVideoAsAudio({ author: 'badadib', permlink: 'p' }, playing, { fetchSource, fetchImpl })
    expect(playing.audioRequestToggle).not.toHaveBeenCalled()
  })

  it('knows whether hls.js can run (Media Source Extensions)', () => {
    vi.stubGlobal('MediaSource', undefined)
    vi.stubGlobal('ManagedMediaSource', undefined)
    expect(mseAvailable()).toBe(false)
    vi.stubGlobal('ManagedMediaSource', function MMS() {})
    expect(mseAvailable()).toBe(true)
  })
})

describe('how the player plays HLS (playerMath hlsPlayback)', () => {
  const video = { _id: 'video:a/b', video: true, src: 'https://x.example/v.m3u8' }
  const live = { _id: 'l', live: true, mime: 'application/vnd.apple.mpegurl', src: 'https://x.example/l' }

  it('a video heard as audio goes through hls.js wherever MSE exists, so Web Audio can read it', () => {
    expect(hlsPlayback(video, { mse: true, canPlayNative: true })).toBe('hlsjs')
    expect(hlsPlayback(video, { mse: false, canPlayNative: true })).toBe('native')
    expect(hlsPlayback(video, { mse: false, canPlayNative: false })).toBe('hlsjs')
  })

  it('a live stream keeps the browser\'s own HLS where there is one', () => {
    expect(hlsPlayback(live, { mse: true, canPlayNative: true })).toBe('native')
    expect(hlsPlayback(live, { mse: true, canPlayNative: false })).toBe('hlsjs')
  })

  it('anything else is not HLS', () => {
    expect(hlsPlayback({ _id: 'a', audio_cid: 'Qm' }, { mse: true })).toBeNull()
    expect(hlsPlayback({ _id: 'e', external: true, src: 'https://x.example/e.m3u8' }, { mse: true })).toBeNull()
    expect(hlsPlayback(null)).toBeNull()
  })
})
