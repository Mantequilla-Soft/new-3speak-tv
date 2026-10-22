// Is a Hive post a 3Speak video? (src/utils/threeSpeakDetection.js): the
// metadata rules, bounded-concurrency fetching and the root-post walk.
import { describe, it, expect, vi } from 'vitest'

const axios = vi.hoisted(() => ({ post: vi.fn() }))
vi.mock('axios', () => ({ default: axios }))
vi.mock('../../../src/utils/hiveNode', () => ({ getHiveUrl: () => 'https://hive.test' }))
vi.mock('../../../src/utils/config', () => ({ HIVE_API_URL: 'https://hive.test' }))

const load = async (posts) => {
  vi.resetModules()
  axios.post.mockReset()
  axios.post.mockImplementation(async (url, body) => {
    const key = `${body.params.author}/${body.params.permlink}`
    const p = posts[key]
    if (p instanceof Error) throw p
    if (p === 'rpc-error') return { data: { error: { message: 'boom' } } }
    return { data: { result: p ?? null } }
  })
  return import('../../../src/utils/threeSpeakDetection.js')
}

const root = (video, extra = {}) => ({ parent_author: '', json_metadata: JSON.stringify({ video }), ...extra })

describe('what counts as a 3Speak video', () => {
  const cases = {
    'a/sourcemap': root({ info: { sourceMap: [{ type: 'video', url: 'ipfs://x' }] } }),
    'a/sourcemap-url': root({ info: { sourceMap: [{ type: 'thumbnail', url: 'https://3speak.tv/x.png' }] } }),
    'a/v2': root({ info: { video_v2: 'ipfs://Qm/manifest.m3u8' } }),
    'a/file': root({ info: { file: 'video.mp4' } }),
    'a/platform': root({ platform: '3speak', info: { duration: 60 } }),
    'a/platform-url': root({ platform: '3speak', url: 'https://3speak.tv/watch?v=a/b' }),
    'a/object-meta': { parent_author: '', json_metadata: { video: { info: { file: 'x.mp4' } } } },
  }
  const not = {
    'b/comment': root({ info: { file: 'video.mp4' } }, { parent_author: 'someone' }),
    'b/app-only': { parent_author: '', json_metadata: JSON.stringify({ app: '3speak/0.3', tags: ['threespeak'] }), category: 'hive-181335' },
    'b/platform-bare': root({ platform: '3speak' }),
    'b/empty-v2': root({ info: { video_v2: '' } }),
    'b/thumb-only': root({ info: { sourceMap: [{ type: 'thumbnail', url: 'https://img.example/x.png' }, null] } }),
    'b/broken': { parent_author: '', json_metadata: '{not json' },
    'b/missing': null,
  }

  it.each(Object.keys(cases))('%s is a 3Speak video', async (key) => {
    const m = await load(cases)
    expect(await m.ensure3SpeakStatus(key)).toBe(true)
    expect(m.get3SpeakStatus(key)).toBe(true)
  })

  it.each(Object.keys(not))('%s is not', async (key) => {
    const m = await load(not)
    expect(await m.ensure3SpeakStatus(key)).toBe(false)
  })
})

describe('fetching', () => {
  it('asks bridge.get_post on the current Hive node', async () => {
    const m = await load({ 'a/b': root({ info: { file: 'x' } }) })
    await m.ensure3SpeakStatus('a/b')
    expect(axios.post).toHaveBeenCalledWith('https://hive.test', {
      jsonrpc: '2.0', method: 'bridge.get_post', params: { author: 'a', permlink: 'b', observer: '' }, id: 1,
    })
    expect(m.getCachedPost('a/b')).toBeTruthy()
  })

  it('treats an RPC or network error as not 3Speak and caches that', async () => {
    const m = await load({ 'a/rpc': 'rpc-error', 'a/net': new Error('offline') })
    expect(await m.ensure3SpeakStatus('a/rpc')).toBe(false)
    expect(await m.ensure3SpeakStatus('a/net')).toBe(false)
    await m.ensure3SpeakStatus('a/net')
    expect(axios.post).toHaveBeenCalledTimes(2)
  })

  it('does not fetch for empty or malformed keys', async () => {
    const m = await load({})
    expect(await m.ensure3SpeakStatus('')).toBe(false)
    expect(await m.ensure3SpeakStatus('noslash')).toBe(false)
    expect(m.get3SpeakStatus('')).toBeUndefined()
    expect(axios.post).not.toHaveBeenCalled()
  })

  it('shares one request per post and runs at most four at a time', async () => {
    vi.resetModules()
    axios.post.mockReset()
    let active = 0
    let peak = 0
    const release = []
    axios.post.mockImplementation(() => {
      active += 1
      peak = Math.max(peak, active)
      return new Promise((resolve) => release.push(() => { active -= 1; resolve({ data: { result: null } }) }))
    })
    const m = await import('../../../src/utils/threeSpeakDetection.js')
    const keys = Array.from({ length: 10 }, (_, i) => `a/p${i}`)
    m.prefetch3SpeakDetection([...keys, 'a/p0', null])
    expect(axios.post).toHaveBeenCalledTimes(4)
    const all = Promise.all(keys.map((k) => m.ensure3SpeakStatus(k)))
    while (release.length) {
      release.shift()()
      await new Promise((r) => setTimeout(r, 0))
    }
    expect(await all).toEqual(keys.map(() => false))
    expect(axios.post).toHaveBeenCalledTimes(10)
    expect(peak).toBe(4)
  })
})

describe('resolveRootPost', () => {
  it('walks up replies to the root post', async () => {
    const m = await load({
      'c/reply2': { parent_author: 'c', parent_permlink: 'reply1', json_metadata: '{}' },
      'c/reply1': { parent_author: 'v', parent_permlink: 'video', json_metadata: '{}' },
      'v/video': root({ info: { file: 'x' } }),
    })
    expect(await m.resolveRootPost('c/reply2')).toBe('v/video')
    expect(m.get3SpeakStatus('v/video')).toBe(true)
  })

  it('stops at a post it cannot read', async () => {
    const m = await load({ 'c/reply': { parent_author: 'gone', parent_permlink: 'x', json_metadata: '{}' } })
    expect(await m.resolveRootPost('c/reply')).toBe('gone/x')
  })

  it('gives up after six hops on a loop', async () => {
    const m = await load({
      'x/a': { parent_author: 'x', parent_permlink: 'b' },
      'x/b': { parent_author: 'x', parent_permlink: 'a' },
    })
    expect(['x/a', 'x/b']).toContain(await m.resolveRootPost('x/a'))
  })
})
