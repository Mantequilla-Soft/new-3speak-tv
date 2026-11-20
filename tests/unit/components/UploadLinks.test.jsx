// @vitest-environment jsdom
// The Create menu (components/UploadLinks.jsx): category tiles first, a
// category's entries as tiles behind them. Then the Audio editor: it sits
// right after "Music / Audio" in the Audio category, only exists with the
// editor feature on,
// goes through the same upload gate as every upload entry and then asks App.jsx
// to open the editor in audio mode (open-audio-editor, no file).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders, stubMatchMedia } from './_render.jsx'

const m = vi.hoisted(() => ({ editor: true, settings: {}, premium: { premium: false } }))
// 🔒 The viewer's Pro status (the landscape video editor is Pro only)
vi.mock('../../../src/hooks/usePremiumStatus', () => ({ usePremiumStatus: () => m.premium }))
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
vi.mock('../../../src/utils/creatorSettings', async (importOriginal) => ({
  creatorKey: (await importOriginal()).creatorKey,
  getCreatorSettings: vi.fn(async () => m.settings),
  isUploadBlocked: (s) => s?.canUpload === false,
}))

const { useSupportBlock } = await import('../../../src/lib/supportBlockStore')
const { useAppStore } = await import('../../../src/lib/store')
const { default: UploadLinks } = await import('../../../src/components/UploadLinks.jsx')

let events
const onOpen = (e) => events.push(e)

beforeEach(() => {
  stubMatchMedia(false)
  m.editor = true
  m.settings = {}
  m.premium = { premium: false }
  events = []
  useSupportBlock.setState({ block: null })
  useAppStore.setState({ user: null, incubationHandle: null })
  window.addEventListener('open-audio-editor', onOpen)
})
afterEach(() => {
  window.removeEventListener('open-audio-editor', onOpen)
  vi.unstubAllGlobals()
})

const entry = () => screen.queryByTitle('Audio Editor')
const titles = () => [...document.querySelectorAll('.share-link')].map((a) => a.getAttribute('title'))
const cats = () => [...document.querySelectorAll('.share-menu-cat .share-menu-label')].map((el) => el.textContent)
// Opens a category tile: its entries replace the categories.
async function openCat(user, name) {
  await user.click(screen.getByRole('button', { name: new RegExp(`^${name}`) }))
}
// Renders the menu and opens the Audio category, where the editor lives.
async function renderAudio(props = {}) {
  const r = renderWithProviders(<UploadLinks linkClass="share-link" {...props} />)
  await openCat(r.user, 'Audio')
  return r
}

describe('UploadLinks: category tiles', () => {
  it('starts with the categories as tiles, no entries yet', () => {
    useAppStore.setState({ user: 'badadib' })
    renderWithProviders(<UploadLinks linkClass="share-link" />)
    expect(cats()).toEqual(['Video', 'Audio', 'Others']) // no streams: openpods off in this test
    expect(titles()).toEqual([])
    expect(screen.getByRole('button', { name: /^Video/ })).toHaveTextContent('Upload, record or edit a video')
  })

  it('leaves out a category with nothing in it (signed out: no Others)', () => {
    renderWithProviders(<UploadLinks linkClass="share-link" />)
    expect(cats()).toEqual(['Video', 'Audio'])
  })

  it('shows a category\'s entries as tiles with a Back button to the categories', async () => {
    const onStep = vi.fn()
    const { user } = renderWithProviders(<UploadLinks linkClass="share-link" onStep={onStep} />)
    await openCat(user, 'Video')
    expect(titles()).toEqual(['Regular Video', 'Vertical Short', 'Shorts Editor', 'Video Editor'])
    expect(cats()).toEqual([])
    const back = screen.getByRole('button', { name: 'Back' })
    expect(back).toHaveFocus()
    await user.click(back)
    expect(cats()).toEqual(['Video', 'Audio'])
    expect(screen.getByRole('button', { name: /^Video/ })).toHaveFocus()
    expect(onStep).toHaveBeenCalledTimes(2)
  })

  it('keeps a click on a tile or Back from reaching the menu around it (the flyout closes on clicks)', async () => {
    const outer = vi.fn()
    const { user } = renderWithProviders(<div onClick={outer}><UploadLinks linkClass="share-link" /></div>)
    await openCat(user, 'Audio')
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(outer).not.toHaveBeenCalled()
  })

  it('puts the 24h story under Video for a Hive account, Snap and Playlist under Others', async () => {
    useAppStore.setState({ user: 'badadib' })
    const { user } = renderWithProviders(<UploadLinks linkClass="share-link" />)
    await openCat(user, 'Video')
    // the story gets its own row, the editors below under an "Edit" heading
    expect(titles()).toEqual(['Regular Video', 'Vertical Short', 'Story (24h)', 'Shorts Editor', 'Video Editor'])
    const cells = [...document.querySelector('.share-menu-grid').children]
    expect(cells[3]).toHaveClass('share-menu-subheading')
    expect(cells[3]).toHaveTextContent('Edit')
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await openCat(user, 'Others')
    expect(titles()).toEqual(['Community Snap', 'Playlist'])
  })
})

