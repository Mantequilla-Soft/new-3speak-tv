// AI-generated flags for feed cards (src/utils/aiFlags.js): batched lookups,
// asked once per page load, and the shorts filter for "Hide AI-generated".
import { describe, it, expect, vi } from 'vitest'

const axios = vi.hoisted(() => ({ post: vi.fn() }))
vi.mock('axios', () => ({ default: axios }))
vi.mock('../../../src/utils/config', () => ({ CHECKER_URL: 'https://checker.test' }))

const load = async (flagged = []) => {
  vi.resetModules()
  axios.post.mockReset()
  axios.post.mockImplementation(async (url, { keys }) => ({ data: { flagged: keys.filter((k) => flagged.includes(k)) } }))
  return import('../../../src/utils/aiFlags.js')
}

describe('aiKey', () => {
  it('lowercases the author and drops @, keeping the permlink as is', async () => {
    const { aiKey } = await load()
    expect(aiKey(' @Alice ', 'My-Vid')).toBe('alice/My-Vid')
    expect(aiKey('', 'x')).toBeNull()
    expect(aiKey('a', null)).toBeNull()
  })
})

describe('loading flags', () => {
  it('sends every queued key in one batch and flags only what the checker named', async () => {
    const m = await load(['alice/ai'])
    await m.loadAiFlags(['alice/ai', 'bob/real'])
    expect(axios.post).toHaveBeenCalledTimes(1)
    expect(axios.post).toHaveBeenCalledWith('https://checker.test/transcription-tags/ai-batch', { keys: ['alice/ai', 'bob/real'] })
    expect(m.isAiFlagged('Alice', 'ai')).toBe(true)
    expect(m.isAiFlagged('bob', 'real')).toBe(false)
    expect(m.isAiFlagged('carol', 'unknown')).toBe(false)
  })

  it('collects keys requested close together into one request', async () => {
    const m = await load()
    m.requestAiFlags(['a/1'])
    m.requestAiFlags(['a/2', null, ''])
    await m.loadAiFlags(['a/3'])
    expect(axios.post).toHaveBeenCalledTimes(1)
    expect(axios.post.mock.calls[0][1].keys).toEqual(['a/1', 'a/2', 'a/3'])
  })

  it('never asks about a key twice, even after a failure', async () => {
    const m = await load()
    axios.post.mockRejectedValueOnce(new Error('down'))
    await m.loadAiFlags(['a/1'])
    expect(m.isAiFlagged('a', '1')).toBe(false)
    await m.loadAiFlags(['a/1'])
    expect(axios.post).toHaveBeenCalledTimes(1)
  })

  it('splits more than 200 keys into several requests', async () => {
    const m = await load(['a/449'])
    await m.loadAiFlags(Array.from({ length: 450 }, (_, i) => `a/${i}`))
    expect(axios.post.mock.calls.map((c) => c[1].keys.length)).toEqual([200, 200, 50])
    expect(m.isAiFlagged('a', '0')).toBe(false)
    expect(m.isAiFlagged('a', '449')).toBe(true)
  })

  it('waits for a batch already in flight when asked for the same keys', async () => {
    const m = await load(['a/1'])
    let release
    axios.post.mockImplementationOnce(() => new Promise((r) => { release = () => r({ data: { flagged: ['a/1'] } }) }))
    m.requestAiFlags(['a/1'])
    await new Promise((r) => setTimeout(r, 50))
    const waiting = m.loadAiFlags(['a/1'])
    let done = false
    waiting.then(() => { done = true })
    await new Promise((r) => setTimeout(r, 10))
    expect(done).toBe(false)
    release()
    await waiting
    expect(m.isAiFlagged('a', '1')).toBe(true)
  })

  it('resolves at once with nothing to ask', async () => {
    const m = await load()
    await expect(m.loadAiFlags([])).resolves.toBeUndefined()
    await expect(m.loadAiFlags(undefined)).resolves.toBeUndefined()
    expect(axios.post).not.toHaveBeenCalled()
  })
})

describe('dropAiShorts', () => {
  const s = (author, permlink, extra = {}) => ({ author, permlink, ...extra })

  it('costs nothing with the setting off', async () => {
    const m = await load(['a/x'])
    const list = [s('a', 'x')]
    expect(await m.dropAiShorts(list)).toBe(list)
    expect(axios.post).not.toHaveBeenCalled()
  })

  it('drops flagged shorts by asset permlink, Hive permlink or the user record', async () => {
    const m = await load(['a/asset1', 'b/hive2', 'c/hive3'])
    const list = [
      s('a', 'asset1'),
      s('b', 'asset2', { hivePermlink: 'hive2' }),
      s('owner', 'asset3', { hivePermlink: 'hive3', user: { username: 'c' } }),
      s('d', 'clean'),
    ]
    expect(await m.dropAiShorts(list, { hide: true })).toEqual([s('d', 'clean')])
  })

  it('never empties a first page, but may empty a later one', async () => {
    const m = await load(['a/x'])
    const list = [s('a', 'x')]
    expect(await m.dropAiShorts(list, { hide: true })).toBe(list)
    expect(await m.dropAiShorts(list, { hide: true, allowEmpty: true })).toEqual([])
  })

  it('keeps everything when the lookup fails', async () => {
    const m = await load()
    axios.post.mockRejectedValue(new Error('down'))
    const list = [s('a', 'x'), s('b', 'y')]
    expect(await m.dropAiShorts(list, { hide: true })).toEqual(list)
  })
})

describe('waiting only for what was asked', () => {
  it('does not wait for another batch still in flight', async () => {
    const m = await load()
    let release
    axios.post.mockImplementationOnce(() => new Promise((r) => { release = () => r({ data: { flagged: [] } }) }))
    m.requestAiFlags(['grid/1'])
    await new Promise((r) => setTimeout(r, 50)) // the grid's batch is out, and slow
    await m.loadAiFlags(['spot/1'])               // resolves on its own batch
    expect(axios.post).toHaveBeenCalledTimes(2)
    expect(m.isAiFlagged('grid', '1')).toBe(false)
    release()
  })
})
