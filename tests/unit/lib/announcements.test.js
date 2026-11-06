// @vitest-environment jsdom
// Team announcements (src/lib/announcements.js): remembering which one a
// browser (or a given account) has seen, fetching the general and the personal
// announcement with a proof of identity from our API, and sending replies.
// fetch and the login provider are mocked.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ provider: vi.fn() }))
vi.mock('../../../src/utils/config', () => ({ CHECKER_URL: 'https://checker.example' }))
vi.mock('../../../src/hive-api/aioha', () => ({ getCurrentProvider: h.provider, Providers: { HiveSigner: 'hivesigner' } }))
vi.mock('../../../src/version', () => ({ APP_VERSION: '9.9.9' }))

import {
  readSeenAnnouncement, markAnnouncementSeen, fetchAnnouncements, sendAnnouncementReply,
} from '../../../src/lib/announcements.js'

const reply = (status, body) => ({ ok: status < 300, status, json: async () => body })
const PROOF = { username: 'alice', signature: 'SIG', timestamp: 123 }

let fetchMock
let routes
beforeEach(() => {
  localStorage.clear()
  h.provider.mockReset().mockReturnValue('keychain')
  routes = {}
  fetchMock = vi.fn(async (url) => {
    const r = routes[url]
    if (r instanceof Error) throw r
    return r ?? reply(404, {})
  })
  vi.stubGlobal('fetch', fetchMock)
})

describe('seen markers', () => {
  it('starts at 0 and only moves forward', () => {
    expect(readSeenAnnouncement()).toBe(0)
    markAnnouncementSeen(5)
    markAnnouncementSeen(3)
    expect(readSeenAnnouncement()).toBe(5)
  })

  it('keeps a separate marker per account for personal announcements', () => {
    markAnnouncementSeen(7, 'alice')
    expect(readSeenAnnouncement('alice')).toBe(7)
    expect(readSeenAnnouncement('bob')).toBe(0)
    expect(readSeenAnnouncement()).toBe(0)
  })

  it('reads as unknown (null) when storage is blocked, and marking never throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    expect(readSeenAnnouncement()).toBeNull()
    expect(() => markAnnouncementSeen(1)).not.toThrow()
  })
})

describe('fetchAnnouncements', () => {
  it('signed out: a plain GET, general announcement only', async () => {
    routes['https://checker.example/announcements/latest'] = reply(200, { announcement: { number: 3 } })
    expect(await fetchAnnouncements(null)).toEqual({ announcement: { number: 3 }, personal: null })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]).toEqual(['https://checker.example/announcements/latest'])
  })

  it('signed in and proven: posts the proof and gets the personal announcement too', async () => {
    routes['/api/announcements/read-signature'] = reply(200, PROOF)
    routes['https://checker.example/announcements/latest'] = reply(200, { announcement: { number: 3 }, personal: { number: 4 } })
    expect(await fetchAnnouncements('Alice')).toEqual({ announcement: { number: 3 }, personal: { number: 4 } })
    const [vouchUrl, vouchInit] = fetchMock.mock.calls[0]
    expect(vouchUrl).toBe('/api/announcements/read-signature')
    expect(vouchInit).toMatchObject({ method: 'POST', credentials: 'include', body: '{}' })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ username: 'alice', signature: 'SIG', timestamp: 123 })
  })

  it('a HiveSigner login sends its token to get vouched for', async () => {
    h.provider.mockReturnValue('hivesigner')
    localStorage.setItem('hivesignerToken', 'TOK')
    routes['/api/announcements/read-signature'] = reply(200, PROOF)
    await fetchAnnouncements('alice')
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer TOK')
  })

  it.each([
    ['the server vouches for a different account', reply(200, { ...PROOF, username: 'mallory' })],
    ['the server cannot vouch', reply(401, {})],
    ['the answer has no signature', reply(200, { username: 'alice' })],
    ['the API is down', new TypeError('offline')],
  ])('falls back to the general announcement when %s', async (_name, vouch) => {
    routes['/api/announcements/read-signature'] = vouch
    routes['https://checker.example/announcements/latest'] = reply(200, { announcement: { number: 1 } })
    expect(await fetchAnnouncements('alice')).toEqual({ announcement: { number: 1 }, personal: null })
    expect(fetchMock.mock.calls[1]).toEqual(['https://checker.example/announcements/latest'])
  })

  it('reads a failing checker as no announcements', async () => {
    routes['https://checker.example/announcements/latest'] = reply(503, {})
    expect(await fetchAnnouncements()).toEqual({ announcement: null, personal: null })
    routes['https://checker.example/announcements/latest'] = { ok: true, status: 200, json: async () => { throw new Error('html') } }
    expect(await fetchAnnouncements()).toEqual({ announcement: null, personal: null })
  })
})

describe('sendAnnouncementReply', () => {
  it('sends the text, proof and app version', async () => {
    routes['/api/announcements/reply-signature'] = reply(200, PROOF)
    routes['https://checker.example/announcements/4/replies'] = reply(201, {})
    await sendAnnouncementReply(4, 'Thanks!', 'ALICE')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ number: 4 })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      text: 'Thanks!', username: 'alice', signature: 'SIG', timestamp: 123, app_version: '9.9.9',
    })
  })

  it('sends an anonymous reply without asking for proof', async () => {
    routes['https://checker.example/announcements/4/replies'] = reply(200, {})
    await sendAnnouncementReply(4, 'hi', '')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ text: 'hi', username: null, app_version: '9.9.9' })
  })

  it('throws with the HTTP status so the popup can explain a rate limit', async () => {
    routes['https://checker.example/announcements/4/replies'] = reply(429, {})
    await expect(sendAnnouncementReply(4, 'hi')).rejects.toMatchObject({ message: 'reply failed (429)', status: 429 })
  })
})