describe('UploadLinks: Audio editor entry', () => {
  it('sits right after Music / Audio in the Audio category, with what it does under it', async () => {
    await renderAudio()
    expect(titles()).toEqual(['Music / Audio', 'Audio Editor'])
    expect(entry()).toHaveTextContent('Cut, clean up and level')
  })

  it('keeps the Audio category for the audio upload without the editor feature', async () => {
    m.editor = false
    await renderAudio()
    expect(titles()).toEqual(['Music / Audio'])
  })

  it('is not there without the editor feature', async () => {
    m.editor = false
    const { user } = await renderAudio()
    expect(entry()).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await openCat(user, 'Video')
    expect(screen.queryByTitle('Shorts Editor')).toBeNull()
    expect(document.querySelector('.share-menu-subheading')).toBeNull()
  })

  it('opens the editor in audio mode without a file, and closes the menu', async () => {
    const onClick = vi.fn()
    const { user } = await renderAudio({ onClick })
    await user.click(entry())
    await waitFor(() => expect(events).toHaveLength(1))
    expect(events[0].detail).toBeNull()
    expect(onClick).toHaveBeenCalled()
  })

  it('shows the support notice instead for a creator who may not upload', async () => {
    m.settings = { canUpload: false }
    const { user } = await renderAudio()
    await user.click(entry())
    await waitFor(() => expect(useSupportBlock.getState().block).toEqual({ reason: 'upload' }))
    expect(events).toHaveLength(0)
  })

  it('quotes the admin\'s block note in that notice', async () => {
    m.settings = { canUpload: false, uploadBlockedReason: 'Only your own videos.' }
    const { user } = await renderAudio()
    await user.click(entry())
    await waitFor(() => expect(useSupportBlock.getState().block).toEqual({ reason: 'upload', note: 'Only your own videos.' }))
  })

  it('looks a warm-up user up as ~<handle>, a Hive account by its name', async () => {
    const { getCreatorSettings } = await import('../../../src/utils/creatorSettings')
    getCreatorSettings.mockClear()
    useAppStore.setState({ user: null, incubationHandle: 'Newbie' })
    const { user, unmount } = await renderAudio()
    await user.click(entry())
    await waitFor(() => expect(getCreatorSettings).toHaveBeenCalledWith('~newbie'))
    unmount()
    useAppStore.setState({ user: 'badadib', incubationHandle: null })
    const again = await renderAudio()
    await again.user.click(entry())
    await waitFor(() => expect(getCreatorSettings).toHaveBeenLastCalledWith('badadib'))
  })

  it('pauses whatever is playing on the page first', async () => {
    const audio = document.createElement('audio')
    Object.defineProperty(audio, 'paused', { configurable: true, get: () => false })
    audio.pause = vi.fn()
    document.body.appendChild(audio)
    const { user } = await renderAudio()
    await user.click(entry())
    expect(audio.pause).toHaveBeenCalled()
    audio.remove()
  })

  it('offers the video editor for a landscape video under Video, after the Shorts Editor', async () => {
    const opened = []
    const onVideo = (e) => opened.push(e)
    window.addEventListener('open-video-editor', onVideo)
    try {
      const { user } = renderWithProviders(<UploadLinks linkClass="share-link" />)
      await openCat(user, 'Video')
      const order = titles()
      expect(order.indexOf('Video Editor')).toBe(order.indexOf('Shorts Editor') + 1)
      expect(screen.getByTitle('Video Editor')).toHaveTextContent('Edit a landscape video up to 10 minutes')
      await user.click(screen.getByTitle('Video Editor'))
      await waitFor(() => expect(opened).toHaveLength(1))
    } finally {
      window.removeEventListener('open-video-editor', onVideo)
    }
  })
})

describe('UploadLinks: the landscape Video Editor is Pro only', () => {
  const tile = (title) => screen.getByTitle(title)
  async function renderVideo() {
    const r = renderWithProviders(<UploadLinks linkClass="share-link" />)
    await openCat(r.user, 'Video')
    return r
  }

  it('a free account sees it with a Pro badge; the Shorts Editor has none', async () => {
    useAppStore.setState({ user: 'badadib' })
    await renderVideo()
    expect(tile('Video Editor').querySelector('.pro-lock-badge')).toHaveTextContent('Pro')
    expect(tile('Shorts Editor').querySelector('.pro-lock-badge')).toBeNull()
  })

  it('a tap still asks for it (open-video-editor): the launcher answers a free account with the upsell', async () => {
    useAppStore.setState({ user: 'badadib' })
    const asked = vi.fn()
    window.addEventListener('open-video-editor', asked)
    const { user } = await renderVideo()
    await user.click(tile('Video Editor'))
    await waitFor(() => expect(asked).toHaveBeenCalledTimes(1))
    window.removeEventListener('open-video-editor', asked)
  })

  it('Pro sees no badge, and nor does anyone while the Pro status loads', async () => {
    useAppStore.setState({ user: 'badadib' })
    m.premium = { premium: true }
    const { unmount } = await renderVideo()
    expect(tile('Video Editor').querySelector('.pro-lock-badge')).toBeNull()
    unmount()
    m.premium = null
    await renderVideo()
    expect(tile('Video Editor').querySelector('.pro-lock-badge')).toBeNull()
  })

  it('a warm-up account (no Hive account) is not Pro: badge', async () => {
    useAppStore.setState({ user: null, incubationHandle: 'newbie' })
    await renderVideo()
    expect(tile('Video Editor').querySelector('.pro-lock-badge')).not.toBeNull()
  })

  it('the Audio Editor stays free', async () => {
    useAppStore.setState({ user: 'badadib' })
    await renderAudio()
    expect(entry().querySelector('.pro-lock-badge')).toBeNull()
  })
})
