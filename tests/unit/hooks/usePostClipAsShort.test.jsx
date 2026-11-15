// H13: a stream clip goes into the normal Shorts upload with the other side's
// locked share in the beneficiary list and on the context for publishing.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const h = vi.hoisted(() => ({ ctx: {}, navigate: vi.fn(), thumbs: vi.fn() }))
vi.mock('../../../src/context/EmbedUploadContext', () => ({ useEmbedUpload: () => h.ctx }))
vi.mock('react-router-dom', async (orig) => ({ ...(await orig()), useNavigate: () => h.navigate }))
vi.mock('../../../src/utils/videoThumbnails', () => ({ generateVideoThumbnailsAt: h.thumbs }))

const { useAppStore } = await import('../../../src/lib/store')
const { usePostClipAsShort } = await import('../../../src/hooks/usePostClipAsShort.js')

const setters = ['setVideoFile', 'setPrevVideoFile', 'setVideoDuration', 'setGeneratedThumbnail', 'setFromStories', 'setIsStory', 'setVideoMode', 'setOriginalAuthor', 'setOriginalPermlink', 'setOriginalShortPermlink', 'setRemixChain', 'setList', 'setRemaingPercent', 'setStreamClip']

beforeEach(() => {
  h.ctx = { isPremium: false }
  for (const s of setters) h.ctx[s] = vi.fn()
  h.navigate.mockReset()
  h.thumbs.mockReset().mockResolvedValue(['data:image/jpeg;base64,AA'])
  globalThis.fetch = vi.fn(async () => ({ ok: true, blob: async () => new Blob(['MP4'], { type: 'video/mp4' }) }))
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:x')
  globalThis.URL.revokeObjectURL = vi.fn()
  // jsdom never loads media: answer the metadata probe at once.
  const orig = Document.prototype.createElement
  vi.spyOn(document, 'createElement').mockImplementation(function (tag) {
    const el = orig.call(document, tag)
    if (tag === 'video') Object.defineProperty(el, 'src', { set() { queueMicrotask(() => el.onerror?.()) } })
    return el
  })
})

afterEach(() => vi.restoreAllMocks())

describe('usePostClipAsShort', () => {
  it('the host posting a viewer\'s clip: Shorts flow with the clipper\'s locked 10 % row', async () => {
    useAppStore.setState({ user: 'badadib' })
    const { result } = renderHook(() => usePostClipAsShort())
    await act(() => result.current.post({ url: 'https://live.3speak.tv/dvr/clips/a.mp4', room: 'badadib-r1', host: 'badadib', clipper: 'fan', offsetSec: 60 }))
    const file = h.ctx.setVideoFile.mock.calls[0][0]
    expect(file).toBeInstanceOf(File)
    expect(h.ctx.setFromStories).toHaveBeenCalledWith(true)
    expect(h.ctx.setOriginalAuthor).toHaveBeenCalledWith(null)
    expect(h.ctx.setGeneratedThumbnail).toHaveBeenCalledWith(['data:image/jpeg;base64,AA'])
    expect(h.ctx.setStreamClip).toHaveBeenCalledWith({ room: 'badadib-r1', host: 'badadib', clipper: 'fan', offsetSec: 60, share: { account: 'fan', percent: 10, role: 'clipper' } })
    expect(h.ctx.setList).toHaveBeenCalledWith([
      { account: 'threespeakfund', percent: 10, locked: true, minPercent: 10 },
      { account: 'encoder.pay', percent: 1, locked: true, minPercent: 1 },
      { account: 'fan', percent: 10, locked: true, minPercent: 10 },
    ])
    expect(h.ctx.setRemaingPercent).toHaveBeenCalledWith(79)
    expect(h.navigate).toHaveBeenCalledWith('/embed-studio/thumbnail?from=stories')
  })

  it('a Pro host posting their own clip: no extra share; a failed thumbnail still posts', async () => {
    useAppStore.setState({ user: 'badadib' })
    h.ctx.isPremium = true
    h.thumbs.mockRejectedValue(new Error('no frames'))
    const { result } = renderHook(() => usePostClipAsShort())
    await act(() => result.current.post({ url: 'u', room: 'r', host: 'badadib', clipper: 'badadib' }))
    expect(h.ctx.setStreamClip).toHaveBeenCalledWith(expect.objectContaining({ share: null }))
    expect(h.ctx.setGeneratedThumbnail).toHaveBeenCalledWith([])
    expect(h.ctx.setRemaingPercent).toHaveBeenCalledWith(100)
  })

  it('a clip that cannot be fetched throws and navigates nowhere', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404 }))
    const { result } = renderHook(() => usePostClipAsShort())
    await expect(act(() => result.current.post({ url: 'u', room: 'r', host: 'badadib', clipper: 'fan' }))).rejects.toThrow()
    expect(h.navigate).not.toHaveBeenCalled()
    expect(result.current.busy).toBe(false)
  })
})
