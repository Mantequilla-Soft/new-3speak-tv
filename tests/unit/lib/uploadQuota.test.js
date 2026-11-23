// ⏳ The free plan's daily upload limits (src/lib/uploadQuota.js): reading the
// embed and audio quotas (fail open: any failure is "no limit known"), the
// refusals told apart by `code` (a plain 429 is a rate limit, not the limit),
// and the wording.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../src/utils/config', () => ({
  EMBED_API_URL: 'https://embed.test/',
  EMBED_API_KEY: 'embed-key',
  THREESPEAK_AUDIO_API_URL: 'https://audio.test',
  THREESPEAK_API_KEY: 'audio-key',
}))

const q = await import('../../../src/lib/uploadQuota.js')
const ok = (data) => ({ ok: true, json: async () => data })
// t() that echoes its key and options, like the app's tests elsewhere
const t = (key, opts) => (opts ? `${key} ${JSON.stringify(opts)}` : key)

const VIDEO_ON = {
  enabled: true, exempt: false, reason: null,
  video: { limit: 1, used: 1, remaining: 0, next_at: '2026-11-21T14:32:00Z' },
  short: { limit: 3, used: 1, remaining: 2, next_at: null },
}
const AUDIO_ON = { enabled: true, exempt: false, reason: null, audio: { limit: 2, used: 0, remaining: 2, next_at: null, max_seconds: 900 } }

let fetchMock
beforeEach(() => {
  fetchMock = vi.fn(async () => ok({}))
  vi.stubGlobal('fetch', fetchMock)
  q.refreshUploadQuota()
})

describe('reading the quotas', () => {
  it('asks the embed API for the owner, with the app key', async () => {
    fetchMock.mockResolvedValueOnce(ok(VIDEO_ON))
    const v = await q.fetchVideoQuota('badadib')
    expect(fetchMock.mock.calls[0][0]).toBe('https://embed.test/uploads/quota?owner=badadib')
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ 'X-API-Key': 'embed-key' })
    expect(v).toEqual({
      exempt: false, reason: null, plan: 'free',
      video: { limit: 1, used: 1, remaining: 0, nextAt: Date.parse('2026-11-21T14:32:00Z'), plan: 'free' },
      short: { limit: 3, used: 1, remaining: 2, nextAt: null, plan: 'free' },
    })
  })

  it('carries the warm-up plan onto both counters', async () => {
    fetchMock.mockResolvedValueOnce(ok({
      enabled: true, exempt: false, reason: null, plan: 'warmup',
      video: { limit: 3, used: 1, remaining: 2, next_at: null },
      short: { limit: 3, used: 3, remaining: 0, next_at: '2026-11-21T14:32:00Z' },
    }))
    const v = await q.fetchVideoQuota('newbie')
    expect(fetchMock.mock.calls[0][0]).toBe('https://embed.test/uploads/quota?owner=newbie')
    expect(v).toMatchObject({ plan: 'warmup', video: { limit: 3, remaining: 2, plan: 'warmup' }, short: { remaining: 0, plan: 'warmup' } })
    expect(q.usedUpInfo(v.short, 'short')).toMatchObject({ code: 'daily_upload_limit', kind: 'short', plan: 'warmup' })
    expect(q.usedUpInfo(null, 'video').plan).toBe('free')
  })

  it('asks the audio API with the user header', async () => {
    fetchMock.mockResolvedValueOnce(ok(AUDIO_ON))
    const a = await q.fetchAudioQuota('badadib')
    expect(fetchMock.mock.calls[0][0]).toBe('https://audio.test/api/audio/quota')
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ 'X-API-Key': 'audio-key', 'X-User': 'badadib' })
    expect(a.audio).toEqual({ limit: 2, used: 0, remaining: 2, nextAt: null, maxSeconds: 900 })
  })

  it('fails open: a 404 (backend not deployed), an error, a network failure or limits off are all "no limit known"', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ error: 'Not found' }) })
    expect(await q.fetchVideoQuota('badadib')).toBeNull()
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
    expect(await q.fetchAudioQuota('badadib')).toBeNull()
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect(await q.fetchVideoQuota('badadib')).toBeNull()
    fetchMock.mockResolvedValueOnce(ok({ enabled: false, exempt: false, video: { limit: null } }))
    expect(await q.fetchVideoQuota('badadib')).toBeNull()
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => { throw new SyntaxError('html') } })
    expect(await q.fetchAudioQuota('badadib')).toBeNull()
  })

  it('handles the nulls the audio API sends exempt accounts and everyone while off', () => {
    const nulls = { limit: null, used: 0, remaining: null, next_at: null, max_seconds: null }
    expect(q.normalizeAudioQuota({ enabled: true, exempt: true, reason: 'pro', audio: nulls })).toEqual({ exempt: true, reason: 'pro' })
    expect(q.normalizeAudioQuota({ enabled: false, exempt: false, reason: null, audio: nulls })).toBeNull()
    // On, but no counter given: nothing to hold anyone to
    expect(q.normalizeAudioQuota({ enabled: true, exempt: false, reason: null, audio: nulls }).audio).toBeNull()
    // A count without a length limit
    expect(q.normalizeAudioQuota({ enabled: true, exempt: false, audio: { limit: 2, used: 2, remaining: 0, next_at: null, max_seconds: null } }).audio)
      .toMatchObject({ remaining: 0, maxSeconds: null })
  })

  it('caches per account for a minute and reads again after refreshUploadQuota()', async () => {
    fetchMock.mockImplementation(async (url) => ok(url.includes('/api/audio/') ? AUDIO_ON : VIDEO_ON))
    await q.loadUploadQuotas('badadib')
    await q.loadUploadQuotas('BadAdib')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const seen = vi.fn()
    const off = q.subscribeUploadQuota(seen)
    q.refreshUploadQuota()
    expect(seen).toHaveBeenCalledTimes(1)
    off()
    await q.loadUploadQuotas('badadib', { audio: false })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})

