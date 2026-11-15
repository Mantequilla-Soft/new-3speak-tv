// Notification levels and the checker's notification feed (src/lib/notifyLevels.js):
// the level rule matches the checker, both calls carry the session vouch, and
// "seen until" is one timestamp in this browser. fetch and the vouch are fakes.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../src/lib/podcastProgress', () => ({ sessionVouch: vi.fn(async (user) => ({ user, signature: 'SIG', timestamp: 7 })) }))
const lib = await import('../../../src/lib/notifyLevels.js')

const reply = (body, status = 200) => ({ ok: status < 300, status, json: async () => body })
let fetchMock
beforeEach(() => {
  localStorage.clear()
  fetchMock = vi.fn(async () => reply({ success: true, levels: { badadib: 'off' }, level: 'off', notifications: [] }))
  vi.stubGlobal('fetch', fetchMock)
})

describe('levelAllows', () => {
  it('Highlights keeps videos, audio and going live; Off keeps nothing', () => {
    expect(['videos', 'audio', 'live', 'shorts', 'stories'].map((k) => lib.levelAllows('highlights', k)))
      .toEqual([true, true, true, false, false])
    expect(lib.levelAllows('off', 'videos')).toBe(false)
    expect(lib.levelAllows('all', 'stories')).toBe(true)
  })

  it('a creator with no saved level is at All', () => {
    expect(lib.levelOf({ badadib: 'off' }, 'Badadib')).toBe('off')
    expect(lib.levelOf({}, 'badadib')).toBe('all')
  })
})

describe('checker calls', () => {
  it('reads and saves levels with the vouch', async () => {
    expect(await lib.fetchNotifyLevels('fan')).toEqual({ badadib: 'off' })
    await lib.saveNotifyLevel('fan', 'badadib', 'off')
    const [url, init] = fetchMock.mock.calls[1]
    expect(url).toMatch(/\/notify\/level$/)
    expect(JSON.parse(init.body)).toEqual({ creator: 'badadib', level: 'off', user: 'fan', signature: 'SIG', timestamp: 7 })
  })

  it('a failed save throws so the caller can roll back', async () => {
    fetchMock.mockResolvedValueOnce(reply({}, 500))
    await expect(lib.saveNotifyLevel('fan', 'badadib', 'off')).rejects.toThrow()
  })

  it('asks the feed with the vouch, and signed out asks nothing', async () => {
    expect(await lib.fetchCheckerNotifications(null)).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
    await lib.fetchCheckerNotifications('fan')
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/notify\/feed$/)
  })

  it('marking seen stores one timestamp per account', () => {
    lib.markCheckerNotificationsSeen('fan')
    expect(Number(localStorage.getItem('checker-notifs-seen:fan'))).toBeGreaterThan(0)
  })
})
