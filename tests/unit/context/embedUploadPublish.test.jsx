// Publishing an upload (src/context/EmbedUploadContext.jsx, publishToEmbed): the
// checks before anything is sent, commissioning the deferred encode, the exact
// Hive operations handed to the signer for every kind of post (video, short,
// story, remix, incubating creator, scheduled), the locked beneficiaries, and
// the follow-up writes (embed link, thumbnail, ad opt-out, trailer, story, import)
// that must never fail a post that is already out. Nothing is broadcast: the
// signer, the embed API and the checker are fakes.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

const h = await vi.hoisted(async () => await import('./helpers/embedUpload.jsx'))
vi.mock('../../../src/utils/config', () => h.mocks.config)
vi.mock('axios', () => h.mocks.axios)
vi.mock('tus-js-client', () => h.mocks.tus)
vi.mock('react-router-dom', () => h.mocks.router)
vi.mock('react-i18next', () => h.mocks.i18n)
vi.mock('../../../src/utils/toast', () => h.mocks.toast)
vi.mock('../../../src/lib/store', () => h.mocks.store)
vi.mock('../../../src/hooks/usePremiumStatus', () => h.mocks.premium)
vi.mock('../../../src/utils/snapsContainer', () => h.mocks.snaps)
vi.mock('../../../src/utils/creatorSettings', () => h.mocks.creatorSettings)
vi.mock('../../../src/lib/supportBlockStore', () => h.mocks.supportBlock)
vi.mock('../../../src/utils/uploadThumbnail', () => h.mocks.thumbnail)
vi.mock('../../../src/utils/embedEndpoints', () => h.mocks.endpoints)
vi.mock('../../../src/utils/checkLatestVersion', () => h.mocks.stale)
vi.mock('../../../src/hive-api/aioha', () => h.mocks.aioha)
vi.mock('../../../src/utils/postingAuthority', () => h.mocks.postingAuth)
vi.mock('../../../src/utils/channelTrailer', () => h.mocks.trailer)
vi.mock('../../../src/lib/advertiseData', () => h.mocks.advertise)
vi.mock('../../../src/lib/youtubeImport', () => h.mocks.youtubeImport)
vi.mock('../../../src/lib/stories', () => h.mocks.stories)
vi.mock('../../../src/hive-api/hiveApi', () => h.mocks.hiveApi)
// The owner's signature is a fake; the error wording is the real module's (its
// t() is the same key-echo as the provider's).
vi.mock('../../../src/i18n', () => h.mocks.appI18n)
vi.mock('../../../src/utils/scheduledPostProof', async (importOriginal) => ({
  ...(await importOriginal()),
  proveScheduledPost: (...a) => h.fns.proveScheduledPost(...a),
}))
// A detached <video> never loads metadata in jsdom; the orientation is a given here.
vi.mock('../../../src/utils/openAttribute', async (importOriginal) => ({
  ...(await importOriginal()),
  probeVideoOrientation: async (file) => (file ? 'landscape' : null),
}))

const { EmbedUploadProvider, useEmbedUpload } = await import('../../../src/context/EmbedUploadContext.jsx')

// Date.now() % 1000 === 42, so generated permlinks end in "-42".
const NOW = new Date('2026-11-05T12:00:00.042Z')
const PERMLINK = 'my-first-video-42'
const BANNER = '\n\n[![](https://3speak.tv/banners/badadib.png)](https://3speak.tv/user/badadib)'
const watchLine = (path) => `\n\n---\n▶ [Watch on 3speak.tv](https://3speak.tv${path})`
const LOCKED_SPLITS = [{ account: 'encoder.pay', weight: 100 }, { account: 'threespeakfund', weight: 1000 }]
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

let fetchMock

async function ready(setup) {
  const hook = renderHook(() => useEmbedUpload(), { wrapper: EmbedUploadProvider })
  act(() => {
    const c = hook.result.current
    c.setVideoFile(h.videoFile())
    c.setVideoDuration(125.4)
    c.setTitle('My First Video!')
    c.setDescription('About things')
    c.setTagsPreview(['travel', 'hive-181335'])
  })
  if (setup) act(() => setup(hook.result.current))
  return hook
}
const publish = async (result) => { await act(async () => { await result.current.publishToEmbed() }) }
// The ops of the one broadcast (via @threespeak) and their parts.
const broadcastOps = (n = 0) => h.fns.broadcastViaThreespeak.mock.calls[n][0]
const postOp = (n = 0) => broadcastOps(n).find(([type]) => type === 'comment')[1]
const optionsOp = (n = 0) => broadcastOps(n).find(([type]) => type === 'comment_options')[1]
const meta = (n = 0) => JSON.parse(postOp(n).json_metadata)
const encodeCalls = () => h.fns.axiosPost.mock.calls.filter(([url]) => url.endsWith('/encode'))
const fetchTo = (suffix) => fetchMock.mock.calls.filter(([url]) => url.endsWith(suffix))
const nothingPosted = () => {
  expect(h.fns.broadcastViaThreespeak).not.toHaveBeenCalled()
  expect(h.fns.commentWithAioha).not.toHaveBeenCalled()
  expect(h.fns.broadcastWithAioha).not.toHaveBeenCalled()
}

