// @vitest-environment jsdom
// "Get paid for watching and listening" (components/AdsPrompt/ViewerRewardsPrompt.jsx),
// issue #578: No thanks signs nothing and is remembered on this device; the X and
// Escape close it for this visit; a yes that fails half way only asks the rest
// again; it never opens over another prompt.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

const m = vi.hoisted(() => ({}))
vi.mock('../../../src/utils/config', async (importOriginal) => ({
  ...(await importOriginal()),
  adsEnabledFor: () => true,
  adsBetaUserFor: () => true,
}))
vi.mock('../../../src/lib/advertiseData', () => ({
  fetchAdAccess: async () => ({ allowed: true }),
  fetchViewerAdPrefs: (...a) => m.fetchPrefs(...a),
  setViewerAdPrefs: (...a) => m.setViewer(...a),
  setListenerAdPrefs: (...a) => m.setListener(...a),
}))
vi.mock('../../../src/utils/advertiserAccount', () => ({ isAdvertiserAccount: async () => false }))
vi.mock('../../../src/utils/viewerRewards', () => ({ resetViewerRewards: () => {} }))

const { useAppStore } = await import('../../../src/lib/store')
const { setPromptActive } = await import('../../../src/utils/welcomeGate')
const { default: ViewerRewardsPrompt } = await import('../../../src/components/AdsPrompt/ViewerRewardsPrompt.jsx')

// Each test signs in as its own account: "closed for this visit" lives in the module.
let n = 0
function signIn() {
  const user = `badadib${++n}`
  useAppStore.setState({ user, authenticated: true })
  return user
}
const dialog = () => screen.findByRole('dialog', { name: 'Get paid for watching and listening' })

beforeEach(() => {
  localStorage.clear()
  setPromptActive('viewer-rewards', false)
  // Like the server: what was signed is what the next read says.
  const prefs = { decided: false }
  Object.assign(m, {
    prefs,
    fetchPrefs: vi.fn(async () => ({ ...prefs })),
    setViewer: vi.fn(async (_, { rewardsEnabled }) => { Object.assign(prefs, { decided: true, rewardsEnabled, listenDecided: false }); return { ok: true } }),
    setListener: vi.fn(async (_, { listenEnabled }) => { Object.assign(prefs, { listenDecided: true, listenEnabled }); return { ok: true } }),
  })
})

describe('the rewards question', () => {
  it('No thanks closes it without asking the wallet, and this device does not ask again', async () => {
    signIn()
    const { user, unmount } = renderWithProviders(<ViewerRewardsPrompt />)
    await user.click(await screen.findByRole('button', { name: 'No thanks' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(m.setViewer).not.toHaveBeenCalled()
    expect(m.setListener).not.toHaveBeenCalled()
    unmount()
    renderWithProviders(<ViewerRewardsPrompt />)
    await waitFor(() => expect(m.fetchPrefs).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('has a close button that puts it away for this visit, with no signature', async () => {
    signIn()
    const { user, unmount } = renderWithProviders(<ViewerRewardsPrompt />)
    await dialog()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(m.setViewer).not.toHaveBeenCalled()
    unmount()
    renderWithProviders(<ViewerRewardsPrompt />)
    await act(async () => {})
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('can be closed while the wallet never answers (a cancelled unlock)', async () => {
    signIn()
    m.setViewer = vi.fn(() => new Promise(() => {}))
    const { user } = renderWithProviders(<ViewerRewardsPrompt />)
    await user.click(await screen.findByRole('button', { name: 'Yes, pay me' }))
    expect(screen.getByRole('button', { name: 'No thanks' })).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('a yes signs watching, then listening', async () => {
    signIn()
    const { user } = renderWithProviders(<ViewerRewardsPrompt />)
    await user.click(await screen.findByRole('button', { name: 'Yes, pay me' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(m.setViewer).toHaveBeenCalledWith(expect.any(String), { rewardsEnabled: true })
    expect(m.setListener).toHaveBeenCalledWith(expect.any(String), { listenEnabled: true })
  })

  it('when listening fails after watching was signed, only listening is asked again', async () => {
    signIn()
    const listen = m.setListener
    m.setListener = vi.fn().mockRejectedValueOnce(new Error('user_cancel')).mockImplementation(listen)
    const { user } = renderWithProviders(<ViewerRewardsPrompt />)
    await user.click(await screen.findByRole('button', { name: 'Yes, pay me' }))
    const yesListen = await screen.findByRole('button', { name: /yes/i })
    await waitFor(() => expect(yesListen).not.toBeDisabled())
    await user.click(yesListen)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(m.setViewer).toHaveBeenCalledTimes(1)
    expect(m.setListener).toHaveBeenCalledTimes(2)
  })

  it('waits while another prompt (the changelog) is on screen', async () => {
    signIn()
    setPromptActive('changelog', true)
    renderWithProviders(<ViewerRewardsPrompt />)
    await act(async () => {})
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    act(() => setPromptActive('changelog', false))
    expect(await dialog()).toBeInTheDocument()
  })
})
