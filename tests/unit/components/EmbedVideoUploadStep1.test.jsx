// @vitest-environment jsdom
// The first step of the video upload (components/embed-studio/EmbedVideoUploadStep1.jsx):
// picking a file, by the button or by drag and drop, is checked (a video, at most
// 5 GB; for shorts, short enough and vertical), its frames become thumbnail
// choices, and Proceed moves to the thumbnail step. Before any of that, a wallet
// login must have granted @threespeak posting authority, and an account without
// enough Resource Credits is told why it cannot upload yet.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderWithProviders, stubMatchMedia, toastMessages } from './_render.jsx'

const m = vi.hoisted(() => ({}))
vi.mock('sonner', async () => (await import('./_render.jsx')).sonnerModule())
// The weekly Shorts challenge depends on the date: none unless a test sets one
vi.mock('../../../src/lib/shortsChallenge', async (importOriginal) => ({
  ...(await importOriginal()),
  useCurrentChallenge: () => m.challenge || null,
}))
vi.mock('../../../src/hive-api/aioha', async () => (await import('./_render.jsx')).aiohaModule({
  getCurrentProvider: () => m.provider,
}))
vi.mock('../../../src/utils/postingAuthority', () => ({
  hasThreespeakPostingAuth: (...a) => m.hasAuth(...a),
  addThreespeakToPostingAuth: (...a) => m.addAuth(...a),
}))
vi.mock('../../../src/utils/rcCheck', async (importOriginal) => ({ ...(await importOriginal()), checkPostingRc: (...a) => m.rc(...a) }))
vi.mock('../../../src/utils/videoThumbnails', () => ({ generateVideoThumbnailsAt: (...a) => m.thumbs(...a) }))
vi.mock('../../../src/utils/uploadFaults', () => ({
  canUseUploadFaults: () => false, getUploadFaults: () => ({}), setUploadFaults: () => ({}), initUploadFaults: () => {},
}))
vi.mock('../../../src/hooks/useCanImportVideos', () => ({ default: () => false }))
// ⏳ The free plan's daily counters (hooks/useUploadQuota.js), steered per test
vi.mock('../../../src/hooks/useUploadQuota', () => ({ default: () => m.quota, useUploadQuota: () => m.quota }))
// ⏳ The free plan's daily publish limit (hooks/usePublishQuota.js), steered per test
vi.mock('../../../src/hooks/usePublishQuota', () => ({
  default: (opts) => { m.publishAsked?.(opts); return { ready: true, quota: m.publish?.[opts.kind] ?? null, blocked: !!m.publish?.[opts.kind] } },
}))
vi.mock('../../../src/utils/config', async (importOriginal) => ({ ...(await importOriginal()), ENABLE_SUBS: true, FEATURE_EDITOR: true }))
vi.mock('../../../src/hooks/usePremiumStatus', () => ({ usePremiumStatus: () => m.premium }))
vi.mock('ldrs/react', () => ({ TailChase: () => <span role="status">Working</span> }))
// The upload wizard's shared state, kept in this component so its updates render.
vi.mock('../../../src/context/EmbedUploadContext', async () => {
  const { useState: useLocal } = await import('react')
  return {
    useEmbedUpload: () => {
      const [videoFile, setVideoFile] = useLocal(null)
      const [generatedThumbnail, setGeneratedThumbnail] = useLocal([])
      const [isStory, setIsStory] = useLocal(m.isStory)
      const spy = (name, fn) => (...a) => { m.calls[name]?.(...a); return fn?.(...a) }
      return {
        user: m.user,
        uploadLimit: m.uploadLimit,
        fromStories: m.fromStories,
        isStory,
        setIsStory: spy('setIsStory', setIsStory),
        videoFile,
        setVideoFile: spy('setVideoFile', setVideoFile),
        generatedThumbnail,
        setGeneratedThumbnail: spy('setGeneratedThumbnail', setGeneratedThumbnail),
        setPrevVideoFile: spy('setPrevVideoFile'),
        setVideoDuration: spy('setVideoDuration'),
        setVideoMode: spy('setVideoMode'),
        clearVideoSelection: spy('clearVideoSelection'),
        pickFirstThumbnail: (thumbs) => (thumbs?.length ? m.calls.pickFirst?.(thumbs) ?? true : false),
      }
    },
  }
})

