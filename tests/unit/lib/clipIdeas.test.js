// Shorts from this video, the data layer (src/lib/clipIdeas.js): the checker call
// with the session vouch, and the watch page's `short=S-E` range.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const sessionVouch = vi.hoisted(() => vi.fn())
vi.mock('../../../src/lib/podcastProgress', () => ({ sessionVouch }))

const { fetchClipIdeas, parseShortRange, shortRangeParam } = await import('../../../src/lib/clipIdeas.js')

const C = 'https://checker.3speak.tv'

beforeEach(() => {
  sessionVouch.mockReset()
  sessionVouch.mockResolvedValue({ user: 'badadib', signature: 'sig', timestamp: 123 })
})

describe('fetchClipIdeas', () => {
  it('posts the vouch, the permlink and the language', async () => {
    const f = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ success: true, duration: 600, suggestions: [{ start: 240, end: 270, score: 100, reasons: [{ kind: 'replay' }] }], signals: { replay: true } }),
    })
    vi.stubGlobal('fetch', f)
    const out = await fetchClipIdeas('badadib', 'my-video', { lang: 'de' })
    expect(f).toHaveBeenCalledWith(`${C}/creator-stats/clip-ideas`, expect.objectContaining({ method: 'POST' }))
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ user: 'badadib', signature: 'sig', timestamp: 123, permlink: 'my-video', lang: 'de' })
    expect(out).toEqual({ duration: 600, short: false, signals: { replay: true }, suggestions: [{ start: 240, end: 270, score: 100, reasons: [{ kind: 'replay' }] }] })
  })

  it('null when signed out, unproven, or not the owner (404)', async () => {
    const f = vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ success: false }) })
    vi.stubGlobal('fetch', f)
    expect(await fetchClipIdeas(null, 'x')).toBeNull()
    expect(await fetchClipIdeas('fan', 'x')).toBeNull()
    sessionVouch.mockResolvedValue(null)
    expect(await fetchClipIdeas('badadib', 'x')).toBeNull()
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('throws on a server error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }))
    await expect(fetchClipIdeas('badadib', 'x')).rejects.toThrow('500')
  })
})

describe('short range parameter', () => {
  it('round-trips and refuses nonsense', () => {
    expect(shortRangeParam(240.7, 270.2)).toBe('240-270')
    expect(parseShortRange('?t=240&short=240-270')).toEqual({ start: 240, end: 270 })
    expect(parseShortRange('?short=270-240')).toBeNull()
    expect(parseShortRange('?short=0-500')).toBeNull()
    expect(parseShortRange('?short=abc')).toBeNull()
    expect(parseShortRange('')).toBeNull()
  })
})