describe('refusals, told apart by code', () => {
  it('a 429 daily_upload_limit is the video / Short limit', () => {
    expect(q.parseUploadLimit(429, { code: 'daily_upload_limit', kind: 'short', limit: 3, used: 3, next_at: '2026-11-21T10:00:00Z' }))
      .toEqual({ code: 'daily_upload_limit', kind: 'short', plan: 'free', limit: 3, used: 3, nextAt: Date.parse('2026-11-21T10:00:00Z') })
    expect(q.parseUploadLimit(429, { code: 'daily_upload_limit', kind: 'video', plan: 'warmup', limit: 3, used: 3 }).plan).toBe('warmup')
  })
  it('a 429 daily_audio_limit and a 413 audio_too_long are the audio limits', () => {
    expect(q.parseUploadLimit(429, { code: 'daily_audio_limit', limit: 2, used: 2, next_at: null })).toMatchObject({ code: 'daily_audio_limit', kind: 'audio', nextAt: null })
    expect(q.parseUploadLimit(413, { code: 'audio_too_long', max_seconds: 900, duration: 1830 })).toEqual({ code: 'audio_too_long', kind: 'audio', maxSeconds: 900, duration: 1830 })
    // no max_seconds from the server: the free plan's 20 minutes (owner 2026-11-23, was 15)
    expect(q.parseUploadLimit(413, { code: 'audio_too_long', duration: 1830 }).maxSeconds).toBe(20 * 60)
    expect(q.DEFAULT_AUDIO_MAX_SECONDS).toBe(1200)
  })
  it('a plain 429 (the per-minute limiter, no code) is not a limit', () => {
    expect(q.parseUploadLimit(429, { error: 'Too many requests' })).toBeNull()
    expect(q.parseUploadLimit(429, null)).toBeNull()
    expect(q.uploadLimitFromAxios({ response: { status: 429, data: { error: 'slow down' } } })).toBeNull()
    expect(q.uploadLimitFromAxios(new Error('Network Error'))).toBeNull()
  })
})

describe('wording', () => {
  it('names what was reached and when the next upload frees up, in local time', () => {
    const now = new Date(2026, 10, 20, 9, 0).getTime()
    const at = new Date(2026, 10, 20, 14, 32).getTime()
    expect(q.formatNextAt(at, 'en-GB', now)).toBe('14:32')
    expect(q.formatNextAt(new Date(2026, 10, 21, 8, 5).getTime(), 'en-GB', now)).toMatch(/Sat.*08:05/)
    expect(q.uploadLimitMessage(t, { code: 'daily_upload_limit', kind: 'video', nextAt: at }, 'en-GB', now))
      .toBe('uploadLimits.reached.video uploadLimits.nextAt {"time":"14:32"}')
    expect(q.uploadLimitMessage(t, { code: 'daily_audio_limit', kind: 'audio', nextAt: null })).toBe('uploadLimits.reached.audio uploadLimits.later')
    expect(q.uploadLimitMessage(t, { code: 'daily_upload_limit', kind: 'short', plan: 'warmup', nextAt: null })).toBe('uploadLimits.reachedWarmup.short uploadLimits.later')
    expect(q.uploadLimitMessage(t, { code: 'audio_too_long', maxSeconds: 900, duration: 1830 })).toBe('uploadLimits.tooLong {"duration":"30:30","minutes":15}')
  })
  it('Go Pro leads to the viewer\'s own wallet, like the servers\' upgrade_url', () => {
    expect(q.proPlansPath('badadib')).toBe('/wallet/badadib#pro')
  })
})