const { toast } = await import('sonner')
const { useAppStore } = await import('../../../src/lib/store')
const { default: Step1 } = await import('../../../src/components/embed-studio/EmbedVideoUploadStep1.jsx')

// jsdom reads no media: the metadata of each new <video> is whatever m.meta says.
let saved
beforeAll(() => {
  const proto = HTMLMediaElement.prototype
  saved = ['src', 'duration', 'videoWidth', 'videoHeight'].map((k) => [k, Object.getOwnPropertyDescriptor(k === 'videoWidth' || k === 'videoHeight' ? HTMLVideoElement.prototype : proto, k)])
  Object.defineProperty(proto, 'src', {
    configurable: true,
    get() { return this.getAttribute('src') || '' },
    set(v) { this.setAttribute('src', v); queueMicrotask(() => { if (m.meta) this.onloadedmetadata?.(); else this.onerror?.() }) },
  })
  Object.defineProperty(proto, 'duration', { configurable: true, get: () => m.meta?.duration ?? NaN })
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => m.meta?.width ?? 0 })
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => m.meta?.height ?? 0 })
  URL.createObjectURL = () => 'blob:video'
  URL.revokeObjectURL = () => {}
})
afterAll(() => {
  for (const [k, d] of saved) {
    const target = k === 'videoWidth' || k === 'videoHeight' ? HTMLVideoElement.prototype : HTMLMediaElement.prototype
    if (d) Object.defineProperty(target, k, d); else delete target[k]
  }
})

const video = (name = 'clip.mp4', type = 'video/mp4', size) => {
  const f = new File(['data'], name, { type })
  if (size) Object.defineProperty(f, 'size', { value: size })
  return f
}
const input = () => document.getElementById('embed-video-upload')
const proceed = () => screen.getAllByRole('button', { name: 'Proceed to Thumbnails' })[0]

function mount() {
  return renderWithProviders(<Step1 />, { route: '/embed-studio' })
}
async function ready() {
  // A spinner is gone (an info banner is a status too, and stays)
  await waitFor(() => expect(screen.queryAllByRole('status').filter((el) => !el.classList.contains('v2-banner'))).toEqual([]))
}

beforeEach(() => {
  stubMatchMedia(false)
  Object.assign(m, {
    user: 'uploader', provider: null, fromStories: false, isStory: false, challenge: null,
    quota: { ready: true, exempt: false, video: null, short: null, audio: null },
    uploadLimit: null,
    publish: {},
    publishAsked: vi.fn(),
    premium: { premium: false },
    meta: { duration: 42, width: 1920, height: 1080 },
    hasAuth: vi.fn(async () => true),
    addAuth: vi.fn(async () => {}),
    rc: vi.fn(async () => ({ ok: true })),
    thumbs: vi.fn(async () => ['data:image/jpeg;base64,AAA']),
    calls: {
      setVideoFile: vi.fn(), setGeneratedThumbnail: vi.fn(), setPrevVideoFile: vi.fn(),
      setVideoDuration: vi.fn(), setVideoMode: vi.fn(), clearVideoSelection: vi.fn(), setIsStory: vi.fn(),
    },
  })
  useAppStore.setState({ user: 'uploader', incubationHandle: null })
})

