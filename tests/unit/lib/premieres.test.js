// Premieres on the checker (lib/premieres.js): the shared clock, the state and
// offset everyone plays at, the reads, the vouched writes and the chat merge.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const sessionVouch = vi.hoisted(() => vi.fn())
vi.mock('../../../src/lib/podcastProgress', () => ({ sessionVouch }))
vi.mock('../../../src/utils/config', () => ({ CHECKER_URL: 'https://checker.test' }))

const P = await import('../../../src/lib/premieres')

const premiere = { owner: 'badadib', permlink: 'p1', startAt: '2026-11-15T12:00:00.000Z', chatUntil: '2026-11-15T12:20:00.000Z', duration: 600 }
const at = (iso) => Date.parse(iso)
const ok = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })

beforeEach(() => {
  sessionVouch.mockReset()
  sessionVouch.mockResolvedValue({ user: 'fan', signature: 'sig', timestamp: 1 })
  vi.stubGlobal('fetch', vi.fn())
})

describe('the clock everyone shares', () => {
  it('is the server time against ours, from the middle of the request', () => {
    expect(P.clockSkew('2026-11-15T12:00:10.000Z', at('2026-11-15T12:00:00.000Z'), at('2026-11-15T12:00:02.000Z'))).toBe(9000)
    expect(P.clockSkew(undefined)).toBe(0)
  })

  it('upcoming, live through the chat window, then ended', () => {
    expect(P.premiereState(premiere, at('2026-11-15T11:59:59Z'))).toBe('soon')
    expect(P.premiereState(premiere, at('2026-11-15T12:00:00Z'))).toBe('live')
    expect(P.premiereState(premiere, at('2026-11-15T12:19:59Z'))).toBe('live')
    expect(P.premiereState(premiere, at('2026-11-15T12:20:00Z'))).toBe('ended')
    expect(P.premiereState(null, 0)).toBeNull()
  })

  it('everyone plays the second since the start, until the video ends', () => {
    expect(P.sharedOffset(premiere, at('2026-11-15T12:01:30Z'))).toBe(90)
    expect(P.sharedOffset(premiere, at('2026-11-15T11:59:00Z'))).toBeNull()
    expect(P.sharedOffset(premiere, at('2026-11-15T12:10:00Z'))).toBeNull()
    expect(P.sharedOffset({ ...premiere, duration: 0 }, at('2026-11-15T13:00:00Z'))).toBe(3600)
    expect(P.sharedOffset(null, 0)).toBeNull()
  })
})

describe('reads', () => {
  it('one premiere, or none for a 404, with the clock', async () => {
    fetch.mockResolvedValueOnce(ok({ premiere, now: new Date().toISOString() }))
    const got = await P.fetchPremiere('badadib', 'p1')
    expect(fetch).toHaveBeenCalledWith('https://checker.test/premieres/badadib/p1')
    expect(got.premiere).toEqual(premiere)
    expect(Math.abs(got.skew)).toBeLessThan(1000)
    fetch.mockResolvedValueOnce(ok({ now: new Date().toISOString() }, 404))
    expect((await P.fetchPremiere('badadib', 'x')).premiere).toBeNull()
    fetch.mockResolvedValueOnce(ok({}, 500))
    await expect(P.fetchPremiere('badadib', 'x')).rejects.toThrow('premiere: 500')
  })

  it('the upcoming list, one creator\'s with owner', async () => {
    fetch.mockResolvedValue(ok({ premieres: [premiere], now: new Date().toISOString() }))
    expect((await P.fetchUpcomingPremieres()).premieres).toEqual([premiere])
    expect(fetch).toHaveBeenLastCalledWith('https://checker.test/premieres/upcoming?limit=12')
    await P.fetchUpcomingPremieres({ owner: 'badadib', limit: 5 })
    expect(fetch).toHaveBeenLastCalledWith('https://checker.test/premieres/upcoming?limit=5&owner=badadib')
  })

  it('chat after a time', async () => {
    fetch.mockResolvedValue(ok({ messages: [{ id: 'a' }], removed: ['b'], open: true, state: 'live' }))
    expect(await P.fetchPremiereChat('badadib', 'p1', 123)).toEqual({ messages: [{ id: 'a' }], removed: ['b'], open: true, state: 'live' })
    expect(fetch).toHaveBeenLastCalledWith('https://checker.test/premieres/badadib/p1/chat?after=123')
  })
})

describe('writes carry the session vouch in the body', () => {
  it('Notify me', async () => {
    fetch.mockResolvedValue(ok({ success: true, reminded: true, reminders: 3 }))
    expect(await P.setPremiereReminder('fan', 'badadib', 'p1', true)).toMatchObject({ reminded: true })
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://checker.test/premieres/badadib/p1/remind')
    expect(JSON.parse(init.body)).toEqual({ on: true, user: 'fan', signature: 'sig', timestamp: 1 })
  })

  it('a chat message, and its removal; a refusal carries the status', async () => {
    fetch.mockResolvedValueOnce(ok({ success: true, message: { id: 'm1', text: 'hi' } }, 201))
    expect(await P.sendPremiereChat('fan', 'badadib', 'p1', 'hi')).toEqual({ id: 'm1', text: 'hi' })
    fetch.mockResolvedValueOnce(ok({ error: 'slow down' }, 429))
    await expect(P.sendPremiereChat('fan', 'badadib', 'p1', 'hi')).rejects.toMatchObject({ status: 429 })
    fetch.mockResolvedValueOnce(ok({ success: true }))
    await P.removePremiereChat('fan', 'badadib', 'p1', 'm1')
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toMatchObject({ id: 'm1', user: 'fan' })
  })

  it('without a session nothing is sent', async () => {
    sessionVouch.mockResolvedValue(null)
    await expect(P.setPremiereReminder('fan', 'badadib', 'p1')).rejects.toMatchObject({ code: 'auth' })
    expect(await P.fetchMyPremiereReminders('fan')).toEqual({ reminders: [], due: [] })
    expect(await P.fetchMyPremiereReminders(null)).toEqual({ reminders: [], due: [] })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('my reminders', async () => {
    fetch.mockResolvedValue(ok({ reminders: [premiere], due: [] }))
    expect(await P.fetchMyPremiereReminders('fan')).toEqual({ reminders: [premiere], due: [] })
  })
})

describe('the chat list', () => {
  it('appends new messages in time order, once each, and drops removed ones', () => {
    const m = (id, s) => ({ id, at: new Date(Date.UTC(2026, 10, 15, 12, 0, s)).toISOString() })
    const held = [m('a', 1), m('b', 2)]
    expect(P.mergeChat(held, { messages: [m('c', 3), m('b', 2)], removed: ['a'] }).map((x) => x.id)).toEqual(['b', 'c'])
    expect(P.mergeChat([], { messages: [m('z', 9), m('y', 1)] }).map((x) => x.id)).toEqual(['y', 'z'])
  })
})