beforeEach(() => {
  h.reset()
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('XMLHttpRequest', h.FakeXHR)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.useRealTimers() })

describe('before anything is sent', () => {
  it.each([
    ['nobody is logged in', () => { h.state.store = { user: null, incubationHandle: null } }, null, 'upload.errors.notLoggedIn'],
    ['the wallet session has expired', () => { h.fns.isLoggedIn.mockReturnValue(false) }, null, 'upload.errors.sessionExpiredLogin'],
    ['there is no video', null, (c) => c.setVideoFile(null), 'upload.errors.noVideoFile'],
    ['a video has no title', null, (c) => c.setTitle('  '), 'upload.details.errors.titleRequired'],
    ['there is no description', null, (c) => c.setDescription(' '), 'upload.details.errors.descriptionRequired'],
    ['a video has no tags', null, (c) => c.setTagsPreview([]), 'upload.details.errors.tagRequired'],
  ])('refuses when %s', async (_label, arrange, setup, message) => {
    arrange?.()
    const { result } = await ready(setup)
    await publish(result)
    expect(h.fns.toastError).toHaveBeenCalledWith(message)
    expect(h.tus.uploads).toHaveLength(0)
    expect(result.current.uploading).toBe(false)
    nothingPosted()
  })

  it('shows the support notice to a creator whose uploads are blocked', async () => {
    h.fns.isUploadBlocked.mockReturnValue(true)
    const { result } = await ready()
    await publish(result)
    expect(h.fns.getCreatorSettings).toHaveBeenCalledWith('badadib')
    expect(h.fns.showSupportBlock).toHaveBeenCalledWith('upload')
    expect(h.tus.uploads).toHaveLength(0)
    nothingPosted()
  })
})

