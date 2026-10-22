// Reshares client (src/utils/reshares.js): request shapes and the safe
// fallbacks when the playlists API is unreachable.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ axios: { get: vi.fn(), put: vi.fn(), delete: vi.fn() } }))
vi.mock('axios', () => ({ default: h.axios }))
vi.mock('../../../src/utils/config', () => ({ PLAYLISTS_API_URL: 'https://pl.example/api' }))

import {
  recordReshare, getResharesForVideo, getReshareCount, hasUserReshared, deleteReshare,
} from '../../../src/utils/reshares.js'

const down = () => Promise.reject(new Error('down'))

beforeEach(() => {
  Object.values(h.axios).forEach((f) => f.mockReset())
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('reshares', () => {
  it('recordReshare PUTs the triple and returns the answer', async () => {
    h.axios.put.mockResolvedValue({ data: { ok: true } })
    expect(await recordReshare('me', 'a', 'p')).toEqual({ ok: true })
    expect(h.axios.put).toHaveBeenCalledWith('https://pl.example/api/reshares', { username: 'me', author: 'a', permlink: 'p' })
  })

  it('getResharesForVideo pages and defaults missing fields', async () => {
    h.axios.get.mockResolvedValueOnce({ data: { reshares: [{ username: 'x' }], count: 1 } })
    expect(await getResharesForVideo('a', 'p', 5, 10)).toEqual({ reshares: [{ username: 'x' }], count: 1 })
    expect(h.axios.get).toHaveBeenCalledWith('https://pl.example/api/reshares/a/p?limit=5&offset=10')
    h.axios.get.mockResolvedValueOnce({ data: {} })
    expect(await getResharesForVideo('a', 'p')).toEqual({ reshares: [], count: 0 })
  })

  it('getReshareCount and hasUserReshared read their endpoints', async () => {
    h.axios.get.mockResolvedValueOnce({ data: { count: 4 } })
    expect(await getReshareCount('a', 'p')).toBe(4)
    expect(h.axios.get).toHaveBeenLastCalledWith('https://pl.example/api/reshares/a/p/count')
    h.axios.get.mockResolvedValueOnce({ data: { reshared: true, reshared_at: 9 } })
    expect(await hasUserReshared('me', 'a', 'p')).toEqual({ reshared: true, reshared_at: 9 })
    expect(h.axios.get).toHaveBeenLastCalledWith('https://pl.example/api/reshares/me/a/p')
  })

  it('deleteReshare reports success', async () => {
    h.axios.delete.mockResolvedValue({})
    expect(await deleteReshare('me', 'a', 'p')).toBe(true)
    expect(h.axios.delete).toHaveBeenCalledWith('https://pl.example/api/reshares/me/a/p')
  })

  it('missing input never reaches the network', async () => {
    expect(await recordReshare('me', 'a', '')).toBeNull()
    expect(await getResharesForVideo('', 'p')).toEqual({ reshares: [], count: 0 })
    expect(await getReshareCount('a', '')).toBe(0)
    expect(await hasUserReshared('', 'a', 'p')).toEqual({ reshared: false })
    expect(await deleteReshare('me', '', 'p')).toBe(false)
    for (const f of Object.values(h.axios)) expect(f).not.toHaveBeenCalled()
  })

  it('a failed request falls back instead of throwing', async () => {
    Object.values(h.axios).forEach((f) => f.mockImplementation(down))
    expect(await recordReshare('me', 'a', 'p')).toBeNull()
    expect(await getResharesForVideo('a', 'p')).toEqual({ reshares: [], count: 0 })
    expect(await getReshareCount('a', 'p')).toBe(0)
    expect(await hasUserReshared('me', 'a', 'p')).toEqual({ reshared: false })
    expect(await deleteReshare('me', 'a', 'p')).toBe(false)
  })
})
