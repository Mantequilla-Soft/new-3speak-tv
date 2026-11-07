// @vitest-environment jsdom
// The share menu's entries (components/UploadLinks.jsx), here the Audio editor:
// it sits right after "Music / Audio" in their own "Audio" category, only
// exists with the editor feature on,
// goes through the same upload gate as every upload entry and then asks App.jsx
// to open the editor in audio mode (open-audio-editor, no file).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders, stubMatchMedia } from './_render.jsx'

const m = vi.hoisted(() => ({ editor: true, settings: {} }))
vi.mock('../../../src/hive-api/aioha', async () => (await import('./_render.jsx')).aiohaModule())
vi.mock('../../../src/utils/config', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    get FEATURE_EDITOR() { return m.editor },
    openpodsEnabledFor: () => false,
    storiesEnabledFor: (u) => !!u,
  }
})
vi.mock('../../../src/utils/creatorSettings', () => ({
  getCreatorSettings: vi.fn(async () => m.settings),
  isUploadBlocked: (s) => s?.canUpload === false,
}))

const { useSupportBlock } = await import('../../../src/lib/supportBlockStore')
const { default: UploadLinks } = await import('../../../src/components/UploadLinks.jsx')

let events
const onOpen = (e) => events.push(e)

beforeEach(() => {
  stubMatchMedia(false)
  m.editor = true
  m.settings = {}
  events = []
  useSupportBlock.setState({ block: null })
  window.addEventListener('open-audio-editor', onOpen)
})
afterEach(() => {
  window.removeEventListener('open-audio-editor', onOpen)
  vi.unstubAllGlobals()
})

const entry = () => screen.queryByTitle('Audio Editor')

describe('UploadLinks: Audio editor entry', () => {
  it('sits right after Music / Audio, with what it does under it', () => {
    renderWithProviders(<UploadLinks linkClass="share-link" />)
    const links = [...document.querySelectorAll('.share-link')].map((a) => a.getAttribute('title'))
    const at = links.indexOf('Music / Audio')
    expect(at).toBeGreaterThanOrEqual(0)
    expect(links[at + 1]).toBe('Audio Editor')
    expect(entry()).toHaveTextContent('Cut, clean up and level podcasts and music')
  })

  it('the video entries sit under Video, audio upload and the audio editor under their own Audio category', () => {
    renderWithProviders(<UploadLinks linkClass="share-link" />)
    // headings and entries in menu order
    const order = [...document.querySelectorAll('.share-menu-heading, .share-link')]
      .map((el) => (el.classList.contains('share-menu-heading') ? `# ${el.textContent}` : el.getAttribute('title')))
    const audio = order.indexOf('# Audio')
    expect(order[0]).toBe('# Video')
    expect(order).not.toContain('# Upload')
    expect(audio).toBeGreaterThan(order.indexOf('# Video'))
    expect(order.slice(audio + 1, audio + 3)).toEqual(['Music / Audio', 'Audio Editor'])
    // the video entries stay under Video, before the Audio heading
    expect(order.indexOf('Shorts Editor')).toBeLessThan(audio)
  })

  it('wraps each category in its own group (the desktop flyout lays them out as columns)', () => {
    renderWithProviders(<UploadLinks linkClass="share-link" />)
    const groups = [...document.querySelectorAll('.share-menu-group')]
    expect(groups.map((g) => g.querySelector('.share-menu-heading')?.textContent)).toEqual(['Video', 'Audio']) // signed out: no Others
    // every entry sits inside a group, under its heading
    for (const link of document.querySelectorAll('.share-link')) expect(link.closest('.share-menu-group')).not.toBeNull()
    expect([...groups[1].querySelectorAll('.share-link')].map((a) => a.getAttribute('title'))).toEqual(['Music / Audio', 'Audio Editor'])
  })

  it('keeps the Audio category for the audio upload without the editor feature', () => {
    m.editor = false
    renderWithProviders(<UploadLinks linkClass="share-link" />)
    const order = [...document.querySelectorAll('.share-menu-heading, .share-link')]
      .map((el) => (el.classList.contains('share-menu-heading') ? `# ${el.textContent}` : el.getAttribute('title')))
    const audio = order.indexOf('# Audio')
    expect(audio).toBeGreaterThan(0)
    expect(order[audio + 1]).toBe('Music / Audio')
  })

  it('is not there without the editor feature', () => {
    m.editor = false
    renderWithProviders(<UploadLinks linkClass="share-link" />)
    expect(entry()).toBeNull()
    expect(screen.queryByTitle('Shorts Editor')).toBeNull()
  })

  it('opens the editor in audio mode without a file, and closes the menu', async () => {
    const onClick = vi.fn()
    const { user } = renderWithProviders(<UploadLinks linkClass="share-link" onClick={onClick} />)
    await user.click(entry())
    await waitFor(() => expect(events).toHaveLength(1))
    expect(events[0].detail).toBeNull()
    expect(onClick).toHaveBeenCalled()
  })

  it('shows the support notice instead for a creator who may not upload', async () => {
    m.settings = { canUpload: false }
    const { user } = renderWithProviders(<UploadLinks linkClass="share-link" />)
    await user.click(entry())
    await waitFor(() => expect(useSupportBlock.getState().block).toEqual({ reason: 'upload' }))
    expect(events).toHaveLength(0)
  })

  it('pauses whatever is playing on the page first', async () => {
    const audio = document.createElement('audio')
    Object.defineProperty(audio, 'paused', { configurable: true, get: () => false })
    audio.pause = vi.fn()
    document.body.appendChild(audio)
    const { user } = renderWithProviders(<UploadLinks linkClass="share-link" />)
    await user.click(entry())
    expect(audio.pause).toHaveBeenCalled()
    audio.remove()
  })
})