describe('a regular video', () => {
  it('is posted by @threespeak as one comment plus its options', async () => {
    const { result } = await ready()
    await publish(result)
    const body = `${h.EMBED_URL}\n\nAbout things${watchLine(`/@badadib/${PERMLINK}`)}${BANNER}`
    expect(broadcastOps()).toEqual([
      ['comment', {
        parent_author: '',
        parent_permlink: 'hive-181335',
        author: 'badadib',
        permlink: PERMLINK,
        title: 'My First Video!',
        body,
        json_metadata: expect.any(String),
      }],
      ['comment_options', {
        author: 'badadib',
        permlink: PERMLINK,
        max_accepted_payout: '1000000.000 HBD',
        percent_hbd: 10000,
        allow_votes: true,
        allow_curation_rewards: true,
        extensions: [[0, { beneficiaries: LOCKED_SPLITS }]],
      }],
    ])
    expect(meta()).toEqual({
      app: '3speak/embed',
      format: 'markdown',
      tags: ['hive-181335', 'travel'],
      links: [h.EMBED_URL],
      video: {
        platform: '3speak',
        url: h.EMBED_URL,
        reusable: true,
        info: { platform: '3speak', author: 'badadib', permlink: 'asset-1', title: 'My First Video!', duration: 125.4 },
      },
      oa: { v: 1, object: 'Article' },
      'threespeak.video': { surface: 'watch', orientation: 'landscape', duration: 125.4 },
    })
  })

  it('uploads the file first, then commissions its encode on the same host', async () => {
    const { result } = await ready()
    await publish(result)
    expect(h.tus.uploads).toHaveLength(1)
    expect(h.tus.uploads[0].options.metadata.permlink).toBe(PERMLINK)
    expect(encodeCalls()).toEqual([[
      `${h.POOL_BASE}/video/asset-1/encode`,
      { gated: false },
      { headers: { Authorization: 'Bearer fin-tok', 'Content-Type': 'application/json' } },
    ]])
  })

  it('links the embed video to the post and finishes', async () => {
    const { result } = await ready()
    await publish(result)
    const [[url, init]] = fetchTo('/video/asset-1/hive')
    expect(url).toBe(`${h.POOL_BASE}/video/asset-1/hive`)
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', 'X-API-Key': 'embed-key' })
    expect(JSON.parse(init.body)).toEqual({
      hive_author: 'badadib',
      hive_permlink: PERMLINK,
      hive_title: 'My First Video!',
      hive_body: postOp().body,
      hive_tags: ['3speak', 'travel', 'hive-181335'],
    })
    expect(result.current).toMatchObject({ completed: true, uploading: false, publishedPermlink: PERMLINK, embedUrl: h.EMBED_URL, statusText: 'upload.publishing.completed' })
    expect(h.fns.toastSuccess).toHaveBeenCalledWith('upload.publishing.publishedToast')
    expect(result.current.statusMessages.at(-1)).toMatchObject({ message: 'upload.publishing.log.published', type: 'success' })
  })

  it('reblogs it onto the creator\'s blog as a separate broadcast', async () => {
    const { result } = await ready()
    await publish(result)
    expect(broadcastOps(1)).toEqual([['custom_json', {
      required_auths: [],
      required_posting_auths: ['badadib'],
      id: 'follow',
      json: JSON.stringify(['reblog', { account: 'badadib', author: 'badadib', permlink: PERMLINK }]),
    }]])
  })

  it('does not reblog when "Add to my blog" is off', async () => {
    const { result } = await ready((c) => c.setAddToBlog(false))
    await publish(result)
    expect(h.fns.broadcastViaThreespeak).toHaveBeenCalledTimes(1)
  })

  it('a failed reblog is reported but the video is still published', async () => {
    h.fns.broadcastViaThreespeak
      .mockResolvedValueOnce({ success: true })
      .mockRejectedValueOnce(new Error('rc'))
    const { result } = await ready()
    await publish(result)
    expect(h.fns.toastError).toHaveBeenCalledWith('upload.errors.addToBlogFailed {"error":"rc"}')
    expect(result.current.completed).toBe(true)
  })

  it('a ButrAuth login posts through its own server path, with the same payload', async () => {
    h.fns.getCurrentProvider.mockReturnValue(null)
    const { result } = await ready()
    await publish(result)
    expect(h.fns.broadcastViaThreespeak).not.toHaveBeenCalled()
    const [parentAuthor, parentPermlink, permlink, title, body, jsonMetadata, options] = h.fns.commentWithAioha.mock.calls[0]
    expect([parentAuthor, parentPermlink, permlink, title]).toEqual(['', 'hive-181335', PERMLINK, 'My First Video!'])
    expect(body).toContain(h.EMBED_URL)
    expect(jsonMetadata).toMatchObject({ app: '3speak/embed', tags: ['hive-181335', 'travel'] })
    expect(options).toMatchObject({ permlink: PERMLINK, extensions: [[0, { beneficiaries: LOCKED_SPLITS }]] })
    expect(h.fns.broadcastWithAioha).toHaveBeenCalledWith([expect.arrayContaining(['custom_json'])], 'posting')
  })

  it('reuses a finished background upload instead of uploading again', async () => {
    const { result } = await ready()
    act(() => result.current.startEarlyUpload())
    await waitFor(() => expect(result.current.videoUploadStatus).toBe('done'))
    await publish(result)
    expect(h.tus.uploads).toHaveLength(1)
    expect(encodeCalls()).toHaveLength(1)
    expect(result.current.statusMessages.map((m) => m.message)).toContain('upload.publishing.log.uploadedInBackground')
    expect(result.current.completed).toBe(true)
  })

  it('waits for a background upload that is still running', async () => {
    let up
    h.tus.behaviour = (u) => { up = u }
    const { result } = await ready()
    act(() => result.current.startEarlyUpload())
    await waitFor(() => expect(up).toBeDefined())
    let done
    act(() => { done = result.current.publishToEmbed() })
    await waitFor(() => expect(result.current).toMatchObject({ uploading: true, statusText: 'upload.publishing.finishingUpload' }))
    await act(async () => { h.tusBehaviours.success(up); await done })
    expect(h.tus.uploads).toHaveLength(1)
    expect(result.current.completed).toBe(true)
  })

  it('a failed background upload is retried inline', async () => {
    h.tus.behaviour = 'error'
    const { result } = await ready()
    act(() => result.current.startEarlyUpload())
    await waitFor(() => expect(result.current.videoUploadStatus).toBe('error'))
    h.tus.behaviour = 'success'
    await publish(result)
    expect(h.tus.uploads).toHaveLength(2)
    expect(result.current.completed).toBe(true)
  })

  it('an upload that yields no embed URL stops before Hive', async () => {
    h.tus.embedUrl = undefined
    const { result } = await ready()
    await publish(result)
    expect(h.fns.toastError).toHaveBeenCalledWith('upload.errors.uploadFailedWith {"msg":"upload.errors.noEmbedUrlAfterUpload"}')
    expect(result.current).toMatchObject({ uploading: false, completed: false, statusText: '' })
    nothingPosted()
  })

  it('a refused broadcast fails the upload', async () => {
    h.fns.broadcastViaThreespeak.mockResolvedValue({ success: false })
    const { result } = await ready()
    await publish(result)
    expect(h.fns.toastError).toHaveBeenCalledWith('upload.errors.uploadFailedWith {"msg":"upload.errors.hivePostFailed"}')
    expect(result.current.completed).toBe(false)
    expect(fetchTo('/hive')).toHaveLength(0)
  })

  it('a failed embed link is a warning, not a failure', async () => {
    fetchMock.mockRejectedValue(new Error('down'))
    const { result } = await ready()
    await publish(result)
    expect(result.current.completed).toBe(true)
    expect(result.current.statusMessages).toContainEqual(expect.objectContaining({ message: 'upload.publishing.log.embedLinkFailed', type: 'warning' }))
  })
})

