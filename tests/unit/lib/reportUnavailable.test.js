// Reporting a video whose media is gone (src/lib/reportUnavailable.js): sent at
// most once per video per page, best effort, and the card is only removed when
// the checker itself agrees the video is dead. fetch is stubbed.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ markDead: vi.fn() }))
vi.mock('../../../src/utils/config', () => ({ CHECKER_URL: 'https://checker.example' }))
vi.mock('../../../src/lib/deadVideos', () => ({ markVideoDead: h.markDead }))

const reply = (status, body) => ({ ok: status < 300, status, json: async () => body })
const flush = () => new Promise((r) => setTimeout(r, 0))

let report
let fetchMock
beforeEach(async () => {
  vi.resetModules()
  h.markDead.mockReset()
  fetchMock = vi.fn(async () => reply(200, { banned: false }))
  vi.stubGlobal('fetch', fetchMock)
  ;({ reportVideoUnavailable: report } = await import('../../../src/lib/reportUnavailable.js'))
})

describe('reportVideoUnavailable', () => {
  it('tells the checker, surviving navigation away from the page', () => {
    report('alice', 'v1', 'https://hot.example/v1/manifest.m3u8')
    expect(fetchMock).toHaveBeenCalledWith('https://checker.example/video/report-unavailable', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
      body: JSON.stringify({ author: 'alice', permlink: 'v1', url: 'https://hot.example/v1/manifest.m3u8' }),
    })
  })

  it('reports a video once per page load', () => {
    report('alice', 'v1')
    report('alice', 'v1')
    report('alice', 'v2')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).url).toBeNull()
  })

  it.each([['', 'v1'], ['alice', ''], ['unknown', 'v1']])('ignores an incomplete reference (%j, %j)', (author, permlink) => {
    report(author, permlink)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('removes the card only on the checker\'s verdict', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { banned: true })).mockResolvedValueOnce(reply(200, { banned: false })).mockResolvedValueOnce(reply(500, { banned: true }))
    report('alice', 'dead')
    report('alice', 'alive')
    report('alice', 'error')
    await flush()
    expect(h.markDead.mock.calls).toEqual([['alice', 'dead']])
  })

  it('swallows every failure', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('offline'))
    expect(() => report('alice', 'a')).not.toThrow()
    fetchMock.mockImplementationOnce(() => { throw new Error('sync') })
    expect(() => report('alice', 'b')).not.toThrow()
    await flush()
    expect(h.markDead).not.toHaveBeenCalled()
  })
})
