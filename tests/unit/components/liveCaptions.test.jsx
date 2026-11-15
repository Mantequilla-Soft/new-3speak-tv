// @vitest-environment jsdom
// Live captions (H11) on the watch surfaces and in the studio: the CC switch
// shows only while the host captions, remembers the viewer's choice, and the
// overlay and the studio setting get the site's text; the replay subtitles
// are saved through the captions editor's signed save.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n, { setLanguage } from '../../../src/i18n'

const m = vi.hoisted(() => ({ available: true, overlayProps: null, toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@snapie/hangouts-react', () => ({
  useLiveCaptions: () => ({ available: m.available, lang: 'en-us', lines: [] }),
  StreamCaptions: (props) => { m.overlayProps = props; return props.show ? <div data-testid="captions" /> : null },
}))
vi.mock('../../../src/utils/toast', () => ({ toastIn: () => m.toast }))

const { LiveCaptionsOverlay, LiveCaptionsToggle, useCaptionsPref } = await import('../../../src/components/openpods/LiveCaptions.jsx')
const { saveStreamCaptions, studioCaptionLabels } = await import('../../../src/components/openpods/studioCaptions.js')

function Harness({ variant }) {
  const [on, toggle] = useCaptionsPref()
  return (
    <>
      <LiveCaptionsOverlay show={on} />
      <LiveCaptionsToggle variant={variant} on={on} onToggle={toggle} />
    </>
  )
}

describe('viewer captions', () => {
  beforeEach(async () => {
    m.available = true
    m.overlayProps = null
    localStorage.clear()
    await i18n.changeLanguage('en')
  })

  it('shows nothing to switch while the host has no captions', () => {
    m.available = false
    render(<Harness variant="dock" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('is on by default, and the dock tile switches it off and remembers', async () => {
    render(<Harness variant="dock" />)
    expect(screen.getByTestId('captions')).toBeInTheDocument()
    const tile = screen.getByRole('button', { name: /captions/i })
    expect(tile).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(tile)
    expect(screen.queryByTestId('captions')).not.toBeInTheDocument()
    expect(localStorage.getItem('live-captions-on')).toBe('0')
  })

  it('a viewer who switched them off finds them off next time', () => {
    localStorage.setItem('live-captions-on', '0')
    render(<Harness variant="overlay" />)
    expect(screen.queryByTestId('captions')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show live captions' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('the rail variant works on the phone view', async () => {
    render(<Harness variant="rail" />)
    await userEvent.click(screen.getByRole('button', { name: /captions/i }))
    expect(screen.queryByTestId('captions')).not.toBeInTheDocument()
  })

  it('hands the overlay the site language and translated labels', async () => {
    await setLanguage('de', { remember: false })
    render(<Harness variant="dock" />)
    expect(m.overlayProps.targetLang).toBe('de')
    expect(m.overlayProps.labels.translatedFrom).toBe('Auf deinem Gerät übersetzt (Original: {lang})')
    expect(m.overlayProps.labels.noTranslator).toContain('{lang}')
  })
})

describe('studio captions', () => {
  it('every studio label has its text', async () => {
    await i18n.changeLanguage('en')
    const labels = studioCaptionLabels(i18n.t.bind(i18n))
    expect(Object.keys(labels)).toHaveLength(13)
    for (const v of Object.values(labels)) expect(v).not.toMatch(/^liveCaptions\./)
    expect(labels.title).toBe('Live captions')
  })

  it('saves the live captions as the replay subtitles on the host\'s post', async () => {
    const save = vi.fn().mockResolvedValue({ cid: 'Qm' })
    const cues = [{ start: 1, end: 2, text: 'Hello' }]
    expect(await saveStreamCaptions({ author: 'badadib', permlink: 'badadib-live1', captions: { lang: 'en', cues }, save })).toBe(true)
    expect(save).toHaveBeenCalledWith({ author: 'badadib', permlink: 'badadib-live1', lang: 'en', cues })
    expect(m.toast.success).toHaveBeenCalled()
  })

  it('does nothing without captions, and says so when saving fails', async () => {
    const save = vi.fn().mockRejectedValue(new Error('Invalid signature'))
    expect(await saveStreamCaptions({ author: 'badadib', permlink: 'p', captions: undefined, save })).toBe(false)
    expect(save).not.toHaveBeenCalled()
    expect(await saveStreamCaptions({ author: 'badadib', permlink: 'p', captions: { lang: 'en', cues: [{ start: 0, end: 1, text: 'x' }] }, save })).toBe(false)
    expect(m.toast.error).toHaveBeenCalled()
  })
})