describe('the post\'s community, tags and payout', () => {
  it('a community object posts into that community and adds the nsfw tag when marked', async () => {
    const { result } = await ready((c) => { c.setCommunity({ name: 'hive-100' }); c.setIsNsfw(true) })
    await publish(result)
    expect(postOp().parent_permlink).toBe('hive-100')
    expect(meta().tags).toEqual(['hive-100', 'travel', 'hive-181335', 'nsfw'])
  })

  it('declined rewards carry no payout and no beneficiaries', async () => {
    const { result } = await ready((c) => c.SetDeclineRewards(true))
    await publish(result)
    expect(optionsOp()).toMatchObject({ max_accepted_payout: '0.000 HBD', extensions: [] })
  })

  it('"power up" takes the rewards fully in HP', async () => {
    const { result } = await ready((c) => c.setRewardPowerup(true))
    await publish(result)
    expect(optionsOp().percent_hbd).toBe(0)
  })

  it('chosen beneficiaries are kept beside the locked ones, sorted by account', async () => {
    const { result } = await ready((c) => c.setBeneficiaries(JSON.stringify([
      { account: 'zed', weight: 500 },
      { account: 'alice', weight: 200 },
      { account: 'threespeakfund', weight: 300 },
    ])))
    await publish(result)
    expect(optionsOp().extensions).toEqual([[0, { beneficiaries: [
      { account: 'alice', weight: 200 },
      { account: 'encoder.pay', weight: 100 },
      { account: 'threespeakfund', weight: 1000 },
      { account: 'zed', weight: 500 },
    ] }]])
  })

  it('unreadable beneficiaries fall back to the locked ones', async () => {
    const { result } = await ready((c) => c.setBeneficiaries('{not json'))
    await publish(result)
    expect(optionsOp().extensions).toEqual([[0, { beneficiaries: LOCKED_SPLITS }]])
  })

  it('a Pro creator pays no locked splits: an empty extensions list, never an empty beneficiaries entry', async () => {
    h.state.premium = { premium: true }
    const { result } = await ready()
    await publish(result)
    expect(optionsOp().extensions).toEqual([])
  })
})

describe('the thumbnail', () => {
  it('goes to the image server and into the post and the embed record', async () => {
    const { result } = await ready((c) => c.pickFirstThumbnail([PNG]))
    await publish(result)
    expect(h.fns.uploadThumbnail).toHaveBeenCalledWith(expect.any(Blob), 'badadib', { preferStatic: true })
    const m = meta()
    expect(m.image).toEqual(['https://images.test/thumb.jpg'])
    expect(m.video).toMatchObject({
      thumbnail: 'https://images.test/thumb.jpg',
      info: { sourceMap: [{ url: 'https://images.test/thumb.jpg', type: 'thumbnail' }] },
    })
    const [[url, init]] = fetchTo('/video/asset-1/thumbnail')
    expect(url).toBe(`${h.POOL_BASE}/video/asset-1/thumbnail`)
    expect(JSON.parse(init.body)).toEqual({ thumbnail_url: 'https://images.test/thumb.jpg' })
  })

  it('a failed thumbnail upload publishes without one', async () => {
    h.fns.uploadThumbnail.mockRejectedValue(new Error('image server down'))
    const { result } = await ready((c) => c.pickFirstThumbnail([PNG]))
    await publish(result)
    expect(meta()).not.toHaveProperty('image')
    expect(fetchTo('/thumbnail')).toHaveLength(0)
    expect(result.current.completed).toBe(true)
  })

  it('a failed embed thumbnail write is a warning only', async () => {
    fetchMock.mockImplementation(async (url) => {
      if (url.endsWith('/thumbnail')) throw new Error('down')
      return { ok: true }
    })
    const { result } = await ready((c) => c.pickFirstThumbnail([PNG]))
    await publish(result)
    expect(result.current.statusMessages).toContainEqual(expect.objectContaining({ message: 'upload.publishing.log.thumbnailLinkFailed', type: 'warning' }))
    expect(result.current.completed).toBe(true)
  })
})

