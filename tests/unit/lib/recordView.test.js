// Counting a view on the player backend: resolve the embed asset first, then try
// embed and legacy until one counts it (src/lib/recordView.js).
import { describe, it, expect, beforeEach, vi } from 'vitest'

const resolveVideoMeta = vi.hoisted(() => vi.fn())
vi.mock('../../../src/utils/playerUrl', () => ({ getPlayerUrl: () => 'https://play.test' }))
vi.mock('../../../src/lib/videoMetaCache', () => ({ resolveVideoMeta }))

import { recordView } from '../../../src/lib/recordView.js'

const bodies = (f) => f.mock.calls.map((c) => JSON.parse(c[1].body))

beforeEach(() => resolveVideoMeta.mockReset())

describe('recordView', () => {
  it('counts against the resolved embed asset, not the Hive permlink', async () => {
    resolveVideoMeta.mockResolvedValue({ owner: 'realowner', permlink: 'asset123' })
    const f = vi.fn().mockResolvedValue({ json: async () => ({ counted: true }) })
    vi.stubGlobal('fetch', f)
    await recordView('api', 'alice', 'hive-permlink')
    expect(resolveVideoMeta).toHaveBeenCalledWith('api', 'alice', 'hive-permlink')
    expect(f).toHaveBeenCalledTimes(1)
    expect(f.mock.calls[0][0]).toBe('https://play.test/api/view')
    expect(f.mock.calls[0][1].method).toBe('POST')
    expect(bodies(f)).toEqual([{ owner: 'realowner', permlink: 'asset123', type: 'embed' }])
  })

  it('tries legacy when embed does not count it', async () => {
    resolveVideoMeta.mockResolvedValue(null)
    const f = vi.fn()
      .mockResolvedValueOnce({ json: async () => ({ counted: false }) })
      .mockResolvedValueOnce({ json: async () => ({ counted: true }) })
    vi.stubGlobal('fetch', f)
    await recordView('api', 'alice', 'p')
    expect(bodies(f).map((b) => [b.owner, b.permlink, b.type])).toEqual([['alice', 'p', 'embed'], ['alice', 'p', 'legacy']])
  })

  it('moves on after a network error or bad JSON and stops after legacy', async () => {
    resolveVideoMeta.mockResolvedValue({})
    const f = vi.fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce({ json: async () => { throw new SyntaxError('x') } })
    vi.stubGlobal('fetch', f)
    await expect(recordView('api', 'a', 'p')).resolves.toBeUndefined()
    expect(f).toHaveBeenCalledTimes(2)
  })
})
