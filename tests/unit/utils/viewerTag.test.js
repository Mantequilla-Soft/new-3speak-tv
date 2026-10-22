// Mirroring a viewer's topic tag into the checker, and reading the tally back
// (src/utils/viewerTag.js).
import { describe, it, expect, beforeEach, vi } from 'vitest'

const axios = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }))
vi.mock('axios', () => ({ default: axios }))

import { recordViewerTag, getViewerTags, getMyViewerTag, VIEWER_TAG_OPTIONS } from '../../../src/utils/viewerTag.js'

beforeEach(() => {
  axios.post.mockReset()
  axios.get.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('recordViewerTag', () => {
  it('posts the full choice to the checker', async () => {
    axios.post.mockResolvedValue({ data: {} })
    expect(await recordViewerTag('alice', 'bob', 'my-video', 'music', 5000)).toBe(true)
    expect(axios.post).toHaveBeenCalledWith('https://checker.3speak.tv/viewer-tag', {
      username: 'alice', author: 'bob', permlink: 'my-video', tag: 'music', weight: 5000,
    })
  })

  it('sends nothing when any identifying field is missing', async () => {
    expect(await recordViewerTag('', 'bob', 'p', 'music', 1)).toBe(false)
    expect(await recordViewerTag('alice', 'bob', 'p', '', 1)).toBe(false)
    expect(await recordViewerTag('alice', null, 'p', 'music', 1)).toBe(false)
    expect(axios.post).not.toHaveBeenCalled()
  })

  it('a failed mirror write reports false instead of throwing', async () => {
    axios.post.mockRejectedValue(new Error('500'))
    await expect(recordViewerTag('alice', 'bob', 'p', 'music', 1)).resolves.toBe(false)
  })
})

describe('getViewerTags', () => {
  it('encodes author and permlink into the URL', async () => {
    axios.get.mockResolvedValue({ data: { winner: 'music' } })
    expect(await getViewerTags('bob', 'a/b c')).toEqual({ winner: 'music' })
    expect(axios.get).toHaveBeenCalledWith('https://checker.3speak.tv/viewer-tags/bob/a%2Fb%20c')
  })

  it('returns null on failure', async () => {
    axios.get.mockRejectedValue(new Error('down'))
    expect(await getViewerTags('bob', 'p')).toBeNull()
  })
})

describe('getMyViewerTag', () => {
  it('answers "not tagged" without asking when input is missing', async () => {
    expect(await getMyViewerTag('', 'bob', 'p')).toEqual({ tagged: false, tag: null })
    expect(axios.get).not.toHaveBeenCalled()
  })

  it('asks the checker for this user and video', async () => {
    axios.get.mockResolvedValue({ data: { tagged: true, tag: 'tech' } })
    expect(await getMyViewerTag('alice', 'bob', 'p')).toEqual({ tagged: true, tag: 'tech' })
    expect(axios.get).toHaveBeenCalledWith('https://checker.3speak.tv/viewer-tag/mine/alice/bob/p')
  })

  it('falls back to "not tagged" on failure', async () => {
    axios.get.mockRejectedValue(new Error('down'))
    expect(await getMyViewerTag('alice', 'bob', 'p')).toEqual({ tagged: false, tag: null })
  })
})

it('the tag options are the interest taxonomy', () => {
  expect(Array.isArray(VIEWER_TAG_OPTIONS)).toBe(true)
  expect(VIEWER_TAG_OPTIONS.length).toBeGreaterThan(0)
})
