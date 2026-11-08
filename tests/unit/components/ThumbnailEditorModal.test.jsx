// @vitest-environment jsdom
// The thumbnail editor popup (embed-studio/thumbnail-editor/ThumbnailEditorModal.jsx)
// as the video upload uses it (Done just closes: the step page holds the design)
// and as the audio upload's cover designer uses it (square, its own title, a
// Done that saves while X still only closes).
import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'
import { emptyEdit } from '../../../src/components/embed-studio/thumbnail-editor/editState'

const { default: ThumbnailEditorModal } = await import('../../../src/components/embed-studio/thumbnail-editor/ThumbnailEditorModal.jsx')

function open(props = {}) {
  const onClose = vi.fn()
  const utils = renderWithProviders(
    <ThumbnailEditorModal
      onClose={onClose}
      image={null}
      edit={emptyEdit()}
      onEditChange={vi.fn()}
      width={1280}
      height={720}
      assetsVersion={0}
      selectedLayerId={null}
      onSelectLayer={vi.fn()}
      activeTool="frame"
      onToolChange={vi.fn()}
      sources={[]}
      selectedSrc={null}
      onSelectSource={vi.fn()}
      videoFile={null}
      onPickFrame={vi.fn()}
      onReset={vi.fn()}
      canReset={false}
      onDownload={vi.fn()}
      {...props}
    />,
  )
  return { ...utils, onClose }
}

describe('ThumbnailEditorModal', () => {
  it('is the video thumbnail editor by default: Done closes', async () => {
    const { user, onClose } = open()
    const dialog = screen.getByRole('dialog')
    expect(dialog.className).not.toMatch(/thumb-modal--square/)
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('takes a square shape, a title and a Done of its own for a cover', async () => {
    const onDone = vi.fn()
    const { user, onClose } = open({ square: true, title: 'Cover editor', onDone })
    const dialog = screen.getByRole('dialog', { name: 'Cover editor' })
    expect(dialog.className).toMatch(/thumb-modal--square/)
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows the upload running on Done and blocks a second one', () => {
    open({ onDone: vi.fn(), doneBusy: true })
    const done = screen.getByRole('button', { name: 'Uploading…' })
    expect(done).toBeDisabled()
  })

  it('has Pick frame only with a video', () => {
    const { unmount } = open({ videoFile: new File(['v'], 'v.mp4', { type: 'video/mp4' }) })
    expect(screen.getByRole('tab', { name: 'Pick frame' })).toBeInTheDocument()
    unmount()
    open()
    expect(screen.queryByRole('tab', { name: 'Pick frame' })).toBeNull()
  })
})