describe('upload step 1: picking a video', () => {
  it('asks for a file, with Proceed held back until there is one', async () => {
    const { user } = mount()
    await ready()
    expect(screen.getByRole('heading', { name: 'Choose a video file' })).toBeInTheDocument()
    expect(screen.getByText('Supports: MP4, AVI, MOV, WMV (Max size: 5GB)')).toBeInTheDocument()
    const pick = vi.spyOn(input(), 'click').mockImplementation(() => {})
    await user.click(screen.getByRole('button', { name: 'Browse Files' }))
    expect(pick).toHaveBeenCalledTimes(1)
    expect(proceed()).toBeDisabled()
    expect(proceed()).toHaveAttribute('title', 'Please select a video file first.')
  })

  it('takes a video, reads its length and frames, and offers Proceed', async () => {
    const { user } = mount()
    await ready()
    const file = video()
    await user.upload(input(), file)
    expect(await screen.findByText('Video Selected. Proceed to upload thumbnail')).toBeInTheDocument()
    expect(m.thumbs).toHaveBeenCalledWith(file)
    expect(m.calls.setGeneratedThumbnail).toHaveBeenCalledWith(['data:image/jpeg;base64,AAA'])
    expect(m.calls.setVideoFile).toHaveBeenCalledWith(file)
    expect(m.calls.setVideoDuration).toHaveBeenCalledWith(42)
    expect(m.calls.setVideoMode).toHaveBeenCalledWith('longform')
    expect(screen.getByText('clip.mp4')).toBeInTheDocument()
    expect(screen.getByText('Replace Video')).toBeInTheDocument()
    expect(proceed()).toBeEnabled()
  })

  it('Proceed goes on to the thumbnail step', async () => {
    const { user } = mount()
    await ready()
    await user.upload(input(), video())
    await screen.findByText('Video Selected. Proceed to upload thumbnail')
    await user.click(proceed())
    expect(screen.getByTestId('location')).toHaveTextContent('/embed-studio/thumbnail')
  })

  it('refuses a file that is not a video', async () => {
    mount()
    await ready()
    fireEvent.change(input(), { target: { files: [video('notes.pdf', 'application/pdf')] } })
    await waitFor(() => expect(toastMessages(toast.error)).toEqual(['Please select a valid video file']))
    expect(m.calls.setVideoFile).not.toHaveBeenCalled()
  })

  it('refuses a video over 5 GB', async () => {
    const { user } = mount()
    await ready()
    await user.upload(input(), video('huge.mp4', 'video/mp4', 6 * 1024 ** 3))
    await waitFor(() => expect(toastMessages(toast.error)).toEqual(['Video is too large. Maximum allowed size is 5GB.']))
    expect(m.calls.setVideoFile).not.toHaveBeenCalled()
  })

  it('still takes a file whose frames cannot be read, and says a thumbnail can be added later', async () => {
    m.thumbs = vi.fn(async () => { throw new Error('decode') })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { user } = mount()
    await ready()
    await user.upload(input(), video('iphone.mov', 'video/quicktime'))
    await screen.findByText('Video Selected. Proceed to upload thumbnail')
    expect(toast).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ description: expect.stringMatching(/Couldn't auto-generate a thumbnail/) }))
    expect(m.calls.setGeneratedThumbnail).toHaveBeenCalledWith([])
  })

  it('still takes a file without readable metadata, with no length', async () => {
    m.meta = null
    const { user } = mount()
    await ready()
    await user.upload(input(), video())
    await screen.findByText('Video Selected. Proceed to upload thumbnail')
    expect(m.calls.setVideoDuration).toHaveBeenCalledWith(0)
  })

  it('takes a video dropped on the box', async () => {
    mount()
    await ready()
    const box = document.querySelector('.file-upload')
    const file = video()
    fireEvent.dragOver(box, { dataTransfer: { files: [file] } })
    expect(box).toHaveClass('is-dragging')
    fireEvent.drop(box, { dataTransfer: { files: [file] } })
    expect(box).not.toHaveClass('is-dragging')
    expect(await screen.findByText('Video Selected. Proceed to upload thumbnail')).toBeInTheDocument()
  })

  it('replacing a chosen video drops what belonged to the old one', async () => {
    const { user } = mount()
    await ready()
    await user.upload(input(), video('one.mp4'))
    await screen.findByText('one.mp4')
    expect(m.calls.clearVideoSelection).not.toHaveBeenCalled()
    await user.upload(input(), video('two.mp4'))
    await screen.findByText('two.mp4')
    expect(m.calls.clearVideoSelection).toHaveBeenCalledTimes(1)
  })

  it('says when the browser cannot preview the file (HEVC), which still uploads', async () => {
    const { user } = mount()
    await ready()
    await user.upload(input(), video('hevc.mov', 'video/quicktime'))
    await screen.findByText('hevc.mov')
    fireEvent.error(document.querySelector('video.video-preview'))
    expect(screen.getByText(/preview this HEVC clip/)).toBeInTheDocument()
  })
})

describe('upload step 1: shorts and stories', () => {
  beforeEach(() => { m.fromStories = true })

  it('points at this week\'s Shorts challenge, not for a Story or a normal video', async () => {
    m.challenge = { week: '2026-W48', tag: 'challenge2026w48', theme: 'workspace', texts: { en: { title: 'Your workspace', prompt: 'Show where you create.' } } }
    const { unmount } = mount()
    await ready()
    expect(screen.getByRole('link', { name: /This week's Shorts challenge: Your workspace/ })).toHaveAttribute('href', '/challenge')
    unmount()
    m.isStory = true
    mount()
    await ready()
    expect(screen.queryByRole('link', { name: /Shorts challenge/ })).toBeNull()
  })

  it('says shorts must be short and vertical', async () => {
    mount()
    await ready()
    expect(screen.getByText(/Shorts must be under .* and recorded vertically/)).toBeInTheDocument()
  })

  it('refuses a short that is too long', async () => {
    m.meta = { duration: 600, width: 1080, height: 1920 }
    const { user } = mount()
    await ready()
    await user.upload(input(), video())
    await waitFor(() => expect(toastMessages(toast.error)[0]).toMatch(/^Shorts must be .* or less\. Your video is 600s\.$/))
    expect(m.calls.setVideoFile).not.toHaveBeenCalled()
  })

  it('refuses a horizontal short', async () => {
    m.meta = { duration: 30, width: 1920, height: 1080 }
    const { user } = mount()
    await ready()
    await user.upload(input(), video())
    await waitFor(() => expect(toastMessages(toast.error)).toEqual([expect.stringMatching(/must be vertical/)]))
  })

  it('takes a vertical short as a short', async () => {
    m.meta = { duration: 30, width: 1080, height: 1920 }
    const { user } = mount()
    await ready()
    await user.upload(input(), video())
    await screen.findByText('Video Selected. Proceed to upload thumbnail')
    expect(m.calls.setVideoMode).toHaveBeenCalledWith('shorts')
  })

  it('a story goes straight to posting, its first frame the cover', async () => {
    m.meta = { duration: 30, width: 1080, height: 1920 }
    const { user } = mount()
    await ready()
    await user.click(screen.getByRole('switch', { name: /Post as a 24h story/ }))
    expect(m.calls.setIsStory).toHaveBeenCalledWith(true)
    await user.upload(input(), video())
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/embed-studio/preview'))
  })
})

describe('upload step 1: before a file can be picked', () => {
  it('asks a wallet login to authorize @threespeak first, and lets it', async () => {
    m.provider = 'keychain'
    m.hasAuth = vi.fn(async () => false)
    const { user } = mount()
    await ready()
    expect(m.hasAuth).toHaveBeenCalledWith('uploader')
    expect(screen.getByText(/To upload, allow/)).toHaveTextContent('To upload, allow @threespeak to post on your behalf.')
    expect(input()).toBeDisabled()
    expect(screen.queryByRole('heading', { name: 'Choose a video file' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Authorize' }))
    expect(m.addAuth).toHaveBeenCalledWith('uploader', { signWindow: null })
    expect(await screen.findByRole('heading', { name: 'Choose a video file' })).toBeInTheDocument()
    expect(toastMessages(toast.success)).toContain('@threespeak authorized — you can now select a video')
  })

  it('stays on the gate when the authorization fails', async () => {
    m.provider = 'keychain'
    m.hasAuth = vi.fn(async () => false)
    m.addAuth = vi.fn(async () => { throw new Error('Active key needed') })
    const { user } = mount()
    await ready()
    await user.click(screen.getByRole('button', { name: 'Authorize' }))
    await waitFor(() => expect(toastMessages(toast.error)).toContain('Active key needed'))
    expect(screen.getByRole('button', { name: 'Authorize' })).toBeEnabled()
  })

  it('asks for the authorization when it cannot be checked (fails closed)', async () => {
    m.provider = 'keychain'
    m.hasAuth = vi.fn(async () => { throw new Error('rpc down') })
    mount()
    expect(await screen.findByRole('button', { name: 'Authorize' })).toBeInTheDocument()
  })

  it('a Butter Auth login needs no authorization', async () => {
    m.provider = null
    mount()
    await ready()
    expect(m.hasAuth).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Authorize' })).not.toBeInTheDocument()
  })

  it('ignores a drop while the authorization is missing', async () => {
    m.provider = 'keychain'
    m.hasAuth = vi.fn(async () => false)
    mount()
    await screen.findByRole('button', { name: 'Authorize' })
    fireEvent.drop(document.querySelector('.file-upload'), { dataTransfer: { files: [video()] } })
    await act(async () => {})
    expect(m.calls.setVideoFile).not.toHaveBeenCalled()
  })

  it('explains low Resource Credits, and re-checks on request', async () => {
    m.rc = vi.fn(async () => ({ ok: false, percentage: 12, secondsUntilEnough: 3600 }))
    const { user } = mount()
    const modal = await screen.findByRole('heading', { name: 'Not enough Resource Credits' })
    const box = modal.closest('.rc-modal-content')
    expect(within(box).getByText('12% RC available')).toBeInTheDocument()
    expect(input()).toBeDisabled()

    await user.click(within(box).getAllByRole('button', { name: 'Close' }).at(-1))
    expect(screen.queryByRole('heading', { name: 'Not enough Resource Credits' })).not.toBeInTheDocument()
    expect(screen.getByText(/doesn't have enough/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: "Why can't I upload?" }))
    m.rc = vi.fn(async () => ({ ok: true }))
    await user.click(screen.getByRole('button', { name: 'Re-check now' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Not enough Resource Credits' })).not.toBeInTheDocument())
    expect(screen.getByRole('heading', { name: 'Choose a video file' })).toBeInTheDocument()
  })

  it('lets the upload go ahead when the credit check itself fails', async () => {
    m.rc = vi.fn(async () => { throw new Error('rpc down') })
    mount()
    await ready()
    expect(screen.getByRole('heading', { name: 'Choose a video file' })).toBeInTheDocument()
  })

  // BUG: the RC explainer is a plain <div> overlay, without role="dialog" and
  // without an Escape key (RcInsufficientModal.jsx:44-45).
  it('BUG: the Resource Credits explainer is a dialog that Escape closes', async () => {
    m.rc = vi.fn(async () => ({ ok: false, percentage: 12, secondsUntilEnough: 3600 }))
    const { user } = mount()
    expect(await screen.findByRole('dialog', { name: 'Not enough Resource Credits' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('upload step 1: keyboard access', () => {
  // BUG: the file picker cannot be opened from the keyboard. The <input type=file>
  // is display:none (legacy-studio/VideoUploadStep1.scss:201-203), "Browse Files"
  // is a <label> (EmbedVideoUploadStep1.jsx:512) and the upload icon a
  // <div onClick> (:343-345): none of them takes focus, so there is no way to start
  // an upload without a mouse or touch.
  it('BUG: the file picker is a focusable button', async () => {
    const { user } = mount()
    await ready()
    const browse = screen.getByRole('button', { name: /Browse Files/ })
    await user.tab()
    expect(browse).toHaveFocus()
  })
})

describe('upload step 1: the free plan\'s daily limit', () => {
  const at = (h, min) => { const d = new Date(); d.setHours(h, min, 0, 0); return d.getTime() }
  const time = (ms) => new Date(ms).toLocaleString('en', { hour: '2-digit', minute: '2-digit' })

  it('no limit known (off, not deployed, Pro, warm-up): no note, picking as usual', async () => {
    mount()
    await ready()
    expect(document.querySelector('.upload-quota-note')).toBeNull()
    expect(input()).toBeEnabled()
  })

  it('room left: says what the free plan allows, with Go Pro, and lets a video be picked', async () => {
    m.quota.video = { limit: 1, used: 0, remaining: 1, nextAt: null }
    const { user } = mount()
    await ready()
    const note = document.querySelector('.upload-quota-note')
    expect(note).toHaveTextContent('Free plan: 1 video per day. 1 left today.')
    expect(within(note).getByRole('link', { name: 'Get 3Speak Pro' })).toHaveAttribute('href', '/wallet/uploader#pro')
    expect(input()).toBeEnabled()
    await user.upload(input(), video())
    expect(await screen.findByText('Video Selected. Proceed to upload thumbnail')).toBeInTheDocument()
  })

  it('used up: says when the next one frees up, and picking is off (button, input, drop)', async () => {
    const nextAt = at(23, 59)
    m.quota.video = { limit: 1, used: 1, remaining: 0, nextAt }
    mount()
    await ready()
    expect(document.querySelector('.upload-quota-note')).toHaveTextContent(`You have reached today's free video limit. Next upload at ${time(nextAt)}.`)
    expect(screen.getByRole('button', { name: 'Browse Files' })).toBeDisabled()
    expect(input()).toBeDisabled()
    const box = document.querySelector('.file-upload')
    fireEvent.drop(box, { dataTransfer: { files: [video()] } })
    await act(async () => { await Promise.resolve() })
    expect(m.calls.setVideoFile).not.toHaveBeenCalled()
  })

  it('a Short reads the Short counter, not the video one', async () => {
    m.fromStories = true
    m.meta = { duration: 20, width: 1080, height: 1920 }
    m.quota.video = { limit: 1, used: 1, remaining: 0, nextAt: null }
    m.quota.short = { limit: 3, used: 1, remaining: 2, nextAt: null }
    mount()
    await ready()
    expect(document.querySelector('.upload-quota-note')).toHaveTextContent('Free plan: 3 Shorts per day. 2 left today.')
    expect(input()).toBeEnabled()
  })

  it('a warm-up account: its own wording, no Go Pro link, and its used-up counter blocks picking', async () => {
    m.user = null
    useAppStore.setState({ user: null, incubationHandle: 'newbie' })
    m.quota.video = { limit: 3, used: 1, remaining: 2, nextAt: null, plan: 'warmup' }
    const { unmount } = mount()
    await ready()
    const note = document.querySelector('.upload-quota-note')
    expect(note).toHaveTextContent('During your warm-up: 3 videos per day. 2 left today.')
    expect(within(note).queryByRole('link')).toBeNull()
    expect(input()).toBeEnabled()
    unmount()

    const nextAt = at(23, 59)
    m.quota.video = { limit: 3, used: 3, remaining: 0, nextAt, plan: 'warmup' }
    mount()
    await ready()
    expect(document.querySelector('.upload-quota-note')).toHaveTextContent(`You have reached today's video limit for the warm-up. Next upload at ${time(nextAt)}.`)
    expect(input()).toBeDisabled()
  })

  it('a refusal the embed API already sent holds picking back, even with no counter known', async () => {
    m.uploadLimit = { code: 'daily_upload_limit', kind: 'video', limit: 1, used: 1, nextAt: null }
    mount()
    await ready()
    expect(document.querySelector('.upload-quota-note')).toHaveTextContent("You have reached today's free video limit. Try again later.")
    expect(input()).toBeDisabled()
  })
})

describe('upload step 1: the free plan\'s daily publish limit is a warning, never a block', () => {
  const fmt = (ms) => new Date(ms).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' })
  const DAY = 24 * 3600 * 1000
  const taken = (kind, limit, conflicts, nextFreeAt) => ({ exempt: false, kind, limit, allowed: false, conflicts, nextFreeAt })

  it('nothing known (route not deployed, Pro, warm-up): no warning', async () => {
    mount()
    await ready()
    expect(document.querySelector('.publish-limit-note')).toBeNull()
  })

  it('a video published in the last 24 hours: warns, says it can still be uploaded and scheduled, and lets a file be picked', async () => {
    const publishedAt = Date.now() - 3 * 3600 * 1000
    const nextFreeAt = publishedAt + DAY
    m.publish.video = taken('video', 1, [{ permlink: 'my-trip', title: 'My trip', at: publishedAt, scheduled: false }], nextFreeAt)
    const { user } = mount()
    await ready()
    const note = document.querySelector('.publish-limit-note')
    expect(note).toHaveTextContent(`On the free plan you can publish 1 video per 24 hours. "My trip" was published at ${fmt(publishedAt)}. You can still upload it and schedule it. Earliest free time: ${fmt(nextFreeAt)}.`)
    expect(within(note).getByRole('link', { name: 'Get 3Speak Pro' })).toHaveAttribute('href', '/wallet/uploader#pro')
    expect(m.publishAsked).toHaveBeenCalledWith(expect.objectContaining({ kind: 'video' }))
    // Not a block: picking and proceeding work as usual.
    expect(screen.getByRole('button', { name: 'Browse Files' })).toBeEnabled()
    expect(input()).toBeEnabled()
    await user.upload(input(), video())
    expect(await screen.findByText('Video Selected. Proceed to upload thumbnail')).toBeInTheDocument()
    expect(proceed()).toBeEnabled()
  })

  it('a video scheduled within a day of now names it too', async () => {
    const scheduledAt = Date.now() + 5 * 3600 * 1000
    m.publish.video = taken('video', 1, [{ permlink: 'soon', title: 'Soon', at: scheduledAt, scheduled: true }], scheduledAt + DAY)
    mount()
    await ready()
    expect(document.querySelector('.publish-limit-note')).toHaveTextContent(`"Soon" is scheduled for ${fmt(scheduledAt)}.`)
  })

  it('a Short reads the Short limit, and says when it can be posted (Shorts are not scheduled here)', async () => {
    m.fromStories = true
    m.meta = { duration: 20, width: 1080, height: 1920 }
    const at = Date.now() - 3600 * 1000
    m.publish.short = taken('short', 3, [1, 2, 3].map((i) => ({ permlink: `s${i}`, title: '', at: at - i * 60000, scheduled: false })), at - 3 * 60000 + DAY)
    mount()
    await ready()
    const note = document.querySelector('.publish-limit-note')
    expect(note).toHaveTextContent('On the free plan you can publish 3 Shorts per 24 hours.')
    expect(note).toHaveTextContent(`A post was published at ${fmt(at - 60000)}.`)
    expect(note).toHaveTextContent(`You can still upload it. It can be posted from ${fmt(at - 3 * 60000 + DAY)}.`)
    expect(m.publishAsked).toHaveBeenCalledWith(expect.objectContaining({ kind: 'short' }))
    expect(input()).toBeEnabled()
  })

  it('the warm-up upload cap still blocks, and then the publish warning stays out of the way', async () => {
    m.user = null
    useAppStore.setState({ user: null, incubationHandle: 'newbie' })
    m.quota.video = { limit: 3, used: 3, remaining: 0, nextAt: null, plan: 'warmup' }
    m.publish.video = taken('video', 1, [], Date.now() + DAY)
    mount()
    await ready()
    expect(document.querySelector('.upload-quota-note')).toHaveTextContent("You have reached today's video limit for the warm-up.")
    expect(document.querySelector('.publish-limit-note')).toBeNull()
    expect(input()).toBeDisabled()
  })
})

describe('upload step 1: Edit video opens the landscape editor, Pro only', () => {
  const editButton = () => screen.getByRole('button', { name: /Edit this video/ })
  it('a free account sees it with a Pro badge, and a tap asks the launcher (which shows the upsell)', async () => {
    const asked = vi.fn()
    window.addEventListener('open-video-editor', asked)
    const { user } = mount()
    await ready()
    await user.upload(input(), video())
    await screen.findByText('Video Selected. Proceed to upload thumbnail')
    expect(editButton().querySelector('.pro-lock-badge')).not.toBeNull()
    await user.click(editButton())
    expect(asked).toHaveBeenCalledTimes(1)
    window.removeEventListener('open-video-editor', asked)
  })

  it('Pro sees no badge; a Short\'s editor is free (no badge)', async () => {
    m.premium = { premium: true }
    const { user, unmount } = mount()
    await ready()
    await user.upload(input(), video())
    await screen.findByText('Video Selected. Proceed to upload thumbnail')
    expect(editButton().querySelector('.pro-lock-badge')).toBeNull()
    unmount()
    m.premium = { premium: false }
    m.fromStories = true
    m.meta = { duration: 20, width: 1080, height: 1920 }
    const second = mount()
    await ready()
    await second.user.upload(input(), video())
    await screen.findByText('Video Selected. Proceed to upload thumbnail')
    expect(editButton().querySelector('.pro-lock-badge')).toBeNull()
  })
})
