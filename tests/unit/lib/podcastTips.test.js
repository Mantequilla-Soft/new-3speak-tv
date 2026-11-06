// @vitest-environment jsdom
// Tipping an outside podcast through its feed's value block
// (src/lib/podcastTips.js): which episodes can be supported, invoices for
// Lightning addresses, and paying every recipient through WebLN, with keysend
// boostagrams and a stop when the listener cancels. The split itself is in
// podcasts.test.js. fetch and window.webln are fakes.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  PODCAST_PRESETS, canTipEpisode, hasWebln, requestAddressInvoice, payValueWithWebln, splitSats,
} from '../../../src/lib/podcastTips.js'

const reply = (status, body) => ({ ok: status < 300, status, json: async () => body })
const host = { name: 'Host', type: 'lnaddress', address: 'host@getalby.com', split: 90 }
const cohost = { name: 'Cohost', type: 'node', address: '03abc', split: 10, customKey: '696969', customValue: 'pod1' }
const app = { type: 'node', address: '02app', split: 10, fee: true }

let fetchMock
beforeEach(() => {
  fetchMock = vi.fn(async () => reply(200, { pr: 'lnbc-host' }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { delete window.webln })

const fakeWebln = (overrides = {}) => {
  window.webln = {
    enable: vi.fn(async () => {}),
    sendPayment: vi.fn(async () => ({ preimage: 'p' })),
    keysend: vi.fn(async () => ({ preimage: 'k' })),
    ...overrides,
  }
  return window.webln
}

it('presets are small enough for a podcast boost', () => {
  expect(PODCAST_PRESETS).toEqual([100, 500, 1000, 2100])
})

describe('splitSats edge cases', () => {
  it('a fee above 100 % is capped, and nothing is left for the others', () => {
    expect(splitSats([{ ...app, split: 150 }, host], 100)).toEqual([{ ...app, split: 150, sats: 100 }])
  })

  it('ignores recipients without a positive split, and handles no recipients', () => {
    expect(splitSats([{ ...host, split: 0 }, { ...cohost, split: -5 }], 100)).toEqual([])
    expect(splitSats(null, 100)).toEqual([])
  })
})

describe('canTipEpisode', () => {
  it.each([
    ['a value block', { value: { recipients: [host] } }, true],
    ['a Hive account in the value block', { value: { recipients: [{ ...cohost, split: 0, customKey: '818818', customValue: 'alice' }] } }, true],
    ['a funding link', { funding: [{ url: 'https://patreon.example' }] }, true],
    ['none of them', { value: { recipients: [] }, funding: [] }, false],
    ['no track', null, false],
  ])('%s -> %s', (_name, track, yes) => {
    expect(canTipEpisode(track)).toBe(yes)
  })
})

describe('hasWebln', () => {
  it('needs a wallet on window', () => {
    expect(hasWebln()).toBe(false)
    fakeWebln()
    expect(hasWebln()).toBe(true)
  })
})

describe('requestAddressInvoice', () => {
  it('asks our API for an LNURL-pay invoice', async () => {
    expect(await requestAddressInvoice({ address: 'host@getalby.com', sats: 900, comment: 'Great ep!' })).toEqual({ pr: 'lnbc-host' })
    expect(fetchMock).toHaveBeenCalledWith('/api/lightning/address-invoice?address=host%40getalby.com&sats=900&comment=Great+ep%21')
  })

  it('throws with the API code and limits, or invoice_failed', async () => {
    fetchMock.mockResolvedValueOnce(reply(400, { error: 'amount_out_of_range', min: 10, max: 500 }))
    await expect(requestAddressInvoice({ address: 'a@b.co', sats: 1 })).rejects.toMatchObject({ code: 'amount_out_of_range', min: 10, max: 500 })
    fetchMock.mockResolvedValueOnce({ ok: false, status: 502, json: async () => { throw new Error('html') } })
    await expect(requestAddressInvoice({ address: 'a@b.co', sats: 1 })).rejects.toMatchObject({ message: 'HTTP 502', code: 'invoice_failed' })
  })
})

describe('payValueWithWebln', () => {
  const tip = { value: { recipients: [host, cohost, app] }, total: 1000, message: 'Love it', show: 'Show', episode: 'Ep 1', feedUrl: 'https://feed.example/rss', sender: 'alice' }

  it('pays each recipient its share: an invoice for an address, keysend with a boostagram for a node', async () => {
    const webln = fakeWebln()
    const results = await payValueWithWebln(tip)
    expect(webln.enable).toHaveBeenCalledTimes(1)
    expect(results).toEqual([
      { name: '02app', sats: 100, ok: true },
      { name: 'Host', sats: 810, ok: true },
      { name: 'Cohost', sats: 90, ok: true },
    ])
    expect(fetchMock).toHaveBeenCalledWith('/api/lightning/address-invoice?address=host%40getalby.com&sats=810&comment=Love+it')
    expect(webln.sendPayment).toHaveBeenCalledWith('lnbc-host')

    const cohostSend = webln.keysend.mock.calls.find(([a]) => a.destination === '03abc')[0]
    expect(cohostSend.amount).toBe('90')
    expect(cohostSend.customRecords['696969']).toBe('pod1')
    expect(JSON.parse(cohostSend.customRecords['7629169'])).toEqual({
      podcast: 'Show', episode: 'Ep 1', url: 'https://feed.example/rss', action: 'boost', app_name: '3Speak',
      app_version: '1', message: 'Love it', sender_name: 'alice', name: 'Cohost', value_msat: 90000, value_msat_total: 1000000,
    })
  })

  it('leaves empty boostagram fields out', async () => {
    const webln = fakeWebln()
    await payValueWithWebln({ value: { recipients: [{ type: 'node', address: '03x', split: 1 }] }, total: 10 })
    const record = JSON.parse(webln.keysend.mock.calls[0][0].customRecords['7629169'])
    expect(record).toEqual({ action: 'boost', app_name: '3Speak', app_version: '1', value_msat: 10000, value_msat_total: 10000 })
    expect(Object.keys(webln.keysend.mock.calls[0][0].customRecords)).toEqual(['7629169'])
  })

  it('reports a wallet without keysend for node recipients and still pays the address', async () => {
    fakeWebln({ keysend: undefined })
    const results = await payValueWithWebln({ ...tip, value: { recipients: [cohost, host] } })
    expect(results).toEqual([
      { name: 'Cohost', sats: 100, ok: false, error: 'keysend_unsupported' },
      { name: 'Host', sats: 900, ok: true },
    ])
  })

  it('stops asking once the listener cancels in the wallet', async () => {
    const webln = fakeWebln({ sendPayment: vi.fn(async () => { throw new Error('User rejected the payment') }) })
    const results = await payValueWithWebln(tip)
    expect(results.map((r) => [r.name, r.ok])).toEqual([['02app', true], ['Host', false]])
    expect(results[1].error).toBe('User rejected the payment')
    expect(webln.keysend).toHaveBeenCalledTimes(1)
  })

  it('keeps going after an ordinary failure, using the API code when there is one', async () => {
    fakeWebln()
    fetchMock.mockResolvedValue(reply(400, { error: 'no_route' }))
    const results = await payValueWithWebln(tip)
    expect(results.find((r) => r.name === 'Host')).toEqual({ name: 'Host', sats: 810, ok: false, error: 'no_route' })
    expect(results.filter((r) => r.ok)).toHaveLength(2)
  })

  it('names a failure "failed" when the wallet gives no reason', async () => {
    fakeWebln({ keysend: vi.fn(async () => { throw {} }) })
    const [res] = await payValueWithWebln({ value: { recipients: [{ type: 'node', address: '03x', split: 1 }] }, total: 10 })
    expect(res).toEqual({ name: '03x', sats: 10, ok: false, error: 'failed' })
  })
})
