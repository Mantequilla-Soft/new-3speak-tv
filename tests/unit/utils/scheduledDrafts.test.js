// Drafts on the checker's scheduled posts (src/utils/scheduledPosts.js): each
// write carries the owner's proof for exactly that action.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), prove: vi.fn() }))
vi.mock('axios', () => ({ default: { get: h.get, post: h.post } }))
vi.mock('../../../src/utils/scheduledPostProof', () => ({ proveScheduledPost: h.prove }))

const m = await import('../../../src/utils/scheduledPosts.js')
const BASE = 'https://prod-checker.okinoko.io'

beforeEach(() => {
  h.get.mockReset(); h.post.mockReset(); h.prove.mockReset()
  h.prove.mockResolvedValue({ signature: 'SIG', timestamp: 1 })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('drafts', () => {
  it('lists the owner\'s drafts, newest first, and [] when the checker fails', async () => {
    h.get.mockResolvedValueOnce({ data: { scheduled_posts: [{ permlink: 'a', updatedAt: '2026-11-01' }, { permlink: 'b', updatedAt: '2026-11-03' }] } })
    expect((await m.fetchDrafts('badadib')).map((d) => d.permlink)).toEqual(['b', 'a'])
    expect(h.get).toHaveBeenCalledWith(`${BASE}/scheduled-posts/badadib`, { params: { status: 'draft', limit: 100 } })
    h.get.mockRejectedValueOnce(new Error('down'))
    expect(await m.fetchDrafts('badadib')).toEqual([])
  })

  it('saves a draft with the draft proof and no time; with a time it is a scheduled create', async () => {
    h.post.mockResolvedValue({ status: 201, data: { success: true } })
    await m.saveScheduledPost({ owner: 'badadib', permlink: 'ep-5', post: { title: 'Episode 5', audioPermlink: 'a-ep5' } })
    expect(h.prove).toHaveBeenLastCalledWith({ action: 'draft', owner: 'badadib', permlink: 'ep-5' })
    expect(h.post.mock.calls[0][0]).toBe(`${BASE}/scheduled-posts/create`)
    expect(h.post.mock.calls[0][1]).toEqual({ signature: 'SIG', timestamp: 1, title: 'Episode 5', audioPermlink: 'a-ep5', owner: 'badadib', permlink: 'ep-5', draft: true })

    const at = '2026-12-01T10:00:00.000Z'
    await m.saveScheduledPost({ owner: 'badadib', permlink: 'ep-6', scheduledOn: at, post: { title: 'Episode 6' } })
    expect(h.prove).toHaveBeenLastCalledWith({ action: 'create', owner: 'badadib', permlink: 'ep-6', scheduledOn: at })
    expect(h.post.mock.calls[1][1]).toMatchObject({ scheduledOn: at })
    expect(h.post.mock.calls[1][1].draft).toBeUndefined()
  })

  it('a refused save throws', async () => {
    h.post.mockResolvedValue({ status: 200, data: { success: false, error: 'nope' } })
    await expect(m.saveScheduledPost({ owner: 'badadib', permlink: 'x', post: {} })).rejects.toThrow('nope')
  })

  it('publishes a draft now or later, signed over that time, and deletes one', async () => {
    h.post.mockResolvedValue({ data: { success: true } })
    const at = '2026-12-01T10:00:00.000Z'
    await m.publishDraft({ owner: 'badadib', permlink: 'ep-5', scheduledOn: at })
    expect(h.prove).toHaveBeenLastCalledWith({ action: 'publish', owner: 'badadib', permlink: 'ep-5', scheduledOn: at })
    expect(h.post.mock.calls[0][0]).toBe(`${BASE}/scheduled-posts/publish`)
    expect(h.post.mock.calls[0][1]).toEqual({ signature: 'SIG', timestamp: 1, owner: 'badadib', permlink: 'ep-5', scheduledOn: at })

    await m.publishDraft({ owner: 'badadib', permlink: 'ep-5' })
    expect(Date.parse(h.post.mock.calls[1][1].scheduledOn)).toBeGreaterThan(0)

    await m.deleteDraft({ owner: 'badadib', permlink: 'ep-5' })
    expect(h.prove).toHaveBeenLastCalledWith({ action: 'cancel', owner: 'badadib', permlink: 'ep-5' })
    expect(h.post.mock.calls[2][0]).toBe(`${BASE}/scheduled-posts/cancel`)
  })
})