describe('a short', () => {
  const asShort = (c) => { c.setFromStories(true); c.setTitle(''); c.setDescription('Sunset at the beach'); c.setTagsPreview([]) }

  it('replies to the live @peak.snaps container, untitled, with only the 3Speak tag', async () => {
    const { result } = await ready(asShort)
    await publish(result)
    const op = postOp()
    expect(op).toMatchObject({ parent_author: 'peak.snaps', parent_permlink: 'snap-container-1', title: '', permlink: 'sunset-at-the-beach-42' })
    expect(op.body).toBe(`${h.EMBED_URL}\n\nSunset at the beach${watchLine('/shorts?v=badadib/sunset-at-the-beach-42')}`)
    expect(meta()).toMatchObject({
      tags: ['hive-181335'],
      oa: { v: 1, object: 'MicroPost' },
      'threespeak.video': { surface: 'shorts', orientation: 'landscape' },
    })
    // Shorts are replies, never reblogged onto the blog.
    expect(h.fns.broadcastViaThreespeak).toHaveBeenCalledTimes(1)
    expect(h.tus.uploads[0].options.metadata.short).toBe('true')
  })

  it('a short\'s title becomes its heading and its permlink', async () => {
    const { result } = await ready((c) => { asShort(c); c.setTitle('Golden hour') })
    await publish(result)
    expect(postOp()).toMatchObject({ title: '', permlink: 'golden-hour-42' })
    expect(postOp().body.startsWith(`## Golden hour\n\n${h.EMBED_URL}`)).toBe(true)
    expect(JSON.parse(fetchTo('/hive')[0][1].body).hive_title).toBe('Golden hour')
  })

  it('without a snaps container nothing is posted', async () => {
    h.fns.resolveSnapsContainer.mockRejectedValue(new Error('all nodes failed'))
    const { result } = await ready(asShort)
    await publish(result)
    expect(h.fns.toastError).toHaveBeenCalledWith('upload.errors.uploadFailedWith {"msg":"all nodes failed"}')
    nothingPosted()
  })

  it('a remix of a short replies under the original short', async () => {
    const { result } = await ready((c) => { asShort(c); c.setOriginalAuthor('alice'); c.setOriginalPermlink('orig-short') })
    await publish(result)
    expect(h.fns.resolveSnapsContainer).not.toHaveBeenCalled()
    expect(postOp()).toMatchObject({ parent_author: 'alice', parent_permlink: 'orig-short' })
    expect(postOp().body).toContain(`*Based on a video by [@alice](${window.location.origin}/shorts?v=alice/orig-short)*`)
    expect(optionsOp().extensions[0][1].beneficiaries).toContainEqual({ account: 'alice', weight: 500 })
  })
})

describe('a 24-hour story', () => {
  const asStory = (c) => { c.setFromStories(true); c.setIsStory(true); c.setTitle(''); c.setDescription(''); c.setTagsPreview([]) }

  it('may go out without a caption, flagged as a story, and starts its 24 hours', async () => {
    const { result } = await ready(asStory)
    await publish(result)
    expect(postOp().body).toContain('My 24-hour story on 3Speak.')
    expect(meta()['3speak']).toEqual({ story: true })
    expect(h.fns.registerStory).toHaveBeenCalledWith('badadib', postOp().permlink)
    expect(result.current.completed).toBe(true)
  })

  it('a story that could not be registered is published with a warning', async () => {
    h.fns.registerStory.mockRejectedValue(new Error('checker down'))
    const { result } = await ready(asStory)
    await publish(result)
    expect(h.fns.toastError).toHaveBeenCalledWith('upload.publishing.storyRegisterFailedToast')
    expect(result.current.completed).toBe(true)
  })
})

describe('a remix of a regular video', () => {
  const asRemix = (c) => {
    c.setOriginalAuthor('alice')
    c.setOriginalPermlink('orig-video')
    c.setRemixChain([{ author: 'alice', permlink: 'orig-video' }, { author: 'bob', permlink: 'first' }])
    c.setReusable(false)
  }

  it('posts the video and a reply on the original in one transaction', async () => {
    const { result } = await ready(asRemix)
    await publish(result)
    const ops = broadcastOps()
    expect(ops.map(([type]) => type)).toEqual(['comment', 'comment_options', 'comment'])
    expect(ops[2][1]).toEqual({
      parent_author: 'alice',
      parent_permlink: 'orig-video',
      author: 'badadib',
      permlink: `re-alice-${NOW.getTime()}`,
      title: '',
      body: `I created a remix/clip from this video!\n\nCheck it out: [My First Video!](${window.location.origin}/@badadib/${PERMLINK})`,
      json_metadata: JSON.stringify({ app: '3speak/embed', tags: ['3speak'], oa: { v: 1, object: 'Comment' } }),
    })
  })

  it('credits the whole chain in the body, the metadata and the splits', async () => {
    const { result } = await ready(asRemix)
    await publish(result)
    expect(postOp().body).toContain(`*Based on a video by [@alice](${window.location.origin}/@alice/orig-video)*`)
    expect(postOp().body).toContain('Earlier in this remix chain: [@bob]')
    expect(meta().video).toMatchObject({
      reusable: true,   // a remix stays remixable whatever the toggle says
      originalAuthor: 'alice',
      originalPermlink: 'orig-video',
      remixChain: [{ author: 'alice', permlink: 'orig-video' }, { author: 'bob', permlink: 'first' }],
    })
    expect(optionsOp().extensions[0][1].beneficiaries).toEqual([
      { account: 'alice', weight: 500 },
      { account: 'bob', weight: 500 },
      ...LOCKED_SPLITS,
    ])
  })

  it('a ButrAuth login signs the remix transaction with its posting key', async () => {
    h.fns.getCurrentProvider.mockReturnValue(null)
    const { result } = await ready(asRemix)
    await publish(result)
    const [ops, keyType] = h.fns.broadcastWithAioha.mock.calls[0]
    expect(ops.map(([type]) => type)).toEqual(['comment', 'comment_options', 'comment'])
    expect(keyType).toBe('posting')
  })
})

