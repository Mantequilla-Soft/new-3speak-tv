// The home Spotlight's page loading (src/lib/featuredPages.js) and the requests
// index.html starts before the app loads (src/lib/earlyFetch.js).
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fetchFeaturedPages } from '../../../src/lib/featuredPages.js'
import { takeEarly, featuredEarlyKey } from '../../../src/lib/earlyFetch.js'

const HOUR = 3600 * 1000
const NOW = Date.UTC(2026, 10, 12, 12)
// `n` videos, the first `hoursOld` hours old, one hour older each.
const page = (n, hoursOld) => ({ videos: Array.from({ length: n }, (_, i) => ({ created: new Date(NOW - (hoursOld + i) * HOUR).toISOString() })) })
const createdAt = (v) => new Date(v.created).getTime()
const since = NOW - 48 * HOUR
const opts = (getPage, extra = {}) => ({ getPage, showNsfw: false, since, pageSize: 3, maxPages: 3, createdAt, ...extra })

beforeEach(() => { delete window.__early })

describe('fetchFeaturedPages', () => {
  it('asks for pages 1 and 2 at once, before page 1 has answered', async () => {
    let release
    const gate = new Promise((r) => { release = r })
    const getPage = vi.fn(async (p) => { await gate; return p === 1 ? page(3, 0) : page(3, 60) })
    const done = fetchFeaturedPages(opts(getPage))
    expect(getPage.mock.calls.map((c) => c[0])).toEqual([1, 2])
    release()
    expect(await done).toHaveLength(6)
  })

  it('stops at the page that reaches back past the window (page 2 unused)', async () => {
    const getPage = vi.fn(async (p) => (p === 1 ? page(3, 47) : page(3, 50)))
    const all = await fetchFeaturedPages(opts(getPage))
    expect(all).toHaveLength(3)
    expect(getPage).not.toHaveBeenCalledWith(3)
  })

  it('a short page ends it, and an unneeded page 2 failing is no error', async () => {
    const getPage = vi.fn(async (p) => { if (p === 2) throw new Error('down'); return page(2, 0) })
    expect(await fetchFeaturedPages(opts(getPage))).toHaveLength(2)
  })

  it('goes on to page 3 one at a time when 1 and 2 are both inside the window', async () => {
    const getPage = vi.fn(async (p) => page(3, (p - 1) * 3))
    const all = await fetchFeaturedPages(opts(getPage))
    expect(all).toHaveLength(9)
    expect(getPage.mock.calls.map((c) => c[0])).toEqual([1, 2, 3])
  })

  it('a page 2 that is needed and fails fails the whole load, as before', async () => {
    const getPage = vi.fn(async (p) => { if (p === 2) throw new Error('down'); return page(3, 0) })
    await expect(fetchFeaturedPages(opts(getPage))).rejects.toThrow('down')
  })

  it('uses the early requests from index.html instead of asking again', async () => {
    window.__early = { [featuredEarlyKey(1, false)]: Promise.resolve(page(3, 0)), [featuredEarlyKey(2, false)]: Promise.resolve(page(3, 60)) }
    const getPage = vi.fn()
    expect(await fetchFeaturedPages(opts(getPage))).toHaveLength(6)
    expect(getPage).not.toHaveBeenCalled()
  })

  it('an early request that failed is asked for again', async () => {
    window.__early = { [featuredEarlyKey(1, false)]: Promise.reject(new Error('blocked')) }
    const getPage = vi.fn(async () => page(2, 0))
    expect(await fetchFeaturedPages(opts(getPage))).toHaveLength(2)
    expect(getPage).toHaveBeenCalledWith(1)
  })

  it('never takes an early page made for the other nsfw setting', async () => {
    window.__early = { [featuredEarlyKey(1, false)]: Promise.resolve(page(2, 0)) }
    const getPage = vi.fn(async () => page(1, 0))
    expect(await fetchFeaturedPages(opts(getPage, { showNsfw: true }))).toHaveLength(1)
    expect(getPage).toHaveBeenCalledWith(1)
  })
})

describe('takeEarly', () => {
  it('hands a request over once', () => {
    const p = Promise.resolve(1)
    window.__early = { a: p }
    expect(takeEarly('a')).toBe(p)
    expect(takeEarly('a')).toBe(null)
  })

  it('drops a request made too long ago', () => {
    window.__early = { a: Promise.resolve(1) }
    vi.spyOn(performance, 'now').mockReturnValue(61_000)
    expect(takeEarly('a')).toBe(null)
    vi.restoreAllMocks()
  })

  it('nothing started: null', () => {
    expect(takeEarly('a')).toBe(null)
  })
})
