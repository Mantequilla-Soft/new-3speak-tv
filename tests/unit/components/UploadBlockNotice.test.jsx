// @vitest-environment jsdom
// What a creator blocked from uploading sees (components/UploadBlockNotice.jsx):
// the support popup once per block, quoting the admin's note, and a banner with
// the note and the Discord / Telegram links for as long as the block lasts.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, act, within } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

const get = vi.hoisted(() => vi.fn())
const post = vi.hoisted(() => vi.fn())
// Only GET /check and POST /translate are faked; the rest of axios
// (axios.create for the app's API clients) stays real.
vi.mock('axios', async (importOriginal) => {
  const real = (await importOriginal()).default
  return { default: Object.assign(Object.create(real), real, { get, post }) }
})
vi.mock('../../../src/hive-api/aioha', async () => (await import('./_render.jsx')).aiohaModule())

const { useAppStore } = await import('../../../src/lib/store')
const { useSupportBlock } = await import('../../../src/lib/supportBlockStore')
const { clearCreatorSettingsCache } = await import('../../../src/utils/creatorSettings')
const { default: UploadBlockNotice } = await import('../../../src/components/UploadBlockNotice/UploadBlockNotice.jsx')
const { default: SupportModal } = await import('../../../src/components/SupportModal/SupportModal.jsx')

// row the checker answers with, per /check/<key>
let rows
const asked = () => get.mock.calls.map(([url]) => decodeURIComponent(url.split('/check/')[1]))

// Any page but Home: there the banner moves between the Spotlight and the feed
// tabs (HomeGrouped's inline copy), see the Home test at the end.
const mount = (route = '/audio') => renderWithProviders(<><UploadBlockNotice /><SupportModal /></>, { route })
const banner = () => document.querySelector('.upload-block-notice')
const popup = () => document.querySelector('.support-modal')

beforeEach(() => {
  get.mockReset()
  post.mockReset()
  get.mockImplementation(async (url) => ({ data: rows[decodeURIComponent(url.split('/check/')[1])] ?? { canPost: false, reason: 'User not found' } }))
  rows = {}
  clearCreatorSettingsCache()
  localStorage.clear()
  useSupportBlock.setState({ block: null })
  useAppStore.setState({ authenticated: true, authChecked: true, user: null, incubationHandle: 'Newbie', appUpdatedFrom: null })
})

