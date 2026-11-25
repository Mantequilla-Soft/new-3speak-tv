// ⏳ The free plan's daily PUBLISH limit (src/lib/publishQuota.js): reading the
// checker's GET /publish-quota (fail open: any failure is "no limit known"),
// its 429 told apart by `code` (a plain 429 is a rate limit), and the wording.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../src/utils/scheduledPosts', () => ({ SCHEDULED_CHECKER_BASE: 'https://checker.test/' }))

const q = await import('../../../src/lib/publishQuota.js')
const ok = (data) => ({ ok: true, json: async () => data })
// t() that echoes its key and options, like the app's tests elsewhere
const t = (key, opts) => (opts ? `${key} ${JSON.stringify(opts)}` : key)

const AT = '2026-11-25T14:00:00.000Z'
const TAKEN = {
  success: true, enabled: true, exempt: false, reason: null, kind: 'video', limit: 1, window_hours: 24, at: AT,
  allowed: false,
  conflicts: [
    { permlink: 'my-trip', title: 'My trip', at: '2026-11-25T09:30:00.000Z', scheduled: false },
    { permlink: 'next', title: '', at: '2026-11-26T08:00:00.000Z', scheduled: true },
  ],
  next_free_at: '2026-11-27T08:00:00.000Z',
}

let fetchMock
beforeEach(() => {
  fetchMock = vi.fn(async () => ok(TAKEN))
  vi.stubGlobal('fetch', fetchMock)
  q.refreshPublishQuota()
})

describe('normalizePublishQuota', () => {
  it('a taken time: times in ms, the conflicts oldest first as sent', () => {
    expect(q.normalizePublishQuota(TAKEN)).toEqual({
      exempt: false, reason: null, kind: 'video', limit: 1, at: Date.parse(AT), allowed: false,
      conflicts: [
        { permlink: 'my-trip', title: 'My trip', at: Date.parse('2026-11-25T09:30:00.000Z'), scheduled: false },
        { permlink: 'next', title: '', at: Date.parse('2026-11-26T08:00:00.000Z'), scheduled: true },
      ],
      nextFreeAt: Date.parse('2026-11-27T08:00:00.000Z'),
    })
  })

  it('fails open: off, unreadable or without an answer is null; exempt is trusted', () => {
    expect(q.normalizePublishQuota(null)).toBeNull()
    expect(q.normalizePublishQuota({ enabled: false, exempt: false, allowed: true })).toBeNull()
    expect(q.normalizePublishQuota({ enabled: true, exempt: false })).toBeNull()
    expect(q.normalizePublishQuota({ enabled: true, exempt: true, reason: 'pro' })).toEqual({ exempt: true, reason: 'pro' })
    expect(q.isPublishBlocked(q.normalizePublishQuota({ enabled: true, exempt: true, reason: 'pro', allowed: false }))).toBe(false)
  })

  it('drops conflicts without a time', () => {
    expect(q.normalizePublishQuota({ ...TAKEN, conflicts: [{ title: 'x' }, null, TAKEN.conflicts[0]] }).conflicts).toHaveLength(1)
  })
})

describe('fetchPublishQuota / loadPublishQuota', () => {
  it('asks for the owner, kind, time and the post left out', async () => {
    const v = await q.fetchPublishQuota('badadib', { kind: 'short', at: Date.parse(AT), exclude: 'my-trip' })
    const url = new URL(fetchMock.mock.calls[0][0])
    expect(url.origin + url.pathname).toBe('https://checker.test/publish-quota/badadib')
    expect(Object.fromEntries(url.searchParams)).toEqual({ kind: 'short', at: AT, exclude: 'my-trip' })
    expect(v.allowed).toBe(false)
  })

  it('"now" sends no time; a picker value is read as local time', async () => {
    await q.fetchPublishQuota('badadib')
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.has('at')).toBe(false)
    await q.fetchPublishQuota('badadib', { at: '2026-11-30T10:15' })
    expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get('at')).toBe(new Date(2026, 10, 30, 10, 15).toISOString())
  })

  it('fails open: 404 (not deployed), a network error, success:false, no owner', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) })
    expect(await q.fetchPublishQuota('badadib')).toBeNull()
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    expect(await q.fetchPublishQuota('badadib')).toBeNull()
    fetchMock.mockResolvedValueOnce(ok({ success: false, error: 'bad kind' }))
    expect(await q.fetchPublishQuota('badadib')).toBeNull()
    expect(await q.fetchPublishQuota('')).toBeNull()
  })

  it('one read per owner, kind, time and excluded post; refresh reads again and tells listeners', async () => {
    await q.loadPublishQuota('badadib', { kind: 'video' })
    await q.loadPublishQuota('BadAdib', { kind: 'video' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await q.loadPublishQuota('badadib', { kind: 'short' })
    await q.loadPublishQuota('badadib', { kind: 'video', exclude: 'my-trip' })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const heard = vi.fn()
    const off = q.subscribePublishQuota(heard)
    q.refreshPublishQuota()
    expect(heard).toHaveBeenCalledTimes(1)
    off()
    await q.loadPublishQuota('badadib', { kind: 'video' })
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })
})

