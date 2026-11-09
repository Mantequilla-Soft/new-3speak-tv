// audiogramShorts.js: audiograms from the audio editor posted as Shorts after
// the audio post (checks on what the editor sends, the Short's text and
// metadata, and the publish run with its outside calls swapped out).
import { describe, it, expect, vi } from 'vitest'

// The outside calls are injected per test; these modules load the wallet code
vi.mock('../../../src/utils/uploadThumbnail', () => ({ uploadThumbnail: vi.fn() }))
vi.mock('../../../src/utils/uploadVideoAsset', () => ({ uploadVideoAsset: vi.fn() }))
vi.mock('../../../src/utils/snapsContainer', () => ({ resolveSnapsContainer: vi.fn() }))

const {
  sanitizeAudiograms, playlistCoversOf, audiogramShortBody, audiogramShortMetadata, audiogramPermlink, publishAudiogramShorts, audioPageUrl,
} = await import('../../../src/utils/audiogramShorts.js')

const good = (extra = {}) => ({ url: 'https://3speak-editor-api.okinoko.io/rendered/audiogram-1f2e3d4c-aaaa-bbbb-cccc-123456789abc.mp4', description: ' Hi ', title: 'Ep 1', duration: 30, width: 1080, height: 1920, ...extra })
const episode = { author: 'alice', permlink: 'my-episode', title: 'My Episode' }

describe('sanitizeAudiograms', () => {
  it('keeps vertical MP4 audiograms of the editor backend, up to 2 minutes, at most 5', () => {
    expect(sanitizeAudiograms([good()])).toEqual([{ url: good().url, description: 'Hi', title: 'Ep 1', duration: 30 }])
    expect(sanitizeAudiograms(Array.from({ length: 8 }, () => good()))).toHaveLength(5)
    expect(sanitizeAudiograms([good({ url: 'http://localhost:3104/rendered/audiogram-abc.mp4' })])).toHaveLength(1)
  })

  it('drops anything else', () => {
    for (const bad of [
      good({ url: 'http://evil.example/rendered/audiogram-abc.mp4' }),
      good({ url: 'https://x.example/rendered/other.mp4' }),
      good({ url: 'javascript:alert(1)' }),
      good({ duration: 121 }),
      good({ duration: 0 }),
      good({ width: 1920, height: 1080 }),
      null,
      'x',
    ]) expect(sanitizeAudiograms([bad])).toEqual([])
    expect(sanitizeAudiograms('nope')).toEqual([])
    expect(sanitizeAudiograms([good({ description: 'x'.repeat(9000) })])[0].description).toHaveLength(5000)
  })
})

describe('playlistCoversOf', () => {
  it('the covers of the playlists: https only, no repeats', () => {
    expect(playlistCoversOf([
      { title: 'A', thumbnail: 'https://images.hive.blog/a.jpg' },
      { name: 'B', metadata: { album: { thumbnail: 'https://images.hive.blog/b.jpg' } } },
      { title: 'C', thumbnail: 'http://insecure.example/c.jpg' },
      { title: 'D', thumbnail: 'https://images.hive.blog/a.jpg' },
      { title: 'E' },
    ])).toEqual([{ title: 'A', url: 'https://images.hive.blog/a.jpg' }, { title: 'B', url: 'https://images.hive.blog/b.jpg' }])
    expect(playlistCoversOf(null)).toEqual([])
  })
})

describe('the Short', () => {
  it('text: title on top, the video, the words, the episode link, Watch on 3speak.tv', () => {
    const body = audiogramShortBody({ embedUrl: 'https://play.3speak.tv/embed?v=alice/abc', description: 'Listen!', episode, author: 'alice', permlink: 'my-episode-teaser-1' })
    expect(body.startsWith('## My Episode\n\nhttps://play.3speak.tv/embed?v=alice/abc\n\nListen!')).toBe(true)
    expect(body).toContain('🎧 Full episode: [My Episode](https://3speak.tv/audio/alice/my-episode)')
    expect(body).toContain('▶ [Watch on 3speak.tv](https://3speak.tv/shorts?v=alice/my-episode-teaser-1)')
    expect(audiogramShortBody({ embedUrl: 'e', description: '  ', episode, author: 'alice', permlink: 'p' })).toContain('A piece of my episode "My Episode".')
  })

  it('metadata: a regular short\'s, the episode in links and in 3speak.audiogram', () => {
    const m = audiogramShortMetadata({ embedUrl: 'https://play.3speak.tv/embed?v=alice/abc', owner: 'alice', assetPermlink: 'abc', thumbnailUrl: 'https://img/t.jpg', duration: 30, episode, tags: ['podcast', 'hive-181335', 'talk'] })
    expect(m.app).toBe('3speak/embed')
    expect(m.tags).toEqual(['hive-181335', 'podcast', 'talk'])
    expect(m.links).toEqual(['https://play.3speak.tv/embed?v=alice/abc', audioPageUrl(episode)])
    expect(m.video.info).toMatchObject({ author: 'alice', permlink: 'abc', duration: 30 })
    expect(m.image).toEqual(['https://img/t.jpg'])
    expect(m['3speak']).toEqual({ audiogram: { author: 'alice', permlink: 'my-episode' } })
    expect(audiogramShortMetadata({ embedUrl: 'e', owner: 'a', assetPermlink: 'p', duration: 3, episode }).image).toBeUndefined()
  })

  it('permlinks: from the title, different per audiogram', () => {
    expect(audiogramPermlink('My Episode #12!', 0, 1234567)).toBe('my-episode-12-teaser-34567')
    expect(audiogramPermlink('My Episode #12!', 1, 1234567)).toBe('my-episode-12-teaser-34568')
    expect(audiogramPermlink('', 0, 5)).toBe('audiogram-teaser-5')
  })
})