describe('an incubating creator (no Hive account yet)', () => {
  beforeEach(() => {
    h.state.store = { user: null, incubationHandle: 'newbie' }
    h.tus.embedUrl = 'https://play.3speak.tv/embed?v=newbie/srv-id-9'
    h.fns.broadcastViaThreespeak.mockResolvedValue({ success: true, incubation: true })
  })

  it('posts under the asset\'s own id, without banner or reblog', async () => {
    const { result } = await ready((c) => {
      c.setOriginalAuthor('alice')
      c.setOriginalPermlink('orig-video')
    })
    await publish(result)
    expect(h.fns.broadcastViaThreespeak).toHaveBeenCalledTimes(1)
    const ops = broadcastOps()
    // One post, not the atomic remix pair.
    expect(ops.map(([type]) => type)).toEqual(['comment', 'comment_options'])
    expect(postOp().permlink).toBe('srv-id-9')
    expect(postOp().body).toContain(watchLine('/@newbie/srv-id-9'))
    expect(postOp().body).not.toContain('/banners/')
    expect(meta().video.info).toMatchObject({ author: 'newbie', permlink: 'srv-id-9' })
  })

  it('writes nothing that needs a Hive post: no embed link, no ad sync, no import mark', async () => {
    const { result } = await ready((c) => {
      c.setVideoAdsEnabled(false)
      c.setImportSource({ id: 'yt-1', platform: 'youtube', url: 'https://youtu.be/1' })
    })
    await publish(result)
    expect(fetchTo('/hive')).toHaveLength(0)
    expect(h.fns.syncVideoAdOptOut).not.toHaveBeenCalled()
    expect(h.fns.markImportPublished).not.toHaveBeenCalled()
    expect(result.current.completed).toBe(true)
  })
})

describe('the encode', () => {
  it('a gated video is encoded encrypted, with its allowlist, and marked in the post', async () => {
    h.state.tokenData = { ...h.state.tokenData, gated: true }
    const { result } = await ready((c) => { c.setGated(true); c.setGatedAllowlist(['alice']) })
    await publish(result)
    expect(encodeCalls()[0][1]).toEqual({ gated: true, allowlist: ['alice'] })
    expect(meta()).toMatchObject({ gated: true, gatedVideoId: 'asset-1' })
  })

  it('"not ready yet" from the server is waited out', async () => {
    vi.useRealTimers()
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    let refusals = 0
    h.fns.axiosPost.mockImplementation(async (url) => {
      if (url.endsWith('/encode') && refusals++ < 2) {
        throw Object.assign(new Error('409'), { response: { status: 409, data: { code: refusals === 1 ? 'not_awaiting_encode' : 'not_pinned' } } })
      }
      return url.endsWith('/uploads/token') ? { data: h.state.tokenData } : { status: 201, data: {} }
    })
    const { result } = await ready()
    let done
    act(() => { done = result.current.publishToEmbed() })
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(result.current.statusText).toBe('upload.publishing.finishingOnServer')
    nothingPosted()
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); await done })
    expect(encodeCalls()).toHaveLength(3)
    expect(result.current.completed).toBe(true)
  })

  it.each([401, 403, 404])('a real refusal (%i) fails at once, before the post exists', async (status) => {
    h.fns.axiosPost.mockImplementation(async (url) => {
      if (url.endsWith('/encode')) throw Object.assign(new Error(`HTTP ${status}`), { response: { status, data: {} } })
      return { data: h.state.tokenData }
    })
    const { result } = await ready()
    await publish(result)
    expect(encodeCalls()).toHaveLength(1)
    expect(h.fns.toastError).toHaveBeenCalledWith(`upload.errors.uploadFailedWith {"msg":"HTTP ${status}"}`)
    nothingPosted()
  })

  it('turning "gated" on after a non-deferred upload refuses rather than publish in the clear', async () => {
    h.state.tokenData = { token: 'up-tok', gated: false }
    const { result } = await ready()
    act(() => result.current.startEarlyUpload())
    await waitFor(() => expect(result.current.videoUploadStatus).toBe('done'))
    act(() => result.current.setGated(true))
    await publish(result)
    expect(h.fns.toastError).toHaveBeenCalledWith('upload.errors.uploadFailedWith {"msg":"upload.errors.gatedTooLate"}')
    expect(encodeCalls()).toHaveLength(0)
    nothingPosted()
  })

  it('a chunked upload that landed on another permlink is refused: its token belongs elsewhere', async () => {
    h.tus.behaviour = (up) => up.options.onError(Object.assign(new Error('blocked'), { code: 'PATCH_BLOCKED' }))
    h.xhr.server.finishPermlink = 'another-asset'
    const { result } = await ready()
    await publish(result)
    expect(h.fns.toastError).toHaveBeenCalledWith('upload.errors.uploadFailedWith {"msg":"upload.errors.deferralLost"}')
    expect(encodeCalls()).toHaveLength(0)
    nothingPosted()
  })
})

