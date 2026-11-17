// @vitest-environment jsdom
// "Do you have YouTube or other channels?" (components/SocialLinksPrompt): asks
// a Hive account with no linked social profiles, once, to link them; "Link
// profiles" opens Settings on Connections. Warm-up accounts are never asked.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, screen, fireEvent } from '@testing-library/react'
import { renderWithProviders, useFakeClock } from './_render.jsx'
import { useAppStore } from '../../../src/lib/store'
import { setPromptActive } from '../../../src/utils/welcomeGate'

const getLinks = vi.fn()
vi.mock('../../../src/utils/socialVerifier', () => ({ getLinks: (...a) => getLinks(...a) }))
vi.mock('../../../src/components/SettingsModal/SettingsModal', () => ({
  default: ({ isOpen, initialTab, onClose }) => (isOpen ? (
    <div data-testid="settings" data-tab={initialTab}><button type="button" onClick={onClose}>shut</button></div>
  ) : null),
}))

const { default: SocialLinksPrompt } = await import('../../../src/components/SocialLinksPrompt/SocialLinksPrompt.jsx')

const PROMPTED_KEY = '3speak_social_links_prompted'
const dialog = () => screen.queryByRole('dialog', { name: 'Do you have YouTube or other channels?' })

async function mountAndWait() {
  const view = renderWithProviders(<SocialLinksPrompt />)
  await act(async () => { vi.advanceTimersByTime(1600) })
  await act(async () => {})
  return view
}

beforeEach(() => {
  localStorage.clear()
  getLinks.mockReset().mockResolvedValue([])
  useAppStore.setState({ authenticated: true, user: 'badadib', incubationHandle: null })
  useFakeClock()
})
afterEach(() => {
  vi.useRealTimers()
  setPromptActive('other', false)
})

describe('who is asked', () => {
  it('a Hive account without linked profiles, pending links counted', async () => {
    await mountAndWait()
    expect(getLinks).toHaveBeenCalledWith('badadib', { includePending: true })
    expect(dialog()).toBeInTheDocument()
  })

  it('not someone with a linked profile, and not again later', async () => {
    getLinks.mockResolvedValue([{ platform: 'youtube', platform_username: 'badadib' }])
    await mountAndWait()
    expect(dialog()).toBeNull()
    expect(JSON.parse(localStorage.getItem(PROMPTED_KEY))).toEqual(['badadib'])
  })

  it('not a warm-up account', async () => {
    useAppStore.setState({ authenticated: true, user: null, incubationHandle: 'badadib' })
    await mountAndWait()
    expect(getLinks).not.toHaveBeenCalled()
    expect(dialog()).toBeNull()
  })

  it('asks again next session when the links cannot be read', async () => {
    getLinks.mockRejectedValue(new Error('down'))
    await mountAndWait()
    expect(dialog()).toBeNull()
    expect(localStorage.getItem(PROMPTED_KEY)).toBeNull()
  })

  it('waits while another prompt is up', async () => {
    setPromptActive('other', true)
    await mountAndWait()
    expect(dialog()).toBeNull()
    act(() => setPromptActive('other', false))
    await act(async () => { vi.advanceTimersByTime(1600) })
    await act(async () => {})
    expect(dialog()).toBeInTheDocument()
  })
})

describe('the popup', () => {
  it('Close closes it for good', async () => {
    const { unmount } = await mountAndWait()
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' }).at(-1))
    expect(dialog()).toBeNull()
    unmount()
    await mountAndWait()
    expect(dialog()).toBeNull()
  })

  it('Link profiles opens Settings on Connections and does not ask again', async () => {
    await mountAndWait()
    fireEvent.click(screen.getByRole('button', { name: 'Link profiles' }))
    expect(dialog()).toBeNull()
    const settings = await screen.findByTestId('settings')
    expect(settings).toHaveAttribute('data-tab', 'connections')
    expect(JSON.parse(localStorage.getItem(PROMPTED_KEY))).toEqual(['badadib'])
    fireEvent.click(screen.getByRole('button', { name: 'shut' }))
    expect(screen.queryByTestId('settings')).toBeNull()
  })
})
