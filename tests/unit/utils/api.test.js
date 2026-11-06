// The legacy 3Speak API client (src/utils/api.js): checking a token and reading
// the username, false or null on any failure. axios is mocked.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const inst = { post: vi.fn(), get: vi.fn() }
  return { inst, create: vi.fn(() => inst) }
})
vi.mock('axios', () => ({ default: { create: h.create } }))
vi.mock('../../../src/utils/config', () => ({ API_URL_FROM_WEST: 'https://api.example' }))

import { api } from '../../../src/utils/api.js'

// Read before the per-test mock reset clears it.
const createdWith = h.create.mock.calls[0]

const headers = { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer TOK' } }

beforeEach(() => {
  h.inst.post.mockReset()
  h.inst.get.mockReset()
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

it('talks to the configured API', () => {
  expect(createdWith).toEqual([{ baseURL: 'https://api.example' }])
})

describe('checkAuthentication', () => {
  it('sends the bearer token and returns the ok flag', async () => {
    h.inst.post.mockResolvedValue({ data: { ok: true } })
    expect(await api.auth.checkAuthentication('TOK')).toBe(true)
    expect(h.inst.post).toHaveBeenCalledWith('/v1/auth/check', {}, headers)
  })

  it('is false when the request fails', async () => {
    h.inst.post.mockRejectedValue(new Error('401'))
    expect(await api.auth.checkAuthentication('TOK')).toBe(false)
  })
})

describe('getUserDetails', () => {
  it('returns the username for the token', async () => {
    h.inst.get.mockResolvedValue({ data: { username: 'alice' } })
    expect(await api.auth.getUserDetails('TOK')).toBe('alice')
    expect(h.inst.get).toHaveBeenCalledWith('/v1/profile', headers)
  })

  it('is null when the request fails', async () => {
    h.inst.get.mockRejectedValue(new Error('500'))
    expect(await api.auth.getUserDetails('TOK')).toBeNull()
  })
})
