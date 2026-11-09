// @vitest-environment jsdom
// The thumbnail editor for a Short made from an audiogram
// (components/AudioUploadModal/ShortThumbDesigner.jsx): the video upload's
// thumbnail editor, portrait (9:16), on a frame of the audiogram, with Pick
// frame on the audiogram itself. Done renders, uploads and hands the URL over.
// The editor popup itself is stubbed (it has its own coverage).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders, toastMessages } from './_render.jsx'

const m = vi.hoisted(() => ({ modalProps: null }))
vi.mock('sonner', async () => (await import('./_render.jsx')).sonnerModule())
vi.mock('../../../src/utils/uploadThumbnail', () => ({ uploadThumbnail: vi.fn() }))
vi.mock('../../../src/utils/audiogramShorts', () => ({ fetchAudiogramFile: vi.fn() }))
vi.mock('../../../src/utils/videoThumbnails', () => ({ captureFrameAt: vi.fn() }))
vi.mock('../../../src/components/embed-studio/thumbnail-editor/renderThumbnail', () => ({
  exportThumbnail: vi.fn(async () => ({ blob: new Blob(['jpeg'], { type: 'image/jpeg' }), dataUrl: 'data:image/jpeg;base64,X' })),
  loadLayerAssets: vi.fn(async () => {}),
  loadImage: vi.fn(async (src) => ({ src, naturalWidth: 720, naturalHeight: 1280 })),
}))
vi.mock('../../../src/components/embed-studio/thumbnail-editor/ThumbnailEditorModal', () => ({
  default: (props) => {
    m.modalProps = props
    return (
      <div role="dialog" aria-label={props.title} data-portrait={String(!!props.portrait)}>
        <span data-testid="tools">{props.videoFile ? 'with video' : 'no video'}</span>
        <button type="button" onClick={() => props.onPickFrame('data:image/jpeg;base64,PICKED')}>Pick</button>
        <button type="button" onClick={props.onDone} disabled={props.doneBusy}>Done</button>
        <button type="button" onClick={props.onClose}>Close</button>
      </div>
    )
  },
}))

const { toast } = await import('sonner')
const { uploadThumbnail } = await import('../../../src/utils/uploadThumbnail')
const { fetchAudiogramFile } = await import('../../../src/utils/audiogramShorts')
const { captureFrameAt } = await import('../../../src/utils/videoThumbnails')
const { exportThumbnail } = await import('../../../src/components/embed-studio/thumbnail-editor/renderThumbnail')
const { default: ShortThumbDesigner } = await import('../../../src/components/AudioUploadModal/ShortThumbDesigner.jsx')

const URL_ = 'https://3speak-editor-api.okinoko.io/rendered/audiogram-1.mp4'
const FILE = new File(['mp4'], 'audiogram.mp4', { type: 'video/mp4' })

beforeEach(() => {
  vi.clearAllMocks()
  m.modalProps = null
  fetchAudiogramFile.mockResolvedValue(FILE)
  captureFrameAt.mockResolvedValue('data:image/jpeg;base64,FRAME')
  uploadThumbnail.mockResolvedValue('https://images.hive.blog/DQmNew/short.jpg')
})

function open() {
  const onDone = vi.fn()
  const onClose = vi.fn()
  const utils = renderWithProviders(<ShortThumbDesigner videoUrl={URL_} owner="alice" onDone={onDone} onClose={onClose} />)
  return { ...utils, onDone, onClose }
}

describe('ShortThumbDesigner', () => {
  it('opens portrait (720 x 1280) on the frame 1.5 s in, with Pick frame on the audiogram', async () => {
    open()
    const dialog = await screen.findByRole('dialog', { name: 'Thumbnail of the Short' })
    expect(dialog).toHaveAttribute('data-portrait', 'true')
    expect(fetchAudiogramFile).toHaveBeenCalledWith(URL_)
    await waitFor(() => expect(m.modalProps.selectedSrc).toBe('data:image/jpeg;base64,FRAME'))
    expect(captureFrameAt).toHaveBeenCalledWith(FILE, 1.5)
    expect(m.modalProps).toMatchObject({ width: 720, height: 1280, videoFile: FILE })
    expect(screen.getByTestId('tools')).toHaveTextContent('with video')
  })

  it('a picked frame is added to the pictures and chosen', async () => {
    const { user } = open()
    await waitFor(() => expect(m.modalProps.selectedSrc).toBe('data:image/jpeg;base64,FRAME'))
    await user.click(screen.getByRole('button', { name: 'Pick' }))
    expect(m.modalProps.selectedSrc).toBe('data:image/jpeg;base64,PICKED')
    expect(m.modalProps.sources.map(s => s.src)).toEqual(['data:image/jpeg;base64,FRAME', 'data:image/jpeg;base64,PICKED'])
  })

  it('renders, uploads (as the creator) and hands over the thumbnail', async () => {
    const { user, onDone } = open()
    await waitFor(() => expect(m.modalProps.image).toBeTruthy())
    await user.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('https://images.hive.blog/DQmNew/short.jpg'))
    expect(exportThumbnail).toHaveBeenCalledWith(expect.objectContaining({ width: 720, height: 1280 }))
    expect(uploadThumbnail).toHaveBeenCalledWith(expect.any(File), 'alice', { preferStatic: true })
  })

  it('no frame by itself: starts on Pick frame', async () => {
    captureFrameAt.mockRejectedValueOnce(new Error('no decode'))
    open()
    await waitFor(() => expect(m.modalProps.activeTool).toBe('pickFrame'))
    expect(m.modalProps.selectedSrc).toBe(null)
  })

  it('says why and closes when the audiogram can not be loaded', async () => {
    fetchAudiogramFile.mockRejectedValueOnce(new Error('gone (404)'))
    const { onClose } = open()
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(toastMessages(toast.error)[0]).toMatch(/gone \(404\)/)
  })
})
