// Scheduled posts (src/utils/scheduledPosts.js): reading them from the checker,
// finding the playable embed for one, and shaping it into a card.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('axios', () => ({ default: { get: h.get } }))

const load = async (env = {}) => {
  vi.resetModules()
  for (const [k, val] of Object.entries(env)) vi.stubEnv(k, val)
  return import('../../../src/utils/scheduledPosts.js')
}

beforeEach(() => {
  h.get.mockReset()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('checker base URL', () => {
  it('defaults to the production checker and drops a trailing slash from an override', async () => {
    expect((await load()).SCHEDULED_CHECKER_BASE).toBe('https://prod-checker.okinoko.io')
    expect((await load({ VITE_SCHEDULED_POSTS_API_URL: 'https://c.example/' })).SCHEDULED_CHECKER_BASE).toBe('https://c.example')
  })
})

describe('fetchScheduledPosts', () => {
  it('asks for the owner\'s still-scheduled posts', async () => {
    const m = await load()
    h.get.mockResolvedValue({ data: { scheduled_posts: [{ permlink: 'a' }] } })
    expect(await m.fetchScheduledPosts('al ice')).toEqual([{ permlink: 'a' }])
    expect(h.get).toHaveBeenCalledWith('https://prod-checker.okinoko.io/scheduled-posts/al%20ice', { params: { status: 'scheduled', limit: 100 } })
  })

  it('is an empty list with no owner, a strange answer or a failed request', async () => {
    const m = await load()
    expect(await m.fetchScheduledPosts('')).toEqual([])
    expect(h.get).not.toHaveBeenCalled()
    h.get.mockResolvedValueOnce({ data: { scheduled_posts: 'x' } })
    expect(await m.fetchScheduledPosts('bob')).toEqual([])
    h.get.mockRejectedValueOnce(new Error('down'))
    expect(await m.fetchScheduledPosts('bob')).toEqual([])
  })

  it('fetchScheduledPost picks one by permlink, or null', async () => {
    const m = await load()
    h.get.mockResolvedValue({ data: { scheduled_posts: [{ permlink: 'a' }, { permlink: 'b', title: 'B' }] } })
    expect(await m.fetchScheduledPost('bob', 'b')).toEqual({ permlink: 'b', title: 'B' })
    expect(await m.fetchScheduledPost('bob', 'zzz')).toBeNull()
    expect(await m.fetchScheduledPost('bob', '')).toBeNull()
  })
})

describe('getScheduledEmbedRef', () => {
  it('prefers the embed URL in the post metadata', async () => {
    const { getScheduledEmbedRef } = await load()
    const doc = { owner: 'o', permlink: 'hive-p', jsonMetadata: { video: { url: 'https://play.3speak.tv/watch?v=alice/asset-1' } } }
    expect(getScheduledEmbedRef(doc)).toEqual({ owner: 'alice', permlink: 'asset-1' })
    expect(getScheduledEmbedRef({ embedUrl: 'https://x/embed?v=bob/p2&mode=iframe' })).toEqual({ owner: 'bob', permlink: 'p2' })
  })

  it('falls back to embedPermlink, then to the post owner/permlink', async () => {
    const { getScheduledEmbedRef } = await load()
    expect(getScheduledEmbedRef({ owner: 'o', permlink: 'p', embedPermlink: 'e' })).toEqual({ owner: 'o', permlink: 'e' })
    expect(getScheduledEmbedRef({ owner: 'o', permlink: 'p' })).toEqual({ owner: 'o', permlink: 'p' })
  })

  it('ignores an unusable embed URL instead of failing', async () => {
    const { getScheduledEmbedRef } = await load()
    expect(getScheduledEmbedRef({ embedUrl: 'not a url', owner: 'o', permlink: 'p' })).toEqual({ owner: 'o', permlink: 'p' })
    expect(getScheduledEmbedRef({ embedUrl: 'https://x/?v=noslash', owner: 'o', permlink: 'p' })).toEqual({ owner: 'o', permlink: 'p' })
    expect(getScheduledEmbedRef({ embedUrl: 'https://x/?v=/p', owner: 'o', permlink: 'p' })).toEqual({ owner: 'o', permlink: 'p' })
  })

  it('is null when nothing identifies the video', async () => {
    const { getScheduledEmbedRef } = await load()
    expect(getScheduledEmbedRef(null)).toBeNull()
    expect(getScheduledEmbedRef({ owner: 'o' })).toBeNull()
  })
})

describe('normalizeScheduledForCard', () => {
  it('shapes a scheduled post so the card shows the scheduled badge and date', async () => {
    const { normalizeScheduledForCard } = await load()
    const card = normalizeScheduledForCard({ id: 7, owner: 'o', permlink: 'p', title: 'T', thumbnail: 'th', scheduledOn: '2026-11-01T10:00:00Z', createdAt: 'c' })
    expect(card).toMatchObject({
      _id: 'scheduled:7', _scheduled: true, owner: 'o', author: 'o', permlink: 'p', title: 'T',
      status: 'scheduled', publish_type: 'schedule', publish_data: '2026-11-01T10:00:00Z',
      spkvideo: { thumbnail_url: 'th', duration: 0 }, created_at: 'c',
    })
  })

  it('fills an untitled post and keys it by permlink when it has no id', async () => {
    const { normalizeScheduledForCard } = await load()
    const card = normalizeScheduledForCard({ owner: 'o', permlink: 'p' })
    expect(card._id).toBe('scheduled:p')
    expect(card.title).toBe('(untitled)')
    expect(card.thumbnail).toBeNull()
    expect(card.description).toBe('')
  })
})
