// @vitest-environment jsdom
// Lightning tips (src/lib/lightningTip.js): asking our API for an invoice and
// its paid status, paying through a WebLN wallet, where a creator's tips go,
// and reading and saving a creator's own Lightning address in their Hive
// metadata. fetch and the metadata helpers are mocked.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn() }))
vi.mock('../../../src/lib/threespeakMeta', () => ({ readThreespeakMeta: h.read, saveThreespeakMeta: h.save }))

import {
  LIGHTNING_PRESETS, requestLightningInvoice, isLightningInvoicePaid, hasWebln, payWithWebln,
  LIGHTNING_ADDRESS_RE, fetchLightningReceiver, checkLightningAddress, readOwnLightningAddress,
  saveOwnLightningAddress,
} from '../../../src/lib/lightningTip.js'

const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const unreadable = (status) => ({ ok: status < 300, status, json: async () => { throw new SyntaxError('html') } })

let fetchMock
beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  h.read.mockReset()
  h.save.mockReset().mockResolvedValue(undefined)
})
afterEach(() => { delete window.webln })

it('presets start high enough that most of a tip survives the conversion fee', () => {
  expect(LIGHTNING_PRESETS).toEqual([500, 1000, 2500, 5000])
})

describe('requestLightningInvoice', () => {
  it('asks for an invoice for the creator and amount, with an optional comment', async () => {
    const invoice = { pr: 'lnbc1', sats: 1000, hash: 'h1', via: 'v4v', verifiable: true }
    fetchMock.mockResolvedValue(reply(200, invoice))
    expect(await requestLightningInvoice({ to: 'alice', sats: 1000, comment: 'great video & thanks' })).toEqual(invoice)
    expect(fetchMock).toHaveBeenCalledWith('/api/lightning/invoice?to=alice&sats=1000&comment=great+video+%26+thanks')
    await requestLightningInvoice({ to: 'alice', sats: 500 })
    expect(fetchMock.mock.calls[1][0]).toBe('/api/lightning/invoice?to=alice&sats=500')
  })

  it('throws with the API error code and the allowed maximum', async () => {
    fetchMock.mockResolvedValue(reply(400, { error: 'amount_out_of_range', max: 100000 }))
    const err = await requestLightningInvoice({ to: 'alice', sats: 9e9 }).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).toMatchObject({ message: 'amount_out_of_range', code: 'amount_out_of_range', max: 100000 })
  })

  it.each([
    ['an unreadable error page', unreadable(502), 'HTTP 502'],
    ['a 200 without an invoice', reply(200, { sats: 1 }), 'HTTP 200'],
  ])('reports invoice_failed for %s', async (_name, res, message) => {
    fetchMock.mockResolvedValue(res)
    await expect(requestLightningInvoice({ to: 'a', sats: 1 })).rejects.toMatchObject({ message, code: 'invoice_failed' })
  })
})

describe('isLightningInvoicePaid', () => {
  it.each([
    [reply(200, { paid: true }), true],
    [reply(200, { paid: 'yes' }), false],
    [reply(200, {}), false],
    [unreadable(200), false],
    [reply(404, { paid: true }), false],
  ])('answer %# reads as paid=%s', async (res, paid) => {
    fetchMock.mockResolvedValue(res)
    expect(await isLightningInvoicePaid('a/b')).toBe(paid)
  })

  it('encodes the hash into the path', async () => {
    fetchMock.mockResolvedValue(reply(200, {}))
    await isLightningInvoicePaid('a/b')
    expect(fetchMock).toHaveBeenCalledWith('/api/lightning/status/a%2Fb')
  })
})

describe('WebLN', () => {
  it('is detected only when a wallet injected window.webln', () => {
    expect(hasWebln()).toBe(false)
    window.webln = {}
    expect(hasWebln()).toBe(true)
  })

  it('enables the wallet before sending, and passes a cancel through', async () => {
    const order = []
    window.webln = {
      enable: vi.fn(async () => { order.push('enable') }),
      sendPayment: vi.fn(async (pr) => { order.push(`pay ${pr}`); return { preimage: 'p' } }),
    }
    expect(await payWithWebln('lnbc1')).toEqual({ preimage: 'p' })
    expect(order).toEqual(['enable', 'pay lnbc1'])

    window.webln.sendPayment.mockRejectedValue(new Error('User rejected'))
    await expect(payWithWebln('lnbc2')).rejects.toThrow('User rejected')
  })
})

