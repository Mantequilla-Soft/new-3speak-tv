// Card hover previews (src/hooks/useHoverPreview.jsx): when the mouse leaves, the
// preview fades out (`.leaving`, still playing) instead of vanishing, then pauses.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createElement, act, useState } from 'react'
import { createRoot } from 'react-dom/client'

const player = vi.hoisted(() => ({
  load: vi.fn(async () => {}), play: vi.fn(async () => {}), pause: vi.fn(), destroy: vi.fn(), destroyed: false,
}))
vi.mock('@mantequilla-soft/3speak-player', () => ({ ThreeSpeakApi: class { async fetchSource() { return null } } }))
vi.mock('../../../src/utils/playerUrl', () => ({ getPlayerUrl: () => 'https://play.test' }))
vi.mock('../../../src/lib/lowResPreviewPlayer', () => ({ createLowResPreviewPlayer: () => player }))
vi.mock('../../../src/lib/reportUnavailable', () => ({ reportVideoUnavailable: () => {} }))
vi.mock('../../../src/lib/store', () => ({ useAppStore: (sel) => sel({ previewEnabled: true }) }))
vi.mock('../../../src/hooks/useCardSize', () => ({ default: () => 'medium' }))
vi.mock('../../../src/hooks/useSubtitles', () => ({ default: () => ({ cues: [] }), prefetchSubtitles: () => {} }))
vi.mock('../../../src/components/SubtitleOverlay/SubtitleOverlay', () => ({ default: () => null }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
window.matchMedia = (q) => ({ matches: q.includes('hover: hover'), addEventListener() {}, removeEventListener() {} })
const { default: useHoverPreview } = await import('../../../src/hooks/useHoverPreview.jsx')

let root
let container
let removeCard

function Grid() {
  const [showCard, setShowCard] = useState(true)
  removeCard = () => setShowCard(false)
  const { containerProps, getCardProps, overlay } = useHoverPreview()
  return createElement('div', containerProps,
    showCard && createElement('div', { className: 'card', ...getCardProps('badadib/abc', 'badadib', 'abc', 'thumb.jpg', 'published', 'A video') },
      createElement('div', { className: 'img-wrap' })),
    overlay)
}

const overlay = () => container.querySelector('.card-hover-overlay')
const card = () => container.querySelector('.card')
const advance = async (ms) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
function mouse(type, el) {
  act(() => { el.dispatchEvent(new MouseEvent(type, { bubbles: true, relatedTarget: document.body })) })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(createElement(Grid)))
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers() })

async function startPreview() {
  mouse('mouseover', card())
  await advance(500)
  expect(overlay().classList.contains('active')).toBe(true)
}

describe('hover preview fade-out', () => {
  it('fades out still playing when the mouse leaves, then hides and pauses', async () => {
    await startPreview()
    mouse('mouseout', container.firstChild)
    expect(overlay().className).toContain('active')
    expect(overlay().className).toContain('leaving')
    expect(overlay().querySelector('.card-hover-poster')).not.toBeNull()
    await advance(200)
    expect(player.pause).not.toHaveBeenCalled()
    await advance(150)
    expect(overlay().className).not.toContain('active')
    expect(overlay().className).not.toContain('leaving')
    expect(player.pause).toHaveBeenCalled()
  })

  it('a new preview is not "leaving"', async () => {
    await startPreview()
    expect(overlay().className).not.toContain('leaving')
  })

  it('ends at once when its card left the grid', async () => {
    await startPreview()
    act(() => removeCard())
    expect(overlay().className).not.toContain('active')
    expect(overlay().className).not.toContain('leaving')
  })
})
