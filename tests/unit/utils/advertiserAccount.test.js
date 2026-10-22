// Whether the signed-in account is an advertiser (for the nav's Advertise
// button), remembered in this browser once known (src/utils/advertiserAccount.js).
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'

const fetchWarmupContact = vi.hoisted(() => vi.fn())
vi.mock('../../../src/lib/incubation', () => ({ fetchWarmupContact }))

import {
  rememberAdvertiserAccount,
  isRememberedAdvertiser,
  hasAdvertiserProduct,
  isAdvertiserAccount,
} from '../../../src/utils/advertiserAccount.js'

beforeEach(() => {
  localStorage.clear()
  fetchWarmupContact.mockReset()
})

describe('remembered advertisers', () => {
  it('remembers names case-insensitively, without duplicates', () => {
    rememberAdvertiserAccount('Alice')
    rememberAdvertiserAccount('alice')
    expect(isRememberedAdvertiser('ALICE')).toBe(true)
    expect(JSON.parse(localStorage.getItem('3s-advertiser-accounts'))).toEqual(['alice'])
  })

  it('keeps the last 20', () => {
    for (let i = 0; i < 22; i++) rememberAdvertiserAccount(`u${i}`)
    expect(isRememberedAdvertiser('u0')).toBe(false)
    expect(isRememberedAdvertiser('u21')).toBe(true)
  })

  it('ignores an empty name and corrupt storage', () => {
    rememberAdvertiserAccount('')
    expect(localStorage.getItem('3s-advertiser-accounts')).toBeNull()
    localStorage.setItem('3s-advertiser-accounts', '{bad')
    expect(isRememberedAdvertiser('alice')).toBe(false)
  })
})

describe('hasAdvertiserProduct', () => {
  it('asks the checker and accepts either flag', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ hasProduct: true }) })
    vi.stubGlobal('fetch', f)
    expect(await hasAdvertiserProduct('a b')).toBe(true)
    expect(f).toHaveBeenCalledWith('https://checker.3speak.tv/advertise/has-product/a%20b')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ isAdvertiser: true }) }))
    expect(await hasAdvertiserProduct('a')).toBe(true)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ hasProduct: 'yes' }) }))
    expect(await hasAdvertiserProduct('a')).toBe(false)
  })

  it('says no on an HTTP error or network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    expect(await hasAdvertiserProduct('a')).toBe(false)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    expect(await hasAdvertiserProduct('a')).toBe(false)
  })
})

describe('isAdvertiserAccount', () => {
  it('is false for no user', async () => {
    expect(await isAdvertiserAccount('')).toBe(false)
  })

  it('answers from memory without any lookup', async () => {
    rememberAdvertiserAccount('alice')
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    expect(await isAdvertiserAccount('alice')).toBe(true)
    expect(fetchWarmupContact).not.toHaveBeenCalled()
    expect(f).not.toHaveBeenCalled()
  })

  it('a private contact record with an email is enough, and is remembered', async () => {
    fetchWarmupContact.mockResolvedValue({ email: 'a@b.c' })
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    expect(await isAdvertiserAccount('alice')).toBe(true)
    expect(f).not.toHaveBeenCalled()
    expect(isRememberedAdvertiser('alice')).toBe(true)
  })

  it('falls back to the public lookup when the contact read fails', async () => {
    fetchWarmupContact.mockRejectedValue(new Error('401'))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ hasProduct: true }) }))
    expect(await isAdvertiserAccount('bob')).toBe(true)
  })

  it('says no and remembers nothing when neither source says yes', async () => {
    fetchWarmupContact.mockResolvedValue(null)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))
    expect(await isAdvertiserAccount('carol')).toBe(false)
    expect(isRememberedAdvertiser('carol')).toBe(false)
  })
})
