// The API server (server/index.cjs) as a whole: offline startup through the test
// preload, /api/health, helmet headers, CORS, body parsing, the error handler,
// unknown routes and the playlists read proxy's path whitelist.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { startApi, PRELOAD, REPO } from './helpers/server.js'

let api
beforeAll(async () => { api = await startApi() })
afterAll(async () => { await api?.stop() })

describe('startup', () => {
  it('starts offline with the SDKs faked and answers /api/health', async () => {
    const r = await api.request('/api/health')
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ ok: true })
    expect(api.output()).toContain('[test-preload] active')
    expect(api.output()).toContain('ButrAuth SDK initialised')
  })

  it('made no network attempt while starting', () => {
    expect(api.netLog()).toEqual([])
  })

  it('the preload keeps dotenv from loading any .env file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), '3speak-api-test-dotenv-'))
    try {
      const envFile = path.join(dir, '.env')
      fs.writeFileSync(envFile, 'CANARY_FROM_DOTENV=leaked\n')
      const serverRequire = createRequire(path.join(REPO, 'server/index.cjs'))
      const dotenvPath = serverRequire.resolve('dotenv')
      const script = `require(${JSON.stringify(dotenvPath)}).config({ path: ${JSON.stringify(envFile)} }); process.stdout.write(String(process.env.CANARY_FROM_DOTENV))`
      const out = execFileSync(process.execPath, ['-r', PRELOAD, '-e', script], {
        env: { PATH: process.env.PATH },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      expect(out).toBe('undefined')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('security headers', () => {
  it('sets the helmet defaults and leaves CSP to the frontend', async () => {
    const r = await api.request('/api/health')
    expect(r.headers.get('x-content-type-options')).toBe('nosniff')
    expect(r.headers.get('x-frame-options')).toBe('SAMEORIGIN')
    expect(r.headers.get('strict-transport-security')).toMatch(/max-age=\d+; includeSubDomains/)
    expect(r.headers.get('referrer-policy')).toBe('no-referrer')
    expect(r.headers.get('cross-origin-opener-policy')).toBe('same-origin')
    expect(r.headers.get('cross-origin-resource-policy')).toBe('same-origin')
    expect(r.headers.get('content-security-policy')).toBeNull()
  })

  it('does not announce Express', async () => {
    const r = await api.request('/api/health')
    expect(r.headers.get('x-powered-by')).toBeNull()
  })
})

describe('CORS', () => {
  it('allows credentials from the 3speak frontends', async () => {
    for (const origin of ['https://3speak.tv', 'https://3speak.okinoko.io', 'http://localhost:5173']) {
      const r = await api.request('/api/health', { headers: { Origin: origin } })
      expect(r.status).toBe(200)
      expect(r.headers.get('access-control-allow-origin')).toBe(origin)
      expect(r.headers.get('access-control-allow-credentials')).toBe('true')
    }
  })

  it('answers a preflight from an allowed origin', async () => {
    const r = await api.request('/api/broadcast', {
      method: 'OPTIONS',
      headers: { Origin: 'https://3speak.tv', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
    })
    expect(r.status).toBe(204)
    expect(r.headers.get('access-control-allow-origin')).toBe('https://3speak.tv')
    expect(r.headers.get('access-control-allow-methods')).toContain('POST')
  })

  it('serves requests with no Origin (server to server, curl)', async () => {
    const r = await api.request('/api/health')
    expect(r.status).toBe(200)
    expect(r.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('refuses a foreign origin without CORS headers or details', async () => {
    for (const origin of ['https://evil.example', 'https://3speak.tv.evil.example', 'null']) {
      const r = await api.request('/api/health', { headers: { Origin: origin } })
      expect(r.status).toBe(403)
      expect(r.body).toEqual({ error: 'Forbidden' })
      expect(r.headers.get('access-control-allow-origin')).toBeNull()
    }
  })

})

describe('request bodies', () => {
  it('rejects a JSON body over 100kb without parsing it', async () => {
    const r = await api.request('/api/auth/wallet/challenge', {
      method: 'POST',
      json: { username: 'alice', pad: 'x'.repeat(110 * 1024) },
    })
    expect(r.status).toBe(413)
    expect(r.body).toEqual({ error: 'Request too large' })
  })

  it('accepts a JSON body just under the limit', async () => {
    const r = await api.request('/api/auth/wallet/challenge', {
      method: 'POST',
      json: { username: 'alice', pad: 'x'.repeat(90 * 1024) },
    })
    expect(r.status).toBe(200)
    expect(r.body.challenge).toMatch(/^3speak-login:alice:/)
  })

  it('answers malformed JSON with a generic error and no parser details', async () => {
    const r = await api.request('/api/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"operations": [',
    })
    expect(r.status).toBe(400)
    expect(r.body).toEqual({ error: 'Bad request' })
    expect(r.text).not.toMatch(/SyntaxError|at .*\.js:\d+|node_modules/)
  })

  it('treats a missing body like empty fields', async () => {
    const r = await api.request('/api/auth/wallet/challenge', { method: 'POST' })
    expect(r.status).toBe(400)
    expect(r.body).toEqual({ error: 'Invalid username' })
  })
})

describe('unknown routes', () => {
  it('404s an unknown /api path without a stack trace', async () => {
    for (const method of ['GET', 'POST', 'DELETE']) {
      const r = await api.request('/api/does-not-exist', { method })
      expect(r.status).toBe(404)
      expect(r.text).not.toMatch(/at .*\.(c?js):\d+|node_modules|index\.cjs/)
    }
  })

  it('answers the wrong method on a known route with 404', async () => {
    const r = await api.request('/api/broadcast')
    expect(r.status).toBe(404)
  })

  it('reports an unknown incubation route as JSON', async () => {
    const r = await api.request('/api/incubation/nope')
    expect(r.status).toBe(404)
    expect(r.body).toEqual({ error: 'Unknown incubation route' })
  })

  it('refuses a warm-up track that is not open for signup', async () => {
    const r = await api.request('/api/incubation/social/track', { method: 'PUT', json: { track: 'advertiser' } })
    expect(r.status).toBe(403)
    expect(r.body).toEqual({ error: 'track_closed' })
  })
})

describe('playlists read proxy', () => {
  const upstreamPaths = () => api.netLog().filter((e) => e.kind === 'fetch').map((e) => new URL(e.url).pathname)

  it('forwards whitelisted read paths to the upstream', async () => {
    api.setFixtures({ fetch: [{ url: 'https://playlists.test.invalid/api/playlists/alice?limit=5', json: { items: [] } }] })
    const r = await api.request('/api/pl/playlists/alice?limit=5')
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ items: [] })
    api.setFixtures({})
  })

  it('404s anything else without contacting the upstream', async () => {
    api.clearNetLog()
    for (const p of ['/api/pl/admin', '/api/pl/', '/api/pl/playlistsx', '/api/pl/video/a/playlists-admin']) {
      const r = await api.request(p)
      expect(r.status, p).toBe(404)
    }
    expect(upstreamPaths()).toEqual([])
  })

  it('reports an unreachable upstream as 502', async () => {
    const r = await api.request('/api/pl/playlists/nobody')
    expect(r.status).toBe(502)
    expect(r.body).toEqual({ error: 'playlists upstream unreachable' })
  })

  it('dot segments cannot climb out of the whitelisted paths', async () => {
    // Express decodes the captured path and fetch() resolves "..", "%2e%2e" and
    // backslashes, so each of these would reach the upstream's /admin with the
    // server's playlists token if the whitelist ran on the raw path.
    api.clearNetLog()
    for (const p of [
      '/api/pl/playlists/%2e%2e/%2e%2e/admin',
      '/api/pl/playlists/%252e%252e/%252e%252e/admin',
      '/api/pl/playlists%5c..%5c..%5cadmin',
      '/api/pl/video/a/b/playlists/%2e%2e/%2e%2e/%2e%2e/%2e%2e/admin',
    ]) {
      const r = await api.rawRequest(p)
      expect(r.status, p).toBe(404)
    }
    for (const p of upstreamPaths()) expect(p.startsWith('/api/playlists') || p.startsWith('/api/video/')).toBe(true)
  })
})
