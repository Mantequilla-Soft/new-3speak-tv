// The maintenance gate: only an explicit "not ok" from a reachable checker shows
// the maintenance screen (src/utils/healthGate.js).
import { describe, it, expect, vi } from 'vitest'
import { checkPlatformHealth } from '../../../src/utils/healthGate.js'

describe('checkPlatformHealth', () => {
  it('asks /healthz uncached', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', f)
    expect(await checkPlatformHealth()).toEqual({ healthy: true, data: { ok: true } })
    expect(f.mock.calls[0][0]).toBe('https://checker.3speak.tv/healthz')
    expect(f.mock.calls[0][1].cache).toBe('no-store')
  })

  it('is unhealthy only when the checker says ok: false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: false, reason: 'maintenance' }) }))
    expect(await checkPlatformHealth()).toEqual({ healthy: false, data: { ok: false, reason: 'maintenance' } })
  })

  it('treats a body without ok as healthy', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))
    expect((await checkPlatformHealth()).healthy).toBe(true)
  })

  it('fails open on a 5xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))
    expect(await checkPlatformHealth()).toEqual({ healthy: true, reason: 'http 503' })
  })

  it('fails open on a network error or non-JSON body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    expect(await checkPlatformHealth()).toEqual({ healthy: true, reason: 'unreachable' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => { throw new SyntaxError('<') } }))
    expect(await checkPlatformHealth()).toEqual({ healthy: true, reason: 'unreachable' })
  })

  it('fails open when the checker does not answer in time', async () => {
    vi.stubGlobal('fetch', vi.fn((_u, { signal }) => new Promise((_r, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })))
    expect(await checkPlatformHealth(10)).toEqual({ healthy: true, reason: 'unreachable' })
  })
})
