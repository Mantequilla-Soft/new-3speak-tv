// "Not interested" and "don't show this creator" (src/utils/userFilters.js).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const axios = vi.hoisted(() => ({ post: vi.fn(), delete: vi.fn(), get: vi.fn() }))
vi.mock('axios', () => ({ default: axios }))
vi.mock('../../../src/utils/config', () => ({ CHECKER_URL: 'https://checker.test' }))

const m = await import('../../../src/utils/userFilters.js')

beforeEach(() => {
  for (const fn of Object.values(axios)) { fn.mockReset(); fn.mockResolvedValue({ data: {} }) }
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('user feed filters', () => {
  it('hides and unhides one video', async () => {
    expect(await m.hideVideo('me', 'alice', 'vid')).toBe(true)
    expect(axios.post).toHaveBeenCalledWith('https://checker.test/user/hide-video', { username: 'me', owner: 'alice', permlink: 'vid' })
    expect(await m.unhideVideo('me', 'alice', 'vid')).toBe(true)
    expect(axios.delete).toHaveBeenCalledWith('https://checker.test/user/hide-video', { data: { username: 'me', owner: 'alice', permlink: 'vid' } })
  })

  it('hides and unhides a creator', async () => {
    expect(await m.hideCreator('me', 'alice')).toBe(true)
    expect(axios.post).toHaveBeenCalledWith('https://checker.test/user/hide-creator', { username: 'me', creator: 'alice' })
    expect(await m.unhideCreator('me', 'alice')).toBe(true)
    expect(axios.delete).toHaveBeenCalledWith('https://checker.test/user/hide-creator', { data: { username: 'me', creator: 'alice' } })
  })

  it('does not call the server with a missing field', async () => {
    expect(await m.hideVideo('me', 'alice', '')).toBe(false)
    expect(await m.unhideVideo('', 'alice', 'vid')).toBe(false)
    expect(await m.hideCreator('me', null)).toBe(false)
    expect(await m.unhideCreator(undefined, 'alice')).toBe(false)
    expect(axios.post).not.toHaveBeenCalled()
    expect(axios.delete).not.toHaveBeenCalled()
  })

  it('reports a server failure as false instead of throwing', async () => {
    axios.post.mockRejectedValue(new Error('500'))
    axios.delete.mockRejectedValue(new Error('500'))
    expect(await m.hideVideo('me', 'alice', 'vid')).toBe(false)
    expect(await m.hideCreator('me', 'alice')).toBe(false)
    expect(await m.unhideVideo('me', 'alice', 'vid')).toBe(false)
    expect(await m.unhideCreator('me', 'alice')).toBe(false)
  })

  it('lists what a user dismissed, empty on failure', async () => {
    axios.get.mockResolvedValue({ data: { videos: [{ permlink: 'x' }], creators: ['bob'] } })
    expect(await m.getHidden('me/you')).toEqual({ videos: [{ permlink: 'x' }], creators: ['bob'] })
    expect(axios.get).toHaveBeenCalledWith('https://checker.test/user/hidden/me%2Fyou')
    axios.get.mockResolvedValue({ data: null })
    expect(await m.getHidden('me')).toEqual({ videos: [], creators: [] })
    axios.get.mockRejectedValue(new Error('down'))
    expect(await m.getHidden('me')).toEqual({ videos: [], creators: [] })
    expect(await m.getHidden('')).toEqual({ videos: [], creators: [] })
  })
})
