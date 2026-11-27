// Spending 3Speak Points on the live server (src/lib/pointsSpend.js): done at
// once, a 428 the wallet signs and the request goes again with burnTx, a 202
// followed on GET /points/spends/:id, and errors as { ok: false, message, code }.
import { describe, it, expect, vi } from 'vitest'
import { spendPoints, walletSigner } from '../../../src/lib/pointsSpend.js'

const API = 'https://live.example'
const answer = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

function fetchQueue(...answers) {
  const f = vi.fn(async () => {
    const next = answers.shift()
    if (!next) throw new Error('no more answers')
    return next
  })
  vi.stubGlobal('fetch', f)
  return f
}

const spend = (extra = {}) => spendPoints({
  apiBaseUrl: API,
  url: `${API}/points/promote`,
  body: { author: 'badadib', permlink: 'abc', days: 2 },
  headers: () => ({ Authorization: 'Bearer tok' }),
  pollMs: 1,
  ...extra,
})

describe('spendPoints', () => {
  it('posts the body with the session token and returns what the server said', async () => {
    const f = fetchQueue(answer(201, { promotedUntil: '2026-12-01T00:00:00Z', balance: 100 }))
    const out = await spend()
    expect(out).toEqual({ ok: true, body: { promotedUntil: '2026-12-01T00:00:00Z', balance: 100 } })
    const [url, init] = f.mock.calls[0]
    expect(url).toBe(`${API}/points/promote`)
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json', Authorization: 'Bearer tok' })
    expect(JSON.parse(init.body)).toEqual({ author: 'badadib', permlink: 'abc', days: 2 })
  })

  it('a 428 has the wallet sign the op, then sends the same request with burnTx', async () => {
    const op = ['custom_json', { id: 'magi', required_posting_auths: ['badadib'], json: '{}' }]
    const f = fetchQueue(answer(428, { code: 'sign', op }), answer(201, { promotedUntil: 'x' }))
    const sign = vi.fn(async () => 'tx123')
    const out = await spend({ sign })
    expect(sign).toHaveBeenCalledWith([op])
    expect(JSON.parse(f.mock.calls[1][1].body)).toEqual({ author: 'badadib', permlink: 'abc', days: 2, burnTx: 'tx123' })
    expect(out).toEqual({ ok: true, body: { promotedUntil: 'x' } })
  })

  it('a 428 without a signer, or a wallet that refuses, is a sign error', async () => {
    fetchQueue(answer(428, { code: 'sign', op: ['custom_json', {}], message: 'Sign it.' }))
    expect(await spend()).toEqual({ ok: false, code: 'sign', message: 'Sign it.' })
    fetchQueue(answer(428, { code: 'sign', op: ['custom_json', {}] }))
    const out = await spend({ sign: async () => { throw new Error('User cancelled') } })
    expect(out).toEqual({ ok: false, code: 'sign', message: 'User cancelled' })
  })

  it('a 202 is followed until the spend is ok, skipping "sent" and failed looks', async () => {
    const f = fetchQueue(
      answer(202, { pending: true, spendId: 'sp/1' }),
      answer(500, {}),
      answer(200, { status: 'sent' }),
      answer(200, { status: 'ok', promotedUntil: 'until' }),
    )
    const onPending = vi.fn()
    const out = await spend({ onPending })
    expect(onPending).toHaveBeenCalledTimes(1)
    expect(out).toEqual({ ok: true, body: { status: 'ok', promotedUntil: 'until' } })
    expect(f.mock.calls[1][0]).toBe(`${API}/points/spends/sp%2F1`)
    expect(f.mock.calls[1][1].headers).toEqual({ Authorization: 'Bearer tok' })
  })

  it('a pending spend that fails or never confirms says so', async () => {
    fetchQueue(answer(202, { pending: true, spendId: 's1' }), answer(200, { status: 'failed', message: 'Your points are back.' }))
    expect(await spend()).toEqual({ ok: false, code: 'failed', message: 'Your points are back.' })
    vi.stubGlobal('fetch', vi.fn(async (url) => (url.endsWith('/points/promote') ? answer(202, { pending: true, spendId: 's2' }) : answer(200, { status: 'sent' }))))
    const out = await spend({ timeoutMs: 20 })
    expect(out.ok).toBe(false)
    expect(out.code).toBe('timeout')
  })

  it('an error answer keeps its code and message, or names the status', async () => {
    fetchQueue(answer(409, { code: 'insufficient', message: 'Not enough points.' }))
    expect(await spend()).toEqual({ ok: false, code: 'insufficient', message: 'Not enough points.' })
    fetchQueue({ ok: false, status: 503, json: async () => { throw new Error('not json') } })
    expect(await spend()).toEqual({ ok: false, code: undefined, message: 'Failed (503)' })
  })
})

describe('walletSigner', () => {
  it('resolves the txid from an aioha string or a dhive { id }', async () => {
    expect(await walletSigner(async () => ({ success: true, result: 'abc' }))([])).toBe('abc')
    expect(await walletSigner(async () => ({ success: true, result: { id: 'def' } }))([])).toBe('def')
  })

  it('throws when nothing was signed, and is undefined without a broadcast', async () => {
    await expect(walletSigner(async () => ({ success: false, error: 'Rejected' }))([])).rejects.toThrow('Rejected')
    await expect(walletSigner(async () => ({ success: true }))([])).rejects.toThrow('The wallet did not sign.')
    expect(walletSigner(undefined)).toBeUndefined()
  })
})