describe('a blocked warm-up user', () => {
  it('sees the note in a popup once and in a banner with the contact links', async () => {
    rows['~newbie'] = { canUpload: false, uploadBlockedReason: 'Only post your own videos.', uploadBlockedAt: '2026-11-10T09:00:00.000Z' }
    const { user, unmount } = mount()
    await waitFor(() => expect(banner()).not.toBeNull())
    expect(asked()).toEqual(['~newbie'])
    expect(banner()).toHaveTextContent('Uploading is disabled for your account')
    expect(banner()).toHaveTextContent('Only post your own videos.')
    expect(screen.getAllByRole('link', { name: 'Discord' })[0]).toHaveAttribute('href', 'https://discord.com/invite/NSFS2VGj83')
    expect(screen.getAllByRole('link', { name: 'Telegram' })[0]).toHaveAttribute('href', 'https://t.me/threespeak')

    expect(popup()).toHaveTextContent('Message from the 3Speak team')
    expect(popup()).toHaveTextContent('Only post your own videos.')
    await user.click(within(popup()).getByRole('button', { name: 'Close' }))
    expect(popup()).toBeNull()
    unmount()

    // next visit: banner again, popup not
    clearCreatorSettingsCache()
    mount()
    await waitFor(() => expect(banner()).not.toBeNull())
    expect(popup()).toBeNull()
  })

  it('can translate the note in the popup and switch back to the original', async () => {
    rows['~newbie'] = { canUpload: false, uploadBlockedReason: 'Only post your own videos.' }
    post.mockResolvedValue({ data: { translatedText: 'Lade nur eigene Videos hoch.' } })
    const { user } = mount()
    await waitFor(() => expect(popup()).not.toBeNull())
    await user.click(popup().querySelector('.comment-translate-btn'))
    const german = [...document.querySelectorAll('.translate-lang-item')].find((b) => b.textContent.includes('Deutsch'))
    await user.click(german)
    await waitFor(() => expect(popup()).toHaveTextContent('Lade nur eigene Videos hoch.'))
    expect(post).toHaveBeenCalledWith(expect.stringMatching(/\/translate$/), expect.objectContaining({ q: 'Only post your own videos.', target: 'de' }))
    expect(popup()).toHaveTextContent('Translated to Deutsch')
    // the banner keeps the original until translated on its own
    expect(banner()).toHaveTextContent('Only post your own videos.')
    await user.click(screen.getByRole('button', { name: 'Show original' }))
    expect(popup()).toHaveTextContent('Only post your own videos.')
  })

  it('says so when the translation fails, and keeps the original', async () => {
    rows['~newbie'] = { canUpload: false, uploadBlockedReason: 'Only post your own videos.' }
    post.mockRejectedValue(new Error('down'))
    const { user } = mount()
    await waitFor(() => expect(popup()).not.toBeNull())
    await user.click(popup().querySelector('.comment-translate-btn'))
    await user.click([...document.querySelectorAll('.translate-lang-item')].find((b) => b.textContent.includes('Deutsch')))
    await waitFor(() => expect(popup()).toHaveTextContent('This message could not be translated. Please try again.'))
    expect(popup()).toHaveTextContent('Only post your own videos.')
  })

  it('a new block (new date) shows the popup again', async () => {
    rows['~newbie'] = { canUpload: false, uploadBlockedAt: '2026-11-10T09:00:00.000Z' }
    const { user, unmount } = mount()
    await waitFor(() => expect(popup()).not.toBeNull())
    await user.click(popup().querySelector('.app-modal-header button'))
    unmount()
    rows['~newbie'] = { canUpload: false, uploadBlockedAt: '2026-11-12T09:00:00.000Z' }
    clearCreatorSettingsCache()
    mount()
    await waitFor(() => expect(popup()).not.toBeNull())
  })

  it('gets the banner without a note too, with no quote box', async () => {
    rows['~newbie'] = { canUpload: false }
    mount()
    await waitFor(() => expect(banner()).not.toBeNull())
    expect(banner().querySelector('.ubn-note')).toBeNull()
    expect(popup().querySelector('.support-modal-note')).toBeNull()
  })

  it('waits for the "what\'s new" popup before showing its own', async () => {
    rows['~newbie'] = { canUpload: false }
    useAppStore.setState({ appUpdatedFrom: '1.0.0' })
    mount()
    await waitFor(() => expect(banner()).not.toBeNull())
    expect(popup()).toBeNull()
    act(() => useAppStore.setState({ appUpdatedFrom: null }))
    await waitFor(() => expect(popup()).not.toBeNull())
  })

  it('shows nothing on /advertise', async () => {
    rows['~newbie'] = { canUpload: false, uploadBlockedReason: 'x' }
    mount('/advertise')
    await waitFor(() => expect(get).toHaveBeenCalled())
    await act(async () => {})
    expect(banner()).toBeNull()
    expect(popup()).toBeNull()
  })
})

describe('everyone else', () => {
  it('a Hive account blocked WITH a note gets the banner and popup', async () => {
    useAppStore.setState({ user: 'alice', incubationHandle: null })
    rows.alice = { canUpload: false, uploadBlockedReason: 'Spam uploads.' }
    mount()
    await waitFor(() => expect(banner()).toHaveTextContent('Spam uploads.'))
    expect(asked()).toEqual(['alice'])
  })

  it('a Hive account blocked without a note (older blocks) sees nothing new', async () => {
    useAppStore.setState({ user: 'alice', incubationHandle: null })
    rows.alice = { canUpload: false }
    mount()
    await waitFor(() => expect(get).toHaveBeenCalled())
    await act(async () => {})
    expect(banner()).toBeNull()
    expect(popup()).toBeNull()
  })

  it('a creator who may upload, or a failed check, sees nothing', async () => {
    rows['~newbie'] = { canUpload: true, uploadBlockedReason: 'old note' }
    mount()
    await waitFor(() => expect(get).toHaveBeenCalled())
    await act(async () => {})
    expect(banner()).toBeNull()
  })

  it('signed out: no lookup at all', async () => {
    useAppStore.setState({ authenticated: false, user: null, incubationHandle: null })
    mount()
    await act(async () => {})
    expect(get).not.toHaveBeenCalled()
    expect(banner()).toBeNull()
  })
})

describe('on Home', () => {
  it('the app-level copy keeps the popup but leaves the banner to the inline copy under the Spotlight', async () => {
    rows['~newbie'] = { canUpload: false, uploadBlockedReason: 'Only post your own videos.', uploadBlockedAt: '2026-11-10T09:00:00.000Z' }
    renderWithProviders(<><UploadBlockNotice /><div className="home-slot"><UploadBlockNotice inline /></div><SupportModal /></>, { route: '/' })
    await waitFor(() => expect(popup()).not.toBeNull())
    const banners = document.querySelectorAll('.upload-block-notice')
    expect(banners).toHaveLength(1)
    expect(banners[0].closest('.home-slot')).not.toBeNull()
    expect(document.querySelectorAll('.support-modal')).toHaveLength(1)
  })
})
