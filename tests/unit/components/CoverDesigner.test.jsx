// @vitest-environment jsdom
// The audio upload's cover designer (components/AudioUploadModal/CoverDesigner.jsx):
// the video upload's thumbnail editor, square, on the current cover or a blank
// one. Done renders the design and uploads it; an untouched cover is left alone;
// X / Esc / backdrop change nothing. The editor popup itself is stubbed here
// (it has its own coverage through the video thumbnail step); this checks what
// the designer hands it and does with its callbacks.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import { renderWithProviders, toastMessages } from './_render.jsx'

const m = vi.hoisted(() => ({ modalProps: null }))
vi.mock('sonner', async () => (await import('./_render.jsx')).sonnerModule())
vi.mock('../../../src/utils/uploadThumbnail', () => ({ uploadThumbnail: vi.fn() }))
vi.mock('../../../src/components/AudioUploadModal/coverImage', () => ({
  toEditableImage: vi.fn(),
  blankCover: vi.fn(() => 'data:image/png;base64,BLANK'),
}))
vi.mock('../../../src/components/embed-studio/thumbnail-editor/renderThumbnail', () => ({
  exportThumbnail: vi.fn(async () => ({ blob: new Blob(['jpeg'], { type: 'image/jpeg' }), dataUrl: 'data:image/jpeg;base64,X' })),
  loadLayerAssets: vi.fn(async () => {}),
  loadImage: vi.fn(async (src) => ({ src, naturalWidth: 1080, naturalHeight: 1080 })),
}))
vi.mock('../../../src/components/embed-studio/thumbnail-editor/ThumbnailEditorModal', () => ({
  default: (props) => {
    m.modalProps = props
    return (
      <div role="dialog" aria-label={props.title} data-square={String(!!props.square)}>
        <span data-testid="tools">{props.videoFile ? 'with video' : 'no video'}</span>
        <button type="button" onClick={() => props.onEditChange({ ...props.edit, layers: [{ id: 'l1', type: 'text', text: 'EP 12' }] })}>Add text</button>
        <button type="button" onClick={props.onDone} disabled={props.doneBusy}>{props.doneBusy ? 'Uploading' : 'Done'}</button>
        <button type="button" onClick={props.onClose}>Close</button>
      </div>
    )
  },
}))

const { toast } = await import('sonner')
const { uploadThumbnail } = await import('../../../src/utils/uploadThumbnail')
const { toEditableImage, blankCover } = await import('../../../src/components/AudioUploadModal/coverImage')
const { exportThumbnail } = await import('../../../src/components/embed-studio/thumbnail-editor/renderThumbnail')
const { default: CoverDesigner } = await import('../../../src/components/AudioUploadModal/CoverDesigner.jsx')

beforeEach(() => {
  vi.clearAllMocks()
  m.modalProps = null
  toEditableImage.mockResolvedValue('data:image/jpeg;base64,COVER')
  uploadThumbnail.mockResolvedValue('https://images.hive.blog/DQmNew/cover.jpg')
})

function open(props = {}) {
  const onDone = vi.fn()
  const onClose = vi.fn()
  const utils = renderWithProviders(<CoverDesigner src="https://images.hive.blog/DQmOld/c.jpg" onDone={onDone} onClose={onClose} {...props} />)
  return { ...utils, onDone, onClose }
}

describe('CoverDesigner', () => {
  it('opens the thumbnail editor square, titled as a cover editor, on the current cover', async () => {
    open()
    const dialog = await screen.findByRole('dialog', { name: 'Cover editor' })
    expect(dialog).toHaveAttribute('data-square', 'true')
    expect(toEditableImage).toHaveBeenCalledWith('https://images.hive.blog/DQmOld/c.jpg')
    expect(m.modalProps).toMatchObject({ width: 1080, height: 1080, selectedSrc: 'data:image/jpeg;base64,COVER', activeTool: 'frame' })
    // No video, so no "Pick frame"
    expect(screen.getByTestId('tools')).toHaveTextContent('no video')
  })

  it('starts from a blank square, on the text tool, without a cover', async () => {
    open({ src: null })
    await screen.findByRole('dialog')
    expect(blankCover).toHaveBeenCalledWith(1080)
    expect(toEditableImage).not.toHaveBeenCalled()
    expect(m.modalProps.activeTool).toBe('text')
  })

  it('leaves an untouched cover as it is on Done', async () => {
    const { user, onDone, onClose } = open()
    await user.click(await screen.findByRole('button', { name: 'Done' }))
    expect(onClose).toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
    expect(uploadThumbnail).not.toHaveBeenCalled()
  })

  it('renders, uploads and hands over the designed cover', async () => {
    const { user, onDone } = open()
    await user.click(await screen.findByRole('button', { name: 'Add text' }))
    await user.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('https://images.hive.blog/DQmNew/cover.jpg'))
    expect(exportThumbnail).toHaveBeenCalledWith(expect.objectContaining({ width: 1080, height: 1080, edit: expect.objectContaining({ layers: [expect.objectContaining({ text: 'EP 12' })] }) }))
    const [file] = uploadThumbnail.mock.calls[0]
    expect(file).toBeInstanceOf(File)
    expect(file.type).toBe('image/jpeg')
  })

  it('uploads a blank design even without edits (there was no cover before)', async () => {
    const { user, onDone } = open({ src: '' })
    await user.click(await screen.findByRole('button', { name: 'Done' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
  })

  it('stays open and says why when the upload fails', async () => {
    uploadThumbnail.mockRejectedValueOnce(new Error('image host down'))
    const { user, onDone, onClose } = open()
    await user.click(await screen.findByRole('button', { name: 'Add text' }))
    await user.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(toastMessages(toast.error)[0]).toMatch(/image host down/)
    expect(onDone).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Done' })).toBeEnabled()
  })

  it('closes without a change on X', async () => {
    const { user, onDone, onClose } = open()
    await user.click(await screen.findByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('tells the creator to upload instead when the cover cannot be read', async () => {
    toEditableImage.mockRejectedValueOnce(new Error('cors'))
    const { onClose } = open()
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(toastMessages(toast.error)).toContain("This picture can't be opened in the cover editor. Upload it from your device instead.")
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('does not close while its upload is running', async () => {
    let finish
    uploadThumbnail.mockImplementationOnce(() => new Promise((r) => { finish = r }))
    const { user, onClose } = open()
    await user.click(await screen.findByRole('button', { name: 'Add text' }))
    await user.click(screen.getByRole('button', { name: 'Done' }))
    await screen.findByRole('button', { name: 'Uploading' })
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => finish('https://images.hive.blog/x.jpg'))
  })
})
