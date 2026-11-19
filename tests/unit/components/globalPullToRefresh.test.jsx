// @vitest-environment jsdom
// Pull to refresh on every page (components/PullToRefresh/GlobalPullToRefresh.jsx):
// drag down at the top reloads, except where a reload would lose work or the
// drag means something else, and never on top of a feed's own pull.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const upload = vi.hoisted(() => ({ uploading: false, videoUploadStatus: 'idle' }))
vi.mock('../../../src/context/EmbedUploadContext', () => ({ useEmbedUpload: () => upload }))
await import('../../../src/i18n')
const { default: GlobalPullToRefresh } = await import('../../../src/components/PullToRefresh/GlobalPullToRefresh.jsx')
const { default: PullToRefresh } = await import('../../../src/components/PullToRefresh/PullToRefresh.jsx')

const reload = vi.fn()
const realLocation = window.location

beforeEach(() => {
  reload.mockClear()
  Object.assign(upload, { uploading: false, videoUploadStatus: 'idle' })
  Object.defineProperty(window, 'location', { configurable: true, value: { ...realLocation, reload } })
  window.matchMedia = vi.fn((q) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }))
  window.scrollY = 0
})
afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
  document.body.innerHTML = ''
})

function page(path, extra = null) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <GlobalPullToRefresh />
      <main data-testid="page">content</main>
      {extra}
    </MemoryRouter>,
  )
}

function drag(target, dy) {
  const at = (y) => ({ touches: [{ clientX: 100, clientY: y }] })
  act(() => {
    fireEvent.touchStart(target, at(100))
    fireEvent.touchMove(target, at(110))
    fireEvent.touchMove(target, at(100 + dy))
    fireEvent.touchEnd(target, { touches: [] })
  })
}

describe('pull to refresh on any page', () => {
  it('reloads after a long enough pull at the top of a page', () => {
    const { getByTestId } = page('/notifications')
    drag(getByTestId('page'), 200)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('a short pull, a scrolled page or a sideways drag does nothing', () => {
    const { getByTestId } = page('/notifications')
    drag(getByTestId('page'), 60)
    window.scrollY = 300
    drag(getByTestId('page'), 200)
    expect(reload).not.toHaveBeenCalled()
  })

  it('stays away from uploads, editors, Shorts and live streams', () => {
    for (const path of ['/upload', '/embed-studio/details', '/shorts', '/watch/badadib-live', '/openpods/badadib-x', '/automations/abc']) {
      const { getByTestId, unmount } = page(path)
      drag(getByTestId('page'), 200)
      unmount()
    }
    expect(reload).not.toHaveBeenCalled()
  })

  it('never while a video uploads in the background, or under an open dialog', () => {
    upload.videoUploadStatus = 'uploading'
    const a = page('/notifications')
    drag(a.getByTestId('page'), 200)
    a.unmount()
    upload.videoUploadStatus = 'idle'
    const b = page('/notifications', <div role="dialog">dialog</div>)
    drag(b.getByTestId('page'), 200)
    expect(reload).not.toHaveBeenCalled()
  })

  it('not from a text field, and not over a feed with its own pull', () => {
    const a = page('/notifications', <textarea data-testid="box" />)
    drag(a.getByTestId('box'), 200)
    a.unmount()
    const b = page('/notifications', <PullToRefresh onRefresh={async () => {}}><div>feed</div></PullToRefresh>)
    drag(b.getByTestId('page'), 200)
    expect(reload).not.toHaveBeenCalled()
  })
})
