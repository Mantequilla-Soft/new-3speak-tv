// The "Hide AI-generated" filter for inline shorts pools
// (src/hooks/useAiFilteredShorts.js): flagged shorts leave the pool (by owner or
// by the Hive author in the embed URL), unknown ones stay, and with the setting
// off the pool is passed through untouched.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

const store = vi.hoisted(() => ({ hideAi: true }))
vi.mock('../../../src/lib/store', () => ({ useAppStore: (sel) => sel(store) }))
const flags = vi.hoisted(() => ({ set: new Set(), asked: [] }))
vi.mock('../../../src/utils/aiFlags', () => ({
  aiKey: (a, p) => `${a}/${p}`,
  isAiFlagged: (a, p) => flags.set.has(`${a}/${p}`),
  useAiFlags: (keys) => { flags.asked.push(keys); return 0 },
}))
vi.mock('../../../src/hive-api/hiveApi', () => ({
  parseEmbedUrl: (url) => { const m = /^(.+)\/(.+)$/.exec(url || ''); return m ? { author: m[1], permlink: m[2] } : {} },
}))
const { useAiFilteredShorts, hiveAuthorOf, isAiShort } = await import('../../../src/hooks/useAiFilteredShorts.js')

const clean = { owner: 'badadib', permlink: 'one', embed_url: 'badadib/one' }
const flaggedOwner = { owner: 'badadib', permlink: 'two', embed_url: 'badadib/two' }
const flaggedHive = { owner: 'uploader', permlink: 'three', embed_url: 'badadib/three' }
const noEmbed = { owner: 'badadib', permlink: 'four' }

beforeEach(() => {
  store.hideAi = true
  flags.set = new Set(['badadib/two', 'badadib/three'])
  flags.asked = []
})

describe('who a short belongs to', () => {
  it('is the Hive author from the embed URL, falling back to the owner', () => {
    expect(hiveAuthorOf(flaggedHive)).toBe('badadib')
    expect(hiveAuthorOf(noEmbed)).toBe('badadib')
  })

  it('is AI when flagged under either name', () => {
    expect([clean, flaggedOwner, flaggedHive, noEmbed].map(isAiShort)).toEqual([false, true, true, false])
  })
})

describe('useAiFilteredShorts', () => {
  it('drops flagged shorts from the whole pool, keeping the order', () => {
    const { result } = renderHook(() => useAiFilteredShorts([clean, flaggedOwner, noEmbed, flaggedHive]))
    expect(result.current).toEqual([clean, noEmbed])
  })

  it('asks for the flags of both names of every short', () => {
    renderHook(() => useAiFilteredShorts([flaggedHive]))
    expect(flags.asked.at(-1)).toEqual(['uploader/three', 'badadib/three'])
  })

  it('with the setting off, passes the very same pool through', () => {
    store.hideAi = false
    const pool = [clean, flaggedOwner]
    const { result } = renderHook(() => useAiFilteredShorts(pool))
    expect(result.current).toBe(pool)
  })

  it('treats a missing pool as empty', () => {
    const { result } = renderHook(() => useAiFilteredShorts(undefined))
    expect(result.current).toEqual([])
  })
})
