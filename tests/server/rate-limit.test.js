// Per-client rate limiting, shown on the wallet sign-in limiter (20 a minute), the
// cheapest one to exhaust.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startApi } from './helpers/server.js'

let api
beforeAll(async () => { api = await startApi() })
afterAll(async () => { await api?.stop() })

const challenge = (ip) => api.request('/api/auth/wallet/challenge', { method: 'POST', json: { username: 'alice' }, ip })

describe('wallet sign-in limiter', () => {
  it('allows 20 requests a minute per client, then answers 429', async () => {
    const ip = '198.51.100.7'
    for (let i = 0; i < 20; i++) expect((await challenge(ip)).status).toBe(200)
    const r = await challenge(ip)
    expect(r.status).toBe(429)
    expect(r.body).toEqual({ error: 'Too many requests' })
    expect(r.headers.get('ratelimit-limit')).toBe('20')
    expect(r.headers.get('ratelimit-remaining')).toBe('0')
    expect(Number(r.headers.get('ratelimit-reset'))).toBeGreaterThan(0)
  })

  it('counts each client separately', async () => {
    const r = await challenge('198.51.100.8')
    expect(r.status).toBe(200)
    expect(r.headers.get('ratelimit-remaining')).toBe('19')
  })

  it('a limited client is also refused at login', async () => {
    const r = await api.request('/api/auth/wallet/login', { method: 'POST', json: {}, ip: '198.51.100.7' })
    expect(r.status).toBe(429)
  })
})
