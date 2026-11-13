// "Not interested" and "don't show this creator" (src/utils/userFilters.js).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const axios = vi.hoisted(() => ({ post: vi.fn(), delete: vi.fn(), get: vi.fn() }))
vi.mock('axios', () => ({ default: axios }))
vi.mock('../../../src/utils/config', () => ({ CHECKER_URL: 'https://checker.test' }))

const m = await import('../../../src/utils/userFilters.js')

beforeEach(() => {
  for (const fn of Object.values(axios)) { fn.mockReset(); fn.mockResolvedValue({ data: {} }) }
  vi.spyOn(console, 'error').mockImplementation(() => {})
  m._resetDismissals()
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

  it('reports a server failure as false instead of throwing, after one retry for a hide', async () => {
    vi.useFakeTimers()
    try {
      axios.post.mockRejectedValue(new Error('500'))
      axios.delete.mockRejectedValue(new Error('500'))
      const hv = m.hideVideo('me', 'alice', 'vid')
      const hc = m.hideCreator('me', 'alice')
      await vi.advanceTimersByTimeAsync(3100)
      expect(await hv).toBe(false)
      expect(await hc).toBe(false)
      expect(axios.post).toHaveBeenCalledTimes(4) // each hide tried twice
      expect(await m.unhideVideo('me', 'alice', 'vid')).toBe(false)
      expect(await m.unhideCreator('me', 'alice')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a hide that fails once is saved by the retry', async () => {
    vi.useFakeTimers()
    try {
      axios.post.mockRejectedValueOnce(new Error('blip')).mockResolvedValue({ data: {} })
      const hv = m.hideVideo('me', 'alice', 'vid')
      await vi.advanceTimersByTimeAsync(3100)
      expect(await hv).toBe(true)
      expect(axios.post).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
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

// Issue #565: one list of dismissals for the whole visit, so a "Not interested"
// video stays gone in every grid, also after a grid remounts on a cached feed.
describe('the shared dismissal list', () => {
  const card = (author, permlink, extra = {}) => ({ author, permlink, ...extra })

  it('a hidden video is dismissed at once, and back after Undo', async () => {
    expect(m.isDismissed(card('alice', 'vid'))).toBe(false)
    m.hideVideo('me', 'Alice', 'vid')
    expect(m.isDismissed(card('alice', 'vid'))).toBe(true)
    expect(m.isDismissed(card('alice', 'other'))).toBe(false)
    m.unhideVideo('me', 'alice', 'vid')
    expect(m.isDismissed(card('alice', 'vid'))).toBe(false)
  })

  it('a hidden creator takes all their videos, by author or by owner', () => {
    m.hideCreator('me', '@Bob')
    expect(m.isDismissed(card('bob', 'a'))).toBe(true)
    expect(m.isDismissed(card({ username: 'bob' }, 'b'))).toBe(true)
    expect(m.isDismissed(card('someone', 'c', { owner: 'bob' }))).toBe(true)
    m.unhideCreator('me', 'bob')
    expect(m.isDismissed(card('bob', 'a'))).toBe(false)
  })

  it('loads the saved dismissals once per account', async () => {
    axios.get.mockResolvedValue({ data: { videos: [{ owner: 'Carol', permlink: 'p1' }], creators: [{ creator: 'dave' }] } })
    await m.loadDismissals('me')
    await m.loadDismissals('me')
    expect(axios.get).toHaveBeenCalledTimes(1)
    expect(m.isDismissed(card('carol', 'p1'))).toBe(true)
    expect(m.isDismissed(card('dave', 'anything'))).toBe(true)
  })

  it('another account starts from its own list', async () => {
    m.hideVideo('me', 'alice', 'vid')
    axios.get.mockResolvedValue({ data: { videos: [], creators: [] } })
    await m.loadDismissals('someone-else')
    expect(m.isDismissed(card('alice', 'vid'))).toBe(false)
  })
})
