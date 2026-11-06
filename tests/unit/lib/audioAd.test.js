// The spoken ticker in the audio player (src/lib/audioAd.js): asking the
// checker for a spot on a track named one of three ways, checking the answer
// before the player trusts it, and reporting a spot heard to its end. Every
// failure is "no ad", so a track never fails to play because of an ad.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../src/utils/config', () => ({ CHECKER_URL: 'https://checker.example' }))
vi.mock('../../../src/lib/adBreak', () => ({ adCapId: () => 'cap-1', recentAdKeys: () => ['k1'] }))

import { requestAudioAd, normalizeAudioAd, reportAudioAdHeard } from '../../../src/lib/audioAd.js'

const reply = (status, body) => ({ ok: status < 300, status, json: async () => body })
const SPOT = { audioUrl: 'https://cdn.example/spot.mp3', durationSeconds: 12, message: 'Buy bees', positionPercent: 30 }

let fetchMock
beforeEach(() => {
  fetchMock = vi.fn(async () => reply(200, { audioAd: SPOT }))
  vi.stubGlobal('fetch', fetchMock)
})

describe('requestAudioAd', () => {
  it.each([
    ['3Speak audio', { owner: 'alice', permlink: 'p1' }, { owner: 'alice', permlink: 'p1' }],
    ['an outside episode that links a 3Speak post', { owner: 'alice', postPermlink: 'post1' }, { owner: 'alice', postPermlink: 'post1' }],
    ['an outside episode', { episodeId: 'ep1' }, { episodeId: 'ep1' }],
  ])('asks for a spot on %s, with the viewer and the frequency cap', async (_name, args, ref) => {
    await requestAudioAd({ ...args, viewer: 'bob' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://checker.example/m/session')
    expect(JSON.parse(init.body)).toEqual({ surface: 'audio', audioSpot: true, ...ref, viewer: 'bob', capId: 'cap-1', recentAdKeys: ['k1'] })
  })

  it('names an anonymous listener null', async () => {
    await requestAudioAd({ episodeId: 'ep1' })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).viewer).toBeNull()
  })

  it('asks nothing for a track it cannot name', async () => {
    expect(await requestAudioAd({ owner: 'alice' })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['an error status', () => fetchMock.mockResolvedValue(reply(500, {}))],
    ['a network failure', () => fetchMock.mockRejectedValue(new TypeError('offline'))],
    ['unreadable JSON', () => fetchMock.mockResolvedValue({ ok: true, json: async () => { throw new Error('x') } })],
    ['no spot', () => fetchMock.mockResolvedValue(reply(200, {}))],
  ])('is null on %s', async (_name, arrange) => {
    arrange()
    expect(await requestAudioAd({ episodeId: 'ep1' })).toBeNull()
  })

  it('returns the checked spot', async () => {
    expect(await requestAudioAd({ episodeId: 'ep1' })).toMatchObject({ audioUrl: SPOT.audioUrl, positionPercent: 30 })
  })
})

describe('normalizeAudioAd', () => {
  it('fills in defaults for everything optional', () => {
    expect(normalizeAudioAd(SPOT)).toEqual({
      audioUrl: 'https://cdn.example/spot.mp3', durationSeconds: 12, positionPercent: 30, message: 'Buy bees',
      style: 'crawl', account: null, productName: null, clickUrl: null, shownUrl: null, adKey: null, capMinutes: null, label: 'Ad',
    })
  })

  it('keeps what the server set', () => {
    const full = { ...SPOT, durationSeconds: '8', style: 'hold', account: 'acme', productName: 'Bees', clickUrl: 'https://acme', shownUrl: 'https://s', adKey: 'k', capMinutes: '15', label: 'Sponsored' }
    expect(normalizeAudioAd(full)).toMatchObject({ durationSeconds: 8, style: 'hold', capMinutes: 15, label: 'Sponsored', account: 'acme' })
  })

  it.each([
    [-20, 0],
    [250, 100],
    ['x', 0],
  ])('clamps a position of %j to %j', (positionPercent, out) => {
    expect(normalizeAudioAd({ ...SPOT, positionPercent }).positionPercent).toBe(out)
  })

  it('accepts an audio spot without text', () => {
    expect(normalizeAudioAd({ ...SPOT, message: '' })).not.toBeNull()
  })

  it.each([
    ['nothing', null],
    ['an http audio URL', { ...SPOT, audioUrl: 'http://cdn.example/spot.mp3' }],
    ['a javascript: URL', { ...SPOT, audioUrl: 'javascript:alert(1)' }],
    ['no duration', { ...SPOT, durationSeconds: 0 }],
    ['a message that is not text', { ...SPOT, message: null }],
  ])('refuses %s', (_name, a) => {
    expect(normalizeAudioAd(a)).toBeNull()
  })
})

describe('reportAudioAdHeard', () => {
  it('posts once to the shown URL, surviving navigation', () => {
    reportAudioAdHeard('https://checker.example/m/shown/1')
    expect(fetchMock).toHaveBeenCalledWith('https://checker.example/m/shown/1', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', keepalive: true,
    })
  })

  it('does nothing without a URL and never throws', async () => {
    reportAudioAdHeard('')
    expect(fetchMock).not.toHaveBeenCalled()
    fetchMock.mockRejectedValue(new Error('down'))
    expect(() => reportAudioAdHeard('https://x')).not.toThrow()
    fetchMock.mockImplementation(() => { throw new Error('sync') })
    expect(() => reportAudioAdHeard('https://x')).not.toThrow()
  })
})
