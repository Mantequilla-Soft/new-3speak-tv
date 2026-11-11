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
  await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
}

beforeEach(() => {
  stubMatchMedia(false)
  Object.assign(m, {
    user: 'uploader', provider: null, fromStories: false, isStory: false,
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
  useAppStore.setState({ user: 'uploader' })
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
    expect(screen.getByText(/can't preview this video/)).toBeInTheDocument()
  })
})

describe('upload step 1: shorts and stories', () => {
  beforeEach(() => { m.fromStories = true })

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
    await waitFor(() => expect(toastMessages(toast.error)).toEqual([expect.stringMatching(/vertical \(portrait\) format/)]))
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

    await user.click(screen.getByRole('button', { name: 'Authorize @threespeak' }))
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
    await user.click(screen.getByRole('button', { name: 'Authorize @threespeak' }))
    await waitFor(() => expect(toastMessages(toast.error)).toContain('Active key needed'))
    expect(screen.getByRole('button', { name: 'Authorize @threespeak' })).toBeEnabled()
  })

  it('asks for the authorization when it cannot be checked (fails closed)', async () => {
    m.provider = 'keychain'
    m.hasAuth = vi.fn(async () => { throw new Error('rpc down') })
    mount()
    expect(await screen.findByRole('button', { name: 'Authorize @threespeak' })).toBeInTheDocument()
  })

  it('a Butter Auth login needs no authorization', async () => {
    m.provider = null
    mount()
    await ready()
    expect(m.hasAuth).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Authorize @threespeak' })).not.toBeInTheDocument()
  })

  it('ignores a drop while the authorization is missing', async () => {
    m.provider = 'keychain'
    m.hasAuth = vi.fn(async () => false)
    mount()
    await screen.findByRole('button', { name: 'Authorize @threespeak' })
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
