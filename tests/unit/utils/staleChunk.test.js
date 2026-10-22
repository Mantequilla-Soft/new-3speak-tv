// Recovering from a code-split file that failed to load after a deploy
// (src/utils/staleChunk.js): spotting the error, and reloading at most once.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ reloadForUpdate: vi.fn(async () => {}) }))
vi.mock('../../../src/utils/checkLatestVersion', () => ({ reloadForUpdate: h.reloadForUpdate }))

import { isChunkLoadError, reloadOnceForChunk } from '../../../src/utils/staleChunk.js'

beforeEach(() => {
  sessionStorage.clear()
  h.reloadForUpdate.mockClear()
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
})

describe('isChunkLoadError', () => {
  it('recognises each browser\'s wording', () => {
    const messages = [
      'Failed to fetch dynamically imported module: https://3speak.tv/assets/Watch-abc.js',
      'error loading dynamically imported module: https://3speak.tv/assets/x.js',
      'Importing a module script failed.',
      'Loading chunk 123 failed.',
      'Loading CSS chunk Watch failed',
      'Unable to preload CSS for /assets/Watch.css',
      "'text/html' is not a valid JavaScript MIME type.",
    ]
    for (const m of messages) expect(isChunkLoadError(new TypeError(m)), m).toBe(true)
    expect(isChunkLoadError({ name: 'ChunkLoadError', message: 'x' })).toBe(true)
    expect(isChunkLoadError('Failed to fetch dynamically imported module')).toBe(true)
  })

  it('does not mistake an ordinary render error for a missing file', () => {
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'x')"))).toBe(false)
    expect(isChunkLoadError(new Error('Failed to fetch'))).toBe(false)
    expect(isChunkLoadError(null)).toBe(false)
    expect(isChunkLoadError(undefined)).toBe(false)
  })
})

describe('reloadOnceForChunk', () => {
  it('reloads the first time and refuses the second time for the same file', async () => {
    expect(await reloadOnceForChunk('Watch')).toBe(true)
    expect(h.reloadForUpdate).toHaveBeenCalledTimes(1)
    expect(await reloadOnceForChunk('Watch')).toBe(false)
    expect(h.reloadForUpdate).toHaveBeenCalledTimes(1)
  })

  it('each file name gets its own single retry', async () => {
    expect(await reloadOnceForChunk('A')).toBe(true)
    expect(await reloadOnceForChunk('B')).toBe(true)
    expect(JSON.parse(sessionStorage.getItem('3speak_chunk_reloaded'))).toEqual(['A', 'B'])
  })

  it('does not burn the retry while offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    expect(await reloadOnceForChunk('A')).toBe(false)
    expect(sessionStorage.getItem('3speak_chunk_reloaded')).toBeNull()
  })

  it('never reloads when the loop guard cannot be stored or read', async () => {
    sessionStorage.setItem('3speak_chunk_reloaded', '{corrupt')
    expect(await reloadOnceForChunk('A')).toBe(false)
    sessionStorage.clear()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    expect(await reloadOnceForChunk('A')).toBe(false)
    expect(h.reloadForUpdate).not.toHaveBeenCalled()
  })

  it('a stored value that is not a list counts as nothing reloaded yet', async () => {
    sessionStorage.setItem('3speak_chunk_reloaded', '{"a":1}')
    expect(await reloadOnceForChunk('A')).toBe(true)
  })
})
