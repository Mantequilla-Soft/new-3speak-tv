// The player's keyboard on the watch page: the scrubber is a real slider, the
// loop and theater toggles, and the "?" sheet that lists every key.
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

vi.mock('../../../src/hooks/useSeekPreview', () => ({
  default: () => ({ videoRef: { current: null }, preview: { visible: false, leftPx: 0, time: 0 }, previewWidth: 160, frameless: false, showAt: () => {}, hide: () => {}, fmtTime: () => '' }),
}))

const { default: VideoControls } = await import('../../../src/components/VideoControls/VideoControls.jsx')
const { default: KeyboardShortcuts } = await import('../../../src/components/playVideo/KeyboardShortcuts.jsx')

const controls = (props = {}) => renderWithProviders(
  <VideoControls currentTime={65} duration={240} buffered={0.5} isPlaying volume={1} isVisible onSeek={vi.fn()} {...props} />,
)

describe('the scrubber is a slider', () => {
  it('is focusable and says where the video is', () => {
    controls()
    const s = screen.getByRole('slider', { name: 'Seek' })
    expect(s).toHaveAttribute('tabindex', '0')
    expect(s).toHaveAttribute('aria-valuemin', '0')
    expect(s).toHaveAttribute('aria-valuemax', '240')
    expect(s).toHaveAttribute('aria-valuenow', '65')
    expect(s).toHaveAttribute('aria-valuetext', '1:05 of 4:00')
  })

  it('arrows seek 5 s, Page keys 10 %, Home and End, and the page does not see them again', () => {
    const onSeek = vi.fn()
    controls({ onSeek })
    const s = screen.getByRole('slider', { name: 'Seek' })
    const press = (key) => fireEvent.keyDown(s, { key })
    expect(press('ArrowRight')).toBe(false) // default prevented
    expect(onSeek).toHaveBeenLastCalledWith(70)
    press('ArrowLeft'); expect(onSeek).toHaveBeenLastCalledWith(60)
    press('PageUp'); expect(onSeek).toHaveBeenLastCalledWith(89)
    press('PageDown'); expect(onSeek).toHaveBeenLastCalledWith(41)
    press('Home'); expect(onSeek).toHaveBeenLastCalledWith(0)
    press('End'); expect(onSeek).toHaveBeenLastCalledWith(240)
    onSeek.mockClear()
    expect(press('k')).toBe(true)
    fireEvent.keyDown(s, { key: 'ArrowRight', ctrlKey: true })
    expect(onSeek).not.toHaveBeenCalled()
  })

  it('cannot be focused while an ad plays', () => {
    controls({ adPlaying: true })
    expect(screen.getByRole('slider', { hidden: true })).toHaveAttribute('tabindex', '-1')
  })
})

describe('loop and theater toggles', () => {
  it('show only when handed a handler, and say whether they are on', () => {
    const onToggleLoop = vi.fn()
    const onToggleTheater = vi.fn()
    controls({ loop: true, onToggleLoop, isTheater: false, onToggleTheater })
    const loop = screen.getAllByRole('button', { name: 'Loop' })[0]
    expect(loop).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(loop)
    expect(onToggleLoop).toHaveBeenCalled()
    const theater = screen.getByRole('button', { name: 'Theater mode' })
    expect(theater).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(theater)
    expect(onToggleTheater).toHaveBeenCalled()
  })

  it('no theater button without room for it, nor in fullscreen', () => {
    controls({ onToggleTheater: null })
    expect(screen.queryByRole('button', { name: 'Theater mode' })).toBeNull()
  })

  it('theater on offers the default view back', () => {
    controls({ isTheater: true, onToggleTheater: vi.fn() })
    expect(screen.getByRole('button', { name: 'Default view' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('player size and quality', () => {
  it('has no player size button any more: theater mode covers it', () => {
    controls({ onToggleTheater: vi.fn(), onCycleReactionSize: vi.fn() })
    expect(screen.queryByRole('button', { name: /Player size/ })).toBeNull()
    expect(document.querySelector('.vc-btn--resize')).toBeNull()
  })

  it('the quality choices wrap at their own width, so a long Auto label fits', () => {
    const onQualityChange = vi.fn()
    controls({ qualityLevels: [{ index: 0, height: 480 }, { index: 1, height: 1080 }], currentQuality: -1, onQualityChange })
    fireEvent.click(screen.getAllByRole('button', { name: 'Quality' })[0])
    const auto = screen.getByRole('button', { name: 'Auto' })
    expect(auto.parentElement).toHaveClass('vc-quality-grid')
    expect(auto).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: '1080p' }))
    expect(onQualityChange).toHaveBeenCalledWith(1)
  })
})

describe('the ? sheet', () => {
  it('lists the keys in a dialog with a header, theater only where there is room', () => {
    const onClose = vi.fn()
    const { unmount } = renderWithProviders(<KeyboardShortcuts open onClose={onClose} wide />)
    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' })
    expect(dialog).toHaveTextContent('Play or pause')
    expect(dialog).toHaveTextContent('Jump to 0% to 90% of the video')
    expect(dialog).toHaveTextContent('Theater mode on or off')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
    unmount()
    renderWithProviders(<KeyboardShortcuts open onClose={onClose} wide={false} />)
    expect(screen.getByRole('dialog')).not.toHaveTextContent('Theater mode on or off')
  })

  it('renders nothing while closed', () => {
    renderWithProviders(<KeyboardShortcuts open={false} onClose={() => {}} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('the audio waveform is a slider', () => {
  it('says where the track is and seeks by keys, as a fraction of the length', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    const ctx = new Proxy({}, { get: () => () => {} })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx)
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0)
    const { default: Waveform } = await import('../../../src/components/GlobalAudioPlayer/Waveform.jsx')
    const onSeek = vi.fn()
    renderWithProviders(
      <Waveform samples={[0.1, 0.5, 0.3]} audioRef={{ current: null }} duration={200} currentTime={50} onSeek={onSeek} />,
    )
    const s = screen.getByRole('slider', { name: 'Seek' })
    expect(s).toHaveAttribute('aria-valuenow', '50')
    expect(s).toHaveAttribute('aria-valuetext', '0:50 of 3:20')
    fireEvent.keyDown(s, { key: 'ArrowRight' })
    expect(onSeek).toHaveBeenLastCalledWith(55 / 200)
    fireEvent.keyDown(s, { key: 'End' })
    expect(onSeek).toHaveBeenLastCalledWith(1)
    vi.unstubAllGlobals()
  })
})
