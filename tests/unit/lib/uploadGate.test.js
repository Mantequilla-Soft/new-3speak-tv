// The pre-upload ad spot: asking for one, confirming the post that completes its
// impression, and reading the session id (src/lib/uploadGate.js).
import { describe, it, expect, vi } from 'vitest'
import { fetchUploadGateAd, confirmUploadGatePost, gateSessionId } from '../../../src/lib/uploadGate.js'

const SID = '0123456789abcdef0123456789abcdef'

describe('fetchUploadGateAd', () => {
  it('asks for the upload surface with only the lowercased viewer, no video', async () => {
    const ad = { manifestUrl: `https://checker.3speak.tv/m/${SID}/gate.m3u8` }
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ uploadAd: ad }) })
    vi.stubGlobal('fetch', f)
    expect(await fetchUploadGateAd('Alice')).toBe(ad)
    const [url, opts] = f.mock.calls[0]
    expect(url).toBe('https://checker.3speak.tv/m/session')
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body)).toEqual({ surface: 'upload', viewer: 'alice' })
  })

  it('every failure is null ("post immediately")', async () => {
    expect(await fetchUploadGateAd('')).toBeNull()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    expect(await fetchUploadGateAd('a')).toBeNull()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))
    expect(await fetchUploadGateAd('a')).toBeNull()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ uploadAd: { manifestUrl: 5 } }) }))
    expect(await fetchUploadGateAd('a')).toBeNull()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => null }))
    expect(await fetchUploadGateAd('a')).toBeNull()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    expect(await fetchUploadGateAd('a')).toBeNull()
  })
})

describe('confirmUploadGatePost', () => {
  it('posts the permlink to /m/<sid>/posted with keepalive', () => {
    const f = vi.fn().mockResolvedValue({})
    vi.stubGlobal('fetch', f)
    confirmUploadGatePost(SID, 'my-video')
    const [url, opts] = f.mock.calls[0]
    expect(url).toBe(`https://checker.3speak.tv/m/${SID}/posted`)
    expect(opts).toMatchObject({ method: 'POST', keepalive: true })
    expect(JSON.parse(opts.body)).toEqual({ permlink: 'my-video' })
  })

  it('does nothing without sid or permlink, and swallows failures', async () => {
    const f = vi.fn().mockRejectedValue(new Error('down'))
    vi.stubGlobal('fetch', f)
    confirmUploadGatePost('', 'p')
    confirmUploadGatePost(SID, '')
    expect(f).not.toHaveBeenCalled()
    expect(() => confirmUploadGatePost(SID, 'p')).not.toThrow()
    await Promise.resolve()
  })
})

describe('gateSessionId', () => {
  it('reads the 32 hex session id out of the manifest URL', () => {
    expect(gateSessionId({ manifestUrl: `https://c/m/${SID}/gate.m3u8` })).toBe(SID)
  })

  it('is null for anything else', () => {
    expect(gateSessionId(null)).toBeNull()
    expect(gateSessionId({ manifestUrl: 'https://c/m/NOTHEX/gate.m3u8' })).toBeNull()
    expect(gateSessionId({ manifestUrl: `https://c/m/${SID}` })).toBeNull()
  })
})