describe('refusals (429 from the scheduled-posts routes)', () => {
  const body = { error: 'Daily publish limit reached', code: 'daily_publish_limit', kind: 'video', limit: 1, conflicts: TAKEN.conflicts, next_free_at: TAKEN.next_free_at, upgrade_url: 'https://3speak.tv/wallet/badadib#pro' }

  it('the limit is told apart from a rate limit', () => {
    expect(q.parsePublishLimit(429, body)).toMatchObject({ code: 'daily_publish_limit', kind: 'video', limit: 1, allowed: false, nextFreeAt: Date.parse(TAKEN.next_free_at) })
    expect(q.parsePublishLimit(429, { error: 'Too many requests' })).toBeNull()
    expect(q.parsePublishLimit(400, body)).toBeNull()
    expect(q.publishLimitFromError({ response: { status: 429, data: body } }).conflicts).toHaveLength(2)
    expect(q.publishLimitFromError(new Error('offline'))).toBeNull()
  })

  it('a refusal is a blocked answer for the same wording', () => {
    expect(q.isPublishBlocked(q.parsePublishLimit(429, body))).toBe(true)
  })
})

describe('wording', () => {
  const info = q.normalizePublishQuota(TAKEN)
  const time = (iso) => q.formatPublishTime(Date.parse(iso), 'en')

  it('the time in the reader\'s language, like the scheduling UI', () => {
    expect(q.formatPublishTime(Date.parse(AT), 'en')).toBe(new Date(AT).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' }))
    expect(q.formatPublishTime(NaN, 'en')).toBe('')
  })

  it('a scheduled time: taken, the rule, each publish that takes it, the earliest free time', () => {
    expect(q.publishLimitMessage(t, info, 'en')).toBe([
      'publishLimits.timeTaken',
      'publishLimits.rule.video {"count":1}',
      `publishLimits.conflict.published {"title":"My trip","time":"${time('2026-11-25T09:30:00.000Z')}"}`,
      `publishLimits.conflict.scheduledUntitled {"time":"${time('2026-11-26T08:00:00.000Z')}"}`,
      `publishLimits.earliest {"time":"${time(TAKEN.next_free_at)}"}`,
    ].join(' '))
  })

  it('"publish now" says so; no next free time asks for a later one; Shorts keep their own rule', () => {
    expect(q.publishLimitMessage(t, info, 'en', { now: true })).toMatch(/^publishLimits\.nowTaken /)
    expect(q.nextFreeText(t, { ...info, nextFreeAt: null }, 'en')).toBe('publishLimits.later')
    expect(q.publishRuleText(t, { kind: 'short', limit: 3 })).toBe('publishLimits.rule.short {"count":3}')
    expect(q.publishRuleText(t, { kind: 'short' })).toBe('publishLimits.rule.short {"count":3}')
  })

  it('the free time as a picker value: rounded up to the minute, never before the picker\'s earliest', () => {
    const free = new Date(2026, 10, 27, 8, 0, 30).getTime()
    expect(q.nextFreeLocalValue(free)).toBe('2026-11-27T08:01')
    expect(q.nextFreeLocalValue(new Date(2026, 10, 27, 8, 0, 0).getTime())).toBe('2026-11-27T08:00')
    expect(q.nextFreeLocalValue(free, new Date(2026, 10, 27, 9, 0).getTime())).toBe('2026-11-27T09:00')
    expect(q.nextFreeLocalValue(null)).toBe('')
  })
})
