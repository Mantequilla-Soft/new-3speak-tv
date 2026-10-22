// Crash reports sent to the checker: path only, capped field lengths, beacon
// first (src/utils/reportClientError.js).
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { reportClientError } from '../../../src/utils/reportClientError.js'
import { APP_VERSION } from '../../../src/version.js'

beforeEach(() => {
  window.history.replaceState(null, '', '/watch?v=alice/clip&token=secret')
})

const blobText = (blob) => new Promise((resolve) => {
  const r = new FileReader()
  r.onload = () => resolve(r.result)
  r.readAsText(blob)
})

describe('reportClientError', () => {
  it('sends a text/plain beacon with the path but never the query string', async () => {
    const beacon = vi.fn().mockReturnValue(true)
    navigator.sendBeacon = beacon
    reportClientError({ kind: 'boundary', error: new Error('boom'), componentStack: 'at X' })
    const [url, blob] = beacon.mock.calls[0]
    expect(url).toBe('https://checker.3speak.tv/client-errors')
    expect(blob.type).toBe('text/plain')
    const body = JSON.parse(await blobText(blob))
    expect(body).toMatchObject({ kind: 'boundary', route: '/watch', message: 'boom', componentStack: 'at X', appVersion: APP_VERSION })
    expect(JSON.stringify(body)).not.toContain('secret')
    delete navigator.sendBeacon
  })

  it('caps message, stack and component stack lengths', async () => {
    const beacon = vi.fn()
    navigator.sendBeacon = beacon
    const err = new Error('m'.repeat(900))
    err.stack = 's'.repeat(9000)
    reportClientError({ kind: 'x', error: err, componentStack: 'c'.repeat(9000) })
    const body = JSON.parse(await blobText(beacon.mock.calls[0][1]))
    expect(body.message).toHaveLength(500)
    expect(body.stack).toHaveLength(4000)
    expect(body.componentStack).toHaveLength(3000)
    delete navigator.sendBeacon
  })

  it('falls back to a keepalive POST without sendBeacon', () => {
    delete navigator.sendBeacon
    const f = vi.fn().mockResolvedValue({})
    vi.stubGlobal('fetch', f)
    reportClientError({ kind: 'chunk', error: 'plain string' })
    const [url, opts] = f.mock.calls[0]
    expect(url).toBe('https://checker.3speak.tv/client-errors')
    expect(opts).toMatchObject({ method: 'POST', keepalive: true, headers: { 'Content-Type': 'text/plain' } })
    expect(JSON.parse(opts.body).message).toBe('plain string')
  })

  it('never throws, even if reporting itself fails', () => {
    navigator.sendBeacon = () => { throw new Error('nope') }
    expect(() => reportClientError({ kind: 'x', error: null })).not.toThrow()
    delete navigator.sendBeacon
  })
})