describe('after the post is out', () => {
  it.each([
    ['ads off', (c) => c.setVideoAdsEnabled(false), { ads: false }, 'upload.publishing.log.adsOffSaved'],
    ['rolls off', (c) => c.setVideoRollsEnabled(false), { rolls: false }, 'upload.publishing.log.rollsOffSaved'],
  ])('%s is written into the post and synced to the checker', async (_label, setup, flag, logged) => {
    const { result } = await ready(setup)
    await publish(result)
    expect(meta()['3speak']).toEqual(flag)
    expect(h.fns.syncVideoAdOptOut).toHaveBeenCalledWith('badadib', PERMLINK)
    expect(result.current.statusMessages).toContainEqual(expect.objectContaining({ message: logged, type: 'success' }))
  })

  it('a failed ad sync is surfaced, since ads would otherwise play', async () => {
    h.fns.syncVideoAdOptOut.mockRejectedValue(new Error('down'))
    const { result } = await ready((c) => c.setVideoAdsEnabled(false))
    await publish(result)
    expect(h.fns.toastError).toHaveBeenCalledWith('upload.publishing.adsOffFailedToast')
    expect(result.current.completed).toBe(true)
  })

  it('a channel trailer is pinned once the post exists; a failure is a warning', async () => {
    const { result } = await ready((c) => c.setIsChannelTrailer(true))
    await publish(result)
    expect(h.fns.setChannelTrailer).toHaveBeenCalledWith('badadib', PERMLINK, { author: 'badadib' })

    h.fns.setChannelTrailer.mockRejectedValue(new Error('not yours'))
    const again = await ready((c) => c.setIsChannelTrailer(true))
    await publish(again.result)
    expect(h.fns.toastError).toHaveBeenCalledWith('upload.publishing.trailerFailedToast')
    expect(again.result.current.completed).toBe(true)
  })

  it('an imported video records where it came from and is marked as published', async () => {
    const { result } = await ready((c) => c.setImportSource({ id: 'tiktok:123', platform: 'tiktok', url: 'https://tiktok.com/@x/video/123' }))
    await publish(result)
    expect(meta().imported_from).toEqual({ platform: 'tiktok', id: '123', url: 'https://tiktok.com/@x/video/123' })
    expect(h.fns.markImportPublished).toHaveBeenCalledWith('tiktok:123', PERMLINK)
  })
})

