// Boosts and streamed sats (src/lib/boosts.js): the memo format the checker reads,
// the stream settings, the monthly cap, and one streamed minute through WebLN.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../../src/lib/lightningTip', () => ({
  requestLightningInvoice: vi.fn(async ({ sats }) => ({ pr: 'lnbc1stream', sats })),
  hasWebln: () => !!globalThis.window?.webln,
}))
const lt = await import('../../../src/lib/lightningTip')
const {
  boostMemo, streamComment, readStreamSettings, saveStreamSettings, streamedThisMonth, addStreamed,
  nextStreamPayment, payStreamMinute, DEFAULT_STREAM,
} = await import('../../../src/lib/boosts.js')

const LINK = 'https://3speak.tv/audio/badadib/song'
const store = new Map()
beforeEach(() => {
  store.clear()
  vi.stubGlobal('localStorage', { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) })
})
afterEach(() => vi.unstubAllGlobals())

describe('memo format', () => {
  it('message, link, #boost', () => {
    expect(boostMemo('  Great one ', LINK)).toBe(`Great one ${LINK} #boost`)
    expect(boostMemo('', LINK)).toBe(`${LINK} #boost`)
    expect(boostMemo(`see ${LINK}`, LINK)).toBe(`see ${LINK} #boost`)
    expect(boostMemo('x'.repeat(400), LINK).length).toBe(250 + LINK.length + 8)
  })
  it('streamed minutes say #stream', () => {
    expect(streamComment(LINK)).toBe(`${LINK} #stream`)
  })
})

describe('stream settings and the monthly cap', () => {
  it('off with sane defaults until the listener saves', () => {
    expect(readStreamSettings()).toEqual(DEFAULT_STREAM)
    saveStreamSettings({ enabled: true, satsPerMinute: 21, monthlyCap: 5000 })
    expect(readStreamSettings()).toEqual({ enabled: true, satsPerMinute: 21, monthlyCap: 5000 })
    saveStreamSettings({ enabled: 'yes', satsPerMinute: -4, monthlyCap: 1.5 })
    expect(readStreamSettings()).toEqual(DEFAULT_STREAM)
  })
  it('counts per calendar month', () => {
    const nov = Date.parse('2026-11-20T00:00:00Z')
    addStreamed(30, nov)
    addStreamed(20, nov)
    expect(streamedThisMonth(nov)).toBe(50)
    expect(streamedThisMonth(Date.parse('2026-12-01T00:00:00Z'))).toBe(0)
  })
  it('pays the rate, then what is left, then nothing', () => {
    const s = { enabled: true, satsPerMinute: 10, monthlyCap: 25 }
    expect(nextStreamPayment(s, 0)).toBe(10)
    expect(nextStreamPayment(s, 20)).toBe(5)
    expect(nextStreamPayment(s, 25)).toBe(0)
    expect(nextStreamPayment({ ...s, enabled: false }, 0)).toBe(0)
  })
})

describe('payStreamMinute', () => {
  it('asks for an unwatched invoice with #stream and pays it with WebLN', async () => {
    const webln = { enable: vi.fn(async () => {}), sendPayment: vi.fn(async () => ({ preimage: 'p' })) }
    vi.stubGlobal('window', { webln })
    expect(await payStreamMinute({ to: 'badadib', sats: 10, link: LINK })).toBe(10)
    expect(lt.requestLightningInvoice).toHaveBeenCalledWith({ to: 'badadib', sats: 10, comment: `${LINK} #stream`, watch: false })
    expect(webln.sendPayment).toHaveBeenCalledWith('lnbc1stream')
  })
  it('a refusal in the wallet throws, so the caller stops', async () => {
    vi.stubGlobal('window', { webln: { enable: async () => {}, sendPayment: async () => { throw new Error('User rejected') } } })
    await expect(payStreamMinute({ to: 'badadib', sats: 10, link: LINK })).rejects.toThrow('User rejected')
  })
})