describe('LIGHTNING_ADDRESS_RE', () => {
  it.each([
    ['alice@getalby.com', true],
    ['Bob.Smith+tips@walletofsatoshi.com', true],
    ['3speak.lightning@v4v.app', true],
    ['alice@localhost', false],
    ['alice', false],
    ['al ice@getalby.com', false],
    [`${'a'.repeat(65)}@getalby.com`, false],
    ['<x>@evil.com', false],
  ])('%s -> %s', (address, ok) => {
    expect(LIGHTNING_ADDRESS_RE.test(address)).toBe(ok)
  })
})

describe('fetchLightningReceiver', () => {
  it('returns where the tips go', async () => {
    fetchMock.mockResolvedValue(reply(200, { via: 'address', address: 'a@b.co' }))
    expect(await fetchLightningReceiver('al ice')).toEqual({ via: 'address', address: 'a@b.co' })
    expect(fetchMock).toHaveBeenCalledWith('/api/lightning/receiver?to=al%20ice')
  })

  it.each([
    ['an error status', () => fetchMock.mockResolvedValue(reply(500, {}))],
    ['a network failure', () => fetchMock.mockRejectedValue(new TypeError('offline'))],
    ['unreadable JSON', () => fetchMock.mockResolvedValue(unreadable(200))],
  ])('is null on %s', async (_name, arrange) => {
    arrange()
    expect(await fetchLightningReceiver('alice')).toBeNull()
  })
})

describe('checkLightningAddress', () => {
  it('returns the payment limits of a working address', async () => {
    fetchMock.mockResolvedValue(reply(200, { ok: true, min: 1, max: 1e6 }))
    expect(await checkLightningAddress('a@b.co')).toEqual({ ok: true, min: 1, max: 1e6 })
    expect(fetchMock).toHaveBeenCalledWith('/api/lightning/check-address?address=a%40b.co')
  })

  it.each([
    [reply(400, { error: 'bad_address' }), 'bad_address', 'bad_address'],
    [reply(200, { ok: false }), 'HTTP 200', 'unreachable'],
    [unreadable(504), 'HTTP 504', 'unreachable'],
  ])('answer %# throws %s with code %s', async (res, message, code) => {
    fetchMock.mockResolvedValue(res)
    await expect(checkLightningAddress('x')).rejects.toMatchObject({ message, code })
  })
})

describe("a creator's own address", () => {
  it.each([
    [{ lightning: { address: 'Alice@GetAlby.com' } }, 'alice@getalby.com'],
    [{ lightning: { address: 'not an address' } }, ''],
    [{ lightning: {} }, ''],
    [{}, ''],
  ])('reads %j as %j', async (ns, address) => {
    h.read.mockResolvedValue(ns)
    expect(await readOwnLightningAddress('alice')).toBe(address)
    expect(h.read).toHaveBeenCalledWith('alice')
  })

  it('saves a lower-cased address with a timestamp, keeping the rest of the namespace', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-05T09:00:00Z'))
    await saveOwnLightningAddress('alice', 'Me@Wallet.io')
    const [user, change] = h.save.mock.calls[0]
    expect(user).toBe('alice')
    const ns = { interests: ['music'] }
    change(ns)
    expect(ns).toEqual({ interests: ['music'], lightning: { address: 'me@wallet.io', updatedAt: '2026-11-05T09:00:00.000Z' } })
    vi.useRealTimers()
  })

  it('removing the address puts tips back on the v4v.app default', async () => {
    await saveOwnLightningAddress('alice', '')
    const ns = { lightning: { address: 'x@y.z' }, other: 1 }
    h.save.mock.calls[0][1](ns)
    expect(ns).toEqual({ other: 1 })
  })
})
