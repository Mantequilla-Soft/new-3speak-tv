// Invite-link reads through 3Speak's own server (src/lib/referralLinks.js).
import { describe, it, expect, vi } from 'vitest'
import { fetchInvite, fetchMyInviteLinks, fetchInvitePeople } from '../../../src/lib/referralLinks.js'

describe('referral link requests', () => {
  it('send cookies to the encoded same-origin endpoints', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ valid: true }) })
    vi.stubGlobal('fetch', f)
    expect(await fetchInvite('ab/c')).toEqual({ valid: true })
    await fetchMyInviteLinks()
    await fetchInvitePeople('id 1')
    expect(f.mock.calls.map((c) => c[0])).toEqual([
      '/api/referral/invite/ab%2Fc',
      '/api/referral/links',
      '/api/referral/links/id%201/people',
    ])
    expect(f.mock.calls.every((c) => c[1].credentials === 'include')).toBe(true)
  })

  it('throws the server error with its status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'Sign in first' }) }))
    await expect(fetchMyInviteLinks()).rejects.toMatchObject({ message: 'Sign in first', status: 401 })
  })

  it('falls back to a generic message when the error body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => { throw new SyntaxError('<') } }))
    await expect(fetchInvite('x')).rejects.toMatchObject({ message: 'Request failed (502)', status: 502 })
  })
})
