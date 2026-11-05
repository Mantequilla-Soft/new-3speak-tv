// The upload wizard's form state (src/context/EmbedUploadContext.jsx): what a new
// upload starts with, the locked 3Speak splits shown to non-Pro and Pro creators,
// the quick story cover pick, the prefilled flow, and the two resets (pick another
// video, start over) including the in-flight upload they must cancel.
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

const { EmbedUploadProvider, useEmbedUpload } = await import('../../../src/context/EmbedUploadContext.jsx')

const mount = () => renderHook(() => useEmbedUpload(), { wrapper: EmbedUploadProvider })
const LOCKED = [
  { account: 'threespeakfund', percent: 10, locked: true, minPercent: 10 },
  { account: 'encoder.pay', percent: 1, locked: true, minPercent: 1 },
]
// A 1x1 PNG, as a generated thumbnail frame.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

beforeEach(() => {
  h.reset()
  localStorage.clear()
  vi.stubGlobal('XMLHttpRequest', h.FakeXHR)
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { window.history.replaceState(null, '', '/') })

describe('a new upload', () => {
  it('starts on step one with the 3Speak community and an empty form', () => {
    const { result } = mount()
    expect(result.current).toMatchObject({
      step: 1,
      videoFile: null,
      title: '',
      description: '',
      tagsPreview: [],
      community: 'hive-181335',
      declineRewards: false,
      isNsfw: false,
      videoAdsEnabled: true,
      videoRollsEnabled: true,
      reusable: true,
      gated: false,
      uploading: false,
      completed: false,
      uploadProgress: 0,
      videoUploadStatus: 'idle',
      selectedEndpoint: '',
      prefilled: false,
      user: 'badadib',
      isPremium: false,
    })
    expect(result.current.navigate).toBe(h.fns.navigate)
  })

  it('shows a non-Pro creator the locked fund and encoder splits', () => {
    const { result } = mount()
    expect(result.current.list).toEqual(LOCKED)
    expect(result.current.remaingPercent).toBe(89)
  })

  it('drops both locked splits for a Pro creator once the status lands', async () => {
    h.state.premium = { premium: true }
    const { result } = mount()
    await waitFor(() => expect(result.current.list).toEqual([]))
    expect(result.current.remaingPercent).toBe(100)
  })

  it('keeps the encoder split for a Pro creator grandfathered into paying it', async () => {
    h.state.store = { user: 'meno', incubationHandle: null }
    h.state.premium = { premium: true }
    const { result } = mount()
    await waitFor(() => expect(result.current.list).toEqual([LOCKED[1]]))
    expect(result.current.remaingPercent).toBe(99)
  })

  it('remembers "Add to my blog" for the next upload', () => {
    const first = mount()
    expect(first.result.current.addToBlog).toBe(true)
    act(() => first.result.current.setAddToBlog(false))
    expect(first.result.current.addToBlog).toBe(false)
    first.unmount()
    expect(mount().result.current.addToBlog).toBe(false)
  })

  it('cleans music credits before keeping them', () => {
    const { result } = mount()
    act(() => result.current.setMusicCredits([
      { title: 'Song [one]', artist: 'Band', source: 'pixabay' },
      { title: '' },
      { title: 'Sound', source: '3speak', account: 'not a hive name!' },
      null,
    ]))
    expect(result.current.musicCredits).toEqual([expect.objectContaining({ title: 'Song one', artist: 'Band', source: 'pixabay' })])
  })

  it.each([
    ['?devstep=3', 3],
    ['?devstep=9', 1],
    ['?devstep=x', 1],
  ])('the dev shortcut %s opens step %i', (query, step) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    window.history.replaceState(null, '', `/embed-studio${query}`)
    expect(mount().result.current.step).toBe(step)
  })
})

describe('the quick story cover', () => {
  it('takes the first generated frame as the thumbnail', () => {
    const { result } = mount()
    let ok
    act(() => { ok = result.current.pickFirstThumbnail([PNG, 'data:image/png;base64,AAAA']) })
    expect(ok).toBe(true)
    expect(result.current).toMatchObject({ selectedIndex: 0, selectedThumbnail: PNG, thumbnailDesign: null, editedThumbnail: null })
    expect(result.current.thumbnailFile).toBeInstanceOf(Blob)
    expect(result.current.thumbnailFile.type).toBe('image/png')
  })

  it.each([[[]], [null]])('reports no frame (%j) so the caller can show the step instead', (thumbs) => {
    const { result } = mount()
    let ok
    act(() => { ok = result.current.pickFirstThumbnail(thumbs) })
    expect(ok).toBe(false)
    expect(result.current.selectedThumbnail).toBeNull()
  })
})

