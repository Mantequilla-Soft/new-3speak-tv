// "Publish as audio" (src/lib/audioVersion.js): the MP3 job on the server, and
// what the audio uploader starts from (the video's title, text, tags, cover, source).
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../src/hive-api/aioha', () => ({ getCurrentProvider: () => null, Providers: { HiveSigner: 'hivesigner' }, establishWalletSession: async () => false }))
const { makeAudioVersion, excerptOf, audioVersionUpload } = await import('../../../src/lib/audioVersion.js')

const json = (status, body) => ({ ok: status < 400, status, json: async () => body, blob: async () => new Blob(['mp3']) })

describe('makeAudioVersion', () => {
  it('starts the job, waits for it, downloads the MP3', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(json(200, { id: 'j1' }))
      .mockResolvedValueOnce(json(200, { status: 'working' }))
      .mockResolvedValueOnce(json(200, { status: 'done', size: 3 }))
      .mockResolvedValueOnce(json(200, {}))
    const blob = await makeAudioVersion('badadib', 'my-video', { fetchFn, pollMs: 0 })
    expect(await blob.text()).toBe('mp3')
    expect(fetchFn.mock.calls[0][0]).toMatch(/\/audio-version\/jobs$/)
    expect(JSON.parse(fetchFn.mock.calls[0][1].body)).toEqual({ author: 'badadib', permlink: 'my-video' })
    expect(fetchFn.mock.calls[3][0]).toMatch(/\/audio-version\/jobs\/j1\/audio$/)
  })

  it('picks up the job already running, and throws the server\'s reason', async () => {
    const busy = vi.fn()
      .mockResolvedValueOnce(json(409, { errorCode: 'busy', id: 'j0' }))
      .mockResolvedValueOnce(json(200, { status: 'failed', error: 'no sound', errorCode: 'not_ready' }))
    await expect(makeAudioVersion('badadib', 'v', { fetchFn: busy, pollMs: 0 })).rejects.toMatchObject({ code: 'not_ready' })
    expect(busy.mock.calls[1][0]).toMatch(/\/jobs\/j0$/)
    const limit = vi.fn().mockResolvedValueOnce(json(429, { errorCode: 'daily_limit' }))
    await expect(makeAudioVersion('badadib', 'v', { fetchFn: limit })).rejects.toMatchObject({ code: 'daily_limit', status: 429 })
  })
})

describe('the audio uploader\'s start', () => {
  it('excerpt: text lines only, no embeds, links or footer', () => {
    expect(excerptOf('https://play.3speak.tv/embed?v=a/b\n\n![x](y)\n\nHello there.\n\nSecond line.\n\n---\n▶ Watch')).toBe('Hello there.\n\nSecond line.')
    expect(excerptOf('x'.repeat(500)).length).toBe(400)
  })

  it('title, text with a line back to the video, tags without the community, cover, the video as source', () => {
    const d = audioVersionUpload({ blob: 'B', author: 'badadib', permlink: 'my-video', title: 'My video', body: 'About it.', tags: ['hive-181335', 'music', 'live'], cover: 'https://img/t.jpg', watchLabel: 'Das Video' })
    expect(d).toEqual({
      blob: 'B', filename: 'my-video.mp3', type: 'podcast', source: 'import',
      prefill: {
        title: 'My video',
        description: 'About it.\n\nDas Video: https://3speak.tv/@badadib/my-video',
        tags: ['music', 'live'],
        coverUrl: 'https://img/t.jpg',
        madeFrom: { kind: 'audio_version', author: 'badadib', permlink: 'my-video' },
      },
    })
    expect(audioVersionUpload({ blob: 'B', author: 'a', permlink: 'p', cover: 'http://x' }).prefill.coverUrl).toBe('')
  })
})