describe('publishAudiogramShorts', () => {
  const deps = () => ({
    fetchFile: vi.fn(async () => new Blob(['x'])),
    upload: vi.fn(async () => ({ embedUrl: 'https://play.3speak.tv/embed?v=alice/abc', owner: 'alice', permlink: 'abc', base: 'https://embed.example' })),
    thumbnail: vi.fn(async () => 'https://img/t.jpg'),
    container: vi.fn(async () => ({ author: 'peak.snaps', permlink: 'snap-container-1' })),
    link: vi.fn(async () => ({ ok: true })),
    pause: vi.fn(async () => {}),
  })

  it('uploads each as a short, replies under the snaps container with beneficiaries, links the video', async () => {
    const d = deps()
    const broadcast = vi.fn(async () => ({ success: true }))
    const steps = []
    const res = await publishAudiogramShorts({ audiograms: sanitizeAudiograms([good(), good()]), user: 'alice', isPremium: false, episode, tags: ['podcast'], broadcast, onProgress: (p) => steps.push(p), deps: d })
    expect(res.map(r => r.ok)).toEqual([true, true])
    expect(d.upload).toHaveBeenCalledWith(expect.anything(), { owner: 'alice', duration: 30, short: true })
    const [comment, options] = broadcast.mock.calls[0][0]
    expect(comment[1]).toMatchObject({ parent_author: 'peak.snaps', parent_permlink: 'snap-container-1', author: 'alice', title: '' })
    expect(JSON.parse(comment[1].json_metadata)['3speak'].audiogram).toEqual({ author: 'alice', permlink: 'my-episode' })
    const benes = options[1].extensions[0][1].beneficiaries
    expect(benes.map(b => b.account)).toEqual([...benes.map(b => b.account)].sort())
    expect(benes.length).toBeGreaterThan(0)
    expect(d.link).toHaveBeenCalledWith('https://embed.example', 'abc', expect.objectContaining({ hive_author: 'alice', hive_permlink: comment[1].permlink }))
    expect(d.link).toHaveBeenCalledWith('https://embed.example', 'abc', { thumbnail_url: 'https://img/t.jpg' })
    expect(d.pause).toHaveBeenCalledTimes(1)
    expect(steps.map(s => `${s.index}:${s.step}`)).toEqual(['0:upload', '0:post', '0:done', '1:upload', '1:post', '1:done'])
    expect(steps[2]).toMatchObject({ ok: true, permlink: res[0].permlink })
  })

  it('uses the Short\'s own title and the thumbnail made in the upload', async () => {
    const d = deps()
    const broadcast = vi.fn(async () => ({ success: true }))
    const [a] = sanitizeAudiograms([good()])
    await publishAudiogramShorts({ audiograms: [{ ...a, title: 'The teaser', thumbnailUrl: 'https://images.hive.blog/made.jpg' }], user: 'alice', episode, broadcast, deps: d })
    expect(d.thumbnail).not.toHaveBeenCalled()
    const [comment] = broadcast.mock.calls[0][0]
    expect(comment[1].body.startsWith('## The teaser')).toBe(true)
    expect(comment[1].body).toContain('🎧 Full episode: [My Episode]')
    expect(comment[1].permlink).toMatch(/^the-teaser-teaser-/)
    const meta = JSON.parse(comment[1].json_metadata)
    expect(meta.image).toEqual(['https://images.hive.blog/made.jpg'])
    expect(meta.video.info.title).toBe('The teaser')
    expect(d.link).toHaveBeenCalledWith('https://embed.example', 'abc', expect.objectContaining({ hive_title: 'The teaser' }))
    // no title of its own: the episode's; a thumbnail not on https: a frame instead
    const d2 = deps()
    const b2 = vi.fn(async () => ({ success: true }))
    await publishAudiogramShorts({ audiograms: [{ ...a, title: ' ', thumbnailUrl: 'javascript:x' }], user: 'alice', episode, broadcast: b2, deps: d2 })
    expect(d2.thumbnail).toHaveBeenCalled()
    expect(b2.mock.calls[0][0][0][1].body.startsWith('## My Episode')).toBe(true)
  })

  it('a failed one is reported and the next still goes out; nothing throws', async () => {
    const d = deps()
    d.upload.mockRejectedValueOnce(new Error('upload down'))
    const res = await publishAudiogramShorts({ audiograms: sanitizeAudiograms([good(), good()]), user: 'alice', isPremium: true, episode, broadcast: async () => ({ success: true }), deps: d })
    expect(res).toEqual([{ ok: false, error: 'upload down' }, { ok: true, permlink: expect.any(String) }])
    const fail = await publishAudiogramShorts({ audiograms: sanitizeAudiograms([good()]), user: 'alice', episode, broadcast: async () => ({ success: false, error: 'RC' }), deps: deps() })
    expect(fail).toEqual([{ ok: false, error: 'RC' }])
  })
})