describe('a scheduled post', () => {
  const asScheduled = (c) => { c.setIsScheduled(true); c.setScheduleDateTime('2026-11-06T10:00') }
  const scheduleCall = () => h.fns.axiosPost.mock.calls.find(([url]) => url.endsWith('/scheduled-posts/create'))

  it('is handed to the checker instead of being broadcast', async () => {
    const { result } = await ready(asScheduled)
    await publish(result)
    const [url, body, config] = scheduleCall()
    expect(url).toBe('https://prod-checker.okinoko.io/scheduled-posts/create')
    expect(config).toEqual({ headers: { Authorization: 'Bearer checker-key' } })
    expect(body).toMatchObject({
      owner: 'badadib',
      permlink: PERMLINK,
      scheduledOn: new Date('2026-11-06T10:00').toISOString(),
      title: 'My First Video!',
      description: 'About things',
      tags: ['hive-181335', 'travel'],
      beneficiaries: LOCKED_SPLITS,
      payoutOptions: 'default',
      thumbnail: null,
      parentAuthor: '',
      parentPermlink: 'hive-181335',
      embedPermlink: 'asset-1',
      reblog: true,
    })
    expect(body.body).toContain(h.EMBED_URL)
    expect(body.jsonMetadata.app).toBe('3speak/embed')
    expect(body).toMatchObject({ signature: 'OWNER-SIG', timestamp: 4242 })
    nothingPosted()
    expect(fetchTo('/hive')).toHaveLength(0)
    expect(result.current).toMatchObject({ completed: true, uploading: false, uploadProgress: 100 })
    expect(h.fns.toastSuccess).toHaveBeenCalledWith('upload.publishing.scheduled')
  })

  it('asks once for @threespeak posting authority when it is missing', async () => {
    h.fns.hasThreespeakPostingAuth.mockResolvedValue(false)
    const { result } = await ready(asScheduled)
    await publish(result)
    expect(h.fns.addThreespeakToPostingAuth).toHaveBeenCalledWith('badadib')
    expect(scheduleCall()).toBeDefined()
  })

  it('does not ask when the authority is already there', async () => {
    const { result } = await ready(asScheduled)
    await publish(result)
    expect(h.fns.addThreespeakToPostingAuth).not.toHaveBeenCalled()
  })

  it.each([
    [(c) => c.SetDeclineRewards(true), 'decline'],
    [(c) => c.setRewardPowerup(true), 'powerup'],
  ])('carries the payout choice (%#)', async (setup, payout) => {
    const { result } = await ready((c) => { asScheduled(c); setup(c) })
    await publish(result)
    expect(scheduleCall()[1].payoutOptions).toBe(payout)
  })

  it('goes to the configured checker when one is set', async () => {
    vi.stubEnv('VITE_SCHEDULED_POSTS_API_URL', 'https://checker.test/')
    const { result } = await ready(asScheduled)
    await publish(result)
    expect(scheduleCall()[0]).toBe('https://checker.test/scheduled-posts/create')
  })

  it('a checker that does not confirm fails the upload with its reason', async () => {
    h.fns.axiosPost.mockImplementation(async (url) => {
      if (url.endsWith('/scheduled-posts/create')) return { status: 200, data: { success: false, error: 'too soon' } }
      if (url.endsWith('/uploads/token')) return { data: h.state.tokenData }
      return { status: 201, data: {} }
    })
    const { result } = await ready(asScheduled)
    await publish(result)
    expect(h.fns.toastError).toHaveBeenCalledWith('upload.errors.scheduleFailed {"msg":"too soon"}')
    expect(result.current.completed).toBe(false)
    nothingPosted()
  })

  it('is signed by its owner right before it is sent, over the very scheduledOn it sends', async () => {
    const { result } = await ready(asScheduled)
    await publish(result)
    const [, body] = scheduleCall()
    expect(h.fns.proveScheduledPost).toHaveBeenCalledTimes(1)
    expect(h.fns.proveScheduledPost).toHaveBeenCalledWith({ action: 'create', owner: 'badadib', permlink: PERMLINK, scheduledOn: body.scheduledOn })
    const signedAt = h.fns.proveScheduledPost.mock.invocationCallOrder[0]
    const sentAt = h.fns.axiosPost.mock.invocationCallOrder[h.fns.axiosPost.mock.calls.indexOf(scheduleCall())]
    expect(h.fns.hasThreespeakPostingAuth.mock.invocationCallOrder[0]).toBeLessThan(signedAt)
    expect(signedAt).toBeLessThan(sentAt)
  })

  it('without a signature (the checker still takes that) it is scheduled unsigned, as before', async () => {
    h.fns.proveScheduledPost.mockResolvedValue({})
    const { result } = await ready(asScheduled)
    await publish(result)
    const [, body] = scheduleCall()
    expect(body).not.toHaveProperty('signature')
    expect(body).not.toHaveProperty('timestamp')
    expect(result.current.completed).toBe(true)
  })

  it('a signature that cannot be had fails the upload with the reason, and keeps it to retry', async () => {
    const { ScheduledPostProofError } = await import('../../../src/utils/scheduledPostProof.js')
    h.fns.proveScheduledPost.mockRejectedValue(new ScheduledPostProofError('no_grant', 'badadib'))
    const { result } = await ready(asScheduled)
    await publish(result)
    expect(scheduleCall()).toBeUndefined()
    expect(h.fns.toastError).toHaveBeenCalledWith('upload.errors.scheduleFailed {"msg":"studio.scheduled.proof.noGrant"}')
    expect(result.current).toMatchObject({ completed: false, uploading: false })
    expect(result.current.title).toBe('My First Video!')
    nothingPosted()
  })

  it('the checker refusing it for want of a signature is said in words', async () => {
    h.fns.axiosPost.mockImplementation(async (url) => {
      if (url.endsWith('/scheduled-posts/create')) throw Object.assign(new Error('Request failed with status code 401'), { response: { status: 401, data: { error: 'Signature required' } } })
      if (url.endsWith('/uploads/token')) return { data: h.state.tokenData }
      return { status: 201, data: {} }
    })
    const { result } = await ready(asScheduled)
    await publish(result)
    expect(h.fns.toastError).toHaveBeenCalledWith('upload.errors.scheduleFailed {"msg":"studio.scheduled.proof.refused"}')
    expect(result.current.completed).toBe(false)
  })

  it('a short is never scheduled', async () => {
    const { result } = await ready((c) => { asScheduled(c); c.setFromStories(true) })
    await publish(result)
    expect(scheduleCall()).toBeUndefined()
    expect(h.fns.proveScheduledPost).not.toHaveBeenCalled()
    expect(h.fns.broadcastViaThreespeak).toHaveBeenCalled()
  })
})

describe('a prefilled upload (pushed to the embed service by another uploader)', () => {
  it('skips the upload and posts under the permlink it was given', async () => {
    const { result } = await ready((c) => {
      c.setVideoFile(null)
      c.setPrefilledFromQuery({ permlink: 'hangout-rec-1', owner: 'badadib', embedUrl: 'https://play.3speak.tv/embed?v=badadib/hangout-rec-1' })
    })
    await publish(result)
    expect(h.tus.uploads).toHaveLength(0)
    expect(encodeCalls()).toHaveLength(0)
    expect(postOp().permlink).toBe('hangout-rec-1')
    // No local file: the orientation is unknown, so the attribute is left out.
    expect(meta()).not.toHaveProperty('threespeak.video')
    expect(fetchTo('/video/hangout-rec-1/hive')[0][0]).toBe(`${h.RELIABLE_BASE}/video/hangout-rec-1/hive`)
    expect(result.current.completed).toBe(true)
  })
})