describe('a prefilled upload (already on the embed service)', () => {
  it('carries the external permlink, owner and embed URL', () => {
    const { result } = mount()
    act(() => result.current.setPrefilledFromQuery({ permlink: 'rec-1', owner: 'badadib', embedUrl: h.EMBED_URL }))
    expect(result.current).toMatchObject({
      prefilled: true,
      prefilledPermlink: 'rec-1',
      prefilledOwner: 'badadib',
      prefilledEmbedUrl: h.EMBED_URL,
      embedUrl: h.EMBED_URL,
    })
  })

  it('treats missing values as empty', () => {
    const { result } = mount()
    act(() => result.current.setPrefilledFromQuery({}))
    expect(result.current).toMatchObject({ prefilled: true, prefilledPermlink: '', prefilledOwner: '', embedUrl: '' })
  })

  it('never starts a background upload', () => {
    const { result } = mount()
    act(() => { result.current.setPrefilledFromQuery({ permlink: 'rec-1', embedUrl: h.EMBED_URL }); result.current.setVideoFile(h.videoFile()) })
    act(() => result.current.startEarlyUpload())
    expect(result.current.videoUploadStatus).toBe('idle')
    expect(h.tus.uploads).toHaveLength(0)
  })
})

describe('picking another video (clearVideoSelection)', () => {
  it('clears the video and everything derived from it, but keeps the details', () => {
    const { result } = mount()
    act(() => {
      result.current.setVideoFile(h.videoFile())
      result.current.setVideoDuration(30)
      result.current.setVideoMode('shorts')
      result.current.setGeneratedThumbnail([PNG])
      result.current.setSelectedThumbnail(PNG)
      result.current.setThumbnailExtras([{ src: PNG, kind: 'custom' }])
      result.current.setChapters([{ _k: 1, t: 0, title: 'Intro' }])
      result.current.setTimelineSeeded(true)
      result.current.setTitle('Keep me')
    })
    act(() => result.current.clearVideoSelection())
    expect(result.current).toMatchObject({
      videoFile: null,
      videoDuration: 0,
      videoMode: null,
      generatedThumbnail: [],
      selectedThumbnail: null,
      thumbnailExtras: [],
      chapters: [],
      timelineSeeded: false,
      videoUploadStatus: 'idle',
      title: 'Keep me',
    })
  })
})

describe('starting over (resetUploadState)', () => {
  it('returns every field to its default and forgets stored resume state', () => {
    localStorage.setItem('tus::https://embed2.test::abc', '{}')
    localStorage.setItem('unrelated', 'kept')
    const { result } = mount()
    act(() => {
      result.current.setStep(5)
      result.current.setTitle('Old')
      result.current.setDescription('Old body')
      result.current.setTagsPreview(['a'])
      result.current.setCommunity('hive-1')
      result.current.setIsNsfw(true)
      result.current.SetDeclineRewards(true)
      result.current.setIsScheduled(true)
      result.current.setFromStories(true)
      result.current.setIsStory(true)
      result.current.setOriginalAuthor('alice')
      result.current.setCompleted(true)
      result.current.setImportSource({ id: 'yt1', platform: 'youtube' })
      result.current.setList([])
      result.current.setPrefilledFromQuery({ permlink: 'p' })
    })
    act(() => result.current.resetUploadState())
    expect(result.current).toMatchObject({
      step: 1, title: '', description: '', tagsPreview: [], community: 'hive-181335', isNsfw: false,
      declineRewards: false, isScheduled: false, fromStories: false, isStory: false, originalAuthor: null,
      completed: false, importSource: null, prefilled: false, embedUrl: '', statusMessages: [],
      list: LOCKED, remaingPercent: 89,
    })
    expect(localStorage.getItem('tus::https://embed2.test::abc')).toBeNull()
    expect(localStorage.getItem('unrelated')).toBe('kept')
  })

  it('re-seeds no locked splits for a Pro creator', async () => {
    h.state.premium = { premium: true }
    const { result } = mount()
    await waitFor(() => expect(result.current.list).toEqual([]))
    act(() => result.current.resetUploadState())
    expect(result.current.list).toEqual([])
    expect(result.current.remaingPercent).toBe(100)
  })

  it('aborts a background upload that is still running', async () => {
    h.tus.behaviour = 'hang'
    const { result } = mount()
    act(() => result.current.setVideoFile(h.videoFile()))
    act(() => result.current.startEarlyUpload())
    await waitFor(() => expect(h.tus.uploads).toHaveLength(1))
    act(() => result.current.resetUploadState())
    expect(h.tus.uploads[0].abort).toHaveBeenCalled()
    expect(result.current.videoUploadStatus).toBe('idle')
  })
})

describe('useEmbedUpload', () => {
  it('outside the provider is a programming error', () => {
    expect(() => renderHook(() => useEmbedUpload())).toThrow('useEmbedUpload must be used within EmbedUploadProvider')
  })
})
