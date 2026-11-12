// @vitest-environment jsdom
// The settings window (components/SettingsModal/SettingsModal.jsx): its tabs and
// what each one changes. Switches write straight to the app store; the account
// settings (posting authority, Lightning address, support links, push
// notifications, ad and reward preferences, interests) go through their own
// modules, mocked here so each answer and failure can be chosen. The Referrals
// panel shows the member's own link with a copy button.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, screen, within, waitFor } from '@testing-library/react'
import { renderWithProviders, stubClipboard, stubMatchMedia, toastMessages } from './_render.jsx'

const m = vi.hoisted(() => ({ adsFor: () => false, betaFor: () => false }))
vi.mock('sonner', async () => (await import('./_render.jsx')).sonnerModule())
vi.mock('../../../src/hive-api/aioha', async () => (await import('./_render.jsx')).aiohaModule())
vi.mock('../../../src/utils/config', async (importOriginal) => ({
  ...(await importOriginal()),
  adsEnabledFor: (u) => m.adsFor(u),
  adsBetaUserFor: (u) => m.betaFor(u),
}))
vi.mock('../../../src/utils/interests', () => ({
  fetchUserInterests: (...a) => m.fetchUserInterests(...a),
  saveInterestsToHive: (...a) => m.saveInterestsToHive(...a),
}))
vi.mock('../../../src/lib/advertiseData', () => ({
  fetchAdAccess: (...a) => m.fetchAdAccess(...a),
  fetchCreatorAdPrefs: (...a) => m.fetchCreatorAdPrefs(...a),
  fetchViewerAdPrefs: (...a) => m.fetchViewerAdPrefs(...a),
  setViewerAdPrefs: (...a) => m.setViewerAdPrefs(...a),
  setListenerAdPrefs: (...a) => m.setListenerAdPrefs(...a),
}))
vi.mock('../../../src/utils/viewerRewards', () => ({ resetViewerRewards: () => m.resetViewerRewards() }))
vi.mock('../../../src/utils/adSettings', () => ({ saveCreatorAdSettings: (...a) => m.saveCreatorAdSettings(...a) }))
vi.mock('../../../src/utils/webPush', () => ({
  pushSupported: () => m.pushSupported(),
  getPushState: (...a) => m.getPushState(...a),
  enablePush: (...a) => m.enablePush(...a),
  disablePush: (...a) => m.disablePush(...a),
  getPushPrefs: (...a) => m.getPushPrefs(...a),
  setPushPrefs: (...a) => m.setPushPrefs(...a),
}))
vi.mock('../../../src/utils/postingAuthority', () => ({
  hasThreespeakPostingAuth: (...a) => m.hasAuth(...a),
  addThreespeakToPostingAuth: (...a) => m.addAuth(...a),
  removeThreespeakFromPostingAuth: (...a) => m.removeAuth(...a),
  waitForThreespeakPostingAuth: (...a) => m.waitAuth(...a),
}))
vi.mock('../../../src/lib/lightningTip', async (importOriginal) => ({
  ...(await importOriginal()),
  checkLightningAddress: (...a) => m.checkLn(...a),
  readOwnLightningAddress: (...a) => m.readLn(...a),
  saveOwnLightningAddress: (...a) => m.saveLn(...a),
}))
vi.mock('../../../src/lib/supportLinks', async (importOriginal) => ({
  ...(await importOriginal()),
  readSupportLinks: (...a) => m.readLinks(...a),
  saveSupportLinks: (...a) => m.saveLinks(...a),
}))
vi.mock('../../../src/hooks/useCardSize', () => ({ default: () => 'small', useIsCardSizeMobile: () => m.cardMobile }))
vi.mock('../../../src/utils/hiveNode', () => ({ getHiveUrl: () => 'https://api.hive.example' }))
vi.mock('../../../src/hooks/getUserDetails', () => ({ useGetMyQuery: () => undefined }))
vi.mock('../../../src/version', () => ({ APP_VERSION: '9.8.7' }))
vi.mock('../../../src/components/tip-reward/OtherWays', () => ({ SUPPORT_SITE_ICONS: {} }))
vi.mock('../../../src/components/LanguagePicker/LanguagePicker', () => ({ default: () => <p>Language picker</p> }))
vi.mock('../../../src/components/SettingsModal/DataRequestForm', () => ({ default: () => <p>Data request form</p> }))
vi.mock('../../../src/components/modal/AddSocialLink_modal', () => ({ default: ({ hiveUsername }) => <p>Linked profiles of {hiveUsername}</p> }))

const { toast } = await import('sonner')
const { useAppStore } = await import('../../../src/lib/store')
const { default: SettingsModal } = await import('../../../src/components/SettingsModal/SettingsModal.jsx')

function mount(props = {}) {
  const onClose = vi.fn()
  const r = renderWithProviders(<SettingsModal isOpen onClose={onClose} {...props} />)
  return { ...r, onClose }
}
const tabs = () => within(screen.getAllByRole('tablist')[0]).getAllByRole('tab').map((t) => t.textContent)
const sw = (name) => screen.getByRole('switch', { name })
const signIn = (user = 'listener') => act(() => useAppStore.setState({ user, authenticated: true }))

beforeEach(() => {
  stubMatchMedia((q) => q === '(hover: hover)')
  Object.assign(m, {
    adsFor: () => false,
    betaFor: () => false,
    cardMobile: false,
    fetchUserInterests: vi.fn(async () => null),
    saveInterestsToHive: vi.fn(async (_u, list) => list),
    fetchAdAccess: vi.fn(async () => ({ allowed: true })),
    fetchCreatorAdPrefs: vi.fn(async () => ({ adsEnabled: true, rollsEnabled: true, audioEnabled: true })),
    fetchViewerAdPrefs: vi.fn(async () => ({ rewardsEnabled: false, listenEnabled: false })),
    setViewerAdPrefs: vi.fn(async () => ({})),
    setListenerAdPrefs: vi.fn(async () => ({})),
    resetViewerRewards: vi.fn(),
    saveCreatorAdSettings: vi.fn(async () => ({ chainSaved: true })),
    pushSupported: () => false,
    getPushState: vi.fn(async () => ({ supported: true, worker: true, permission: 'default', subscribed: false })),
    enablePush: vi.fn(async () => {}),
    disablePush: vi.fn(async () => {}),
    getPushPrefs: vi.fn(async () => ({ kinds: [], prefs: {} })),
    setPushPrefs: vi.fn(async (_u, p) => p),
    hasAuth: vi.fn(async () => true),
    addAuth: vi.fn(async () => {}),
    removeAuth: vi.fn(async () => {}),
    waitAuth: vi.fn(async (_u, expected) => expected),
    checkLn: vi.fn(async () => ({})),
    readLn: vi.fn(async () => ''),
    saveLn: vi.fn(async () => {}),
    readLinks: vi.fn(async () => []),
    saveLinks: vi.fn(async () => {}),
  })
  useAppStore.setState({
    user: null, authenticated: false, theme: 'light', showNsfw: false, hideWatched: true, hideAi: true,
    privateMode: false, previewEnabled: true, openShortsOnStart: false, inlineShorts: true,
    shortsCommentBar: false, interests: [], homeCardSize: 'small',
  })
})
afterEach(() => {
  document.body.style.overflow = ''
  localStorage.clear()
})

describe('the settings window', () => {
  it('renders nothing while closed', () => {
    renderWithProviders(<SettingsModal isOpen={false} onClose={() => {}} />)
    expect(screen.queryByRole('heading', { name: 'Settings' })).not.toBeInTheDocument()
  })

  it('opens on General, with the tabs a signed-out visitor can use', () => {
    mount()
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(tabs()).toEqual(['General', 'Content', 'About'])
    expect(screen.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Language picker')).toBeInTheDocument()
  })

  it('adds the account tabs once signed in', () => {
    signIn()
    mount()
    expect(tabs()).toEqual(['General', 'Content', 'Connections', 'About'])
  })

  it('shows "Ads & rewards" only when the checker lets the account in', async () => {
    m.adsFor = () => true
    signIn()
    mount()
    await waitFor(() => expect(tabs()).toContain('Ads & rewards'))
    expect(m.fetchAdAccess).toHaveBeenCalledWith('listener')
  })

  it('keeps "Ads & rewards" hidden when the checker refuses the account', async () => {
    m.adsFor = () => true
    m.fetchAdAccess = vi.fn(async () => ({ allowed: false }))
    signIn()
    mount()
    await waitFor(() => expect(m.fetchAdAccess).toHaveBeenCalled())
    expect(tabs()).not.toContain('Ads & rewards')
  })

  it('switches tabs, marking the chosen one', async () => {
    const { user } = mount()
    await user.click(screen.getByRole('tab', { name: 'About' }))
    expect(screen.getByRole('tab', { name: 'About' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByText('v9.8.7')).toBeInTheDocument()
    expect(screen.getByText('https://api.hive.example')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'How 3Speak handles your data' })).toHaveAttribute('href', '/privacy')
    expect(screen.queryByText('Language picker')).not.toBeInTheDocument()
  })

  it('locks the page behind it while open', () => {
    const { unmount } = mount()
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('')
  })

  it('closes from its X and from the backdrop, but not from a click inside', async () => {
    const { user, onClose } = mount()
    await user.click(screen.getByRole('heading', { name: 'Settings' }))
    expect(onClose).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    await user.click(document.querySelector('.settings-modal-overlay'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  // BUG: as a centred window it is neither exposed as a dialog (no role="dialog",
  // no aria-modal, no name; SettingsModal.jsx:1171-1186) nor closable with Escape:
  // the Escape handler is only installed for the hover-peek dropdown (:1133-1138).
  it('BUG: is a named dialog that closes on Escape', async () => {
    const { user, onClose } = mount()
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  describe('as the hover peek under the gear', () => {
    const rect = { bottom: 60, right: 900, top: 20, left: 860, width: 40, height: 40 }

    it('hangs under the gear without an X, and closes on Escape', async () => {
      const { user, onClose } = mount({ dropdown: { rect, held: false } })
      expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
      expect(document.querySelector('.settings-modal')).toHaveStyle({ position: 'fixed', top: '68px' })
      await user.keyboard('{Escape}')
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('gets its X once it is held open', () => {
      mount({ dropdown: { rect, held: true } })
      expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
      expect(document.querySelector('.settings-modal-overlay')).toHaveClass('settings-modal-overlay--held')
    })
  })
})

describe('settings: General and Content', () => {
  it('dark mode follows the theme and switches it', async () => {
    const { user } = mount()
    expect(sw('Dark mode')).toHaveAttribute('aria-checked', 'false')
    await user.click(sw('Dark mode'))
    expect(useAppStore.getState().theme).toBe('dark')
    expect(sw('Dark mode')).toHaveAttribute('aria-checked', 'true')
  })

  it('video previews write to the store; there is no Simple feeds switch any more', async () => {
    const { user } = mount()
    expect(screen.queryByRole('switch', { name: /Simple feeds/ })).toBeNull()
    await user.click(sw('Video previews'))
    expect(useAppStore.getState().previewEnabled).toBe(false)
  })

  it('offers large cards only on a phone-sized screen', () => {
    mount()
    expect(screen.queryByRole('switch', { name: 'Large cards' })).not.toBeInTheDocument()
  })

  it('large cards on a phone', async () => {
    m.cardMobile = true
    const { user } = mount()
    await user.click(sw('Large cards'))
    expect(useAppStore.getState().homeCardSize).toBe('large')
  })

  it('hides the previews switch on a touch screen with small cards, where it would do nothing', () => {
    stubMatchMedia(false)
    mount()
    expect(screen.queryByRole('switch', { name: 'Video previews' })).not.toBeInTheDocument()
  })

  it('Content shows the Feed card, whose switches change what the feeds leave out', async () => {
    const { user } = mount()
    await user.click(screen.getByRole('tab', { name: 'Content' }))
    expect(screen.getByRole('heading', { name: 'Feed' })).toBeInTheDocument()
    expect(sw('Hide watched videos')).toHaveAttribute('aria-checked', 'true')
    await user.click(sw('Show NSFW content'))
    await user.click(sw('Hide watched videos'))
    await user.click(sw('Hide AI-generated videos'))
    await user.click(sw('Private mode'))
    expect(useAppStore.getState()).toMatchObject({ showNsfw: true, hideWatched: false, hideAi: false, privateMode: true })
  })

  it('the Shorts card sets how shorts open and whether they show in feeds', async () => {
    const { user } = mount()
    await user.click(screen.getByRole('tab', { name: 'Content' }))
    expect(screen.queryByRole('switch', { name: 'Comment bar on shorts' })).not.toBeInTheDocument()
    await user.click(sw('Open Shorts on start'))
    await user.click(sw('Shorts inside the feeds'))
    expect(useAppStore.getState()).toMatchObject({ openShortsOnStart: true, inlineShorts: false })
  })

  it('offers the shorts comment bar on a phone, where it is drawn', async () => {
    stubMatchMedia((q) => q === '(max-width: 768px)' || q === '(hover: hover)')
    const { user } = mount()
    await user.click(screen.getByRole('tab', { name: 'Content' }))
    await user.click(sw('Comment bar on shorts'))
    expect(useAppStore.getState().shortsCommentBar).toBe(true)
  })

  // The same tile picker as the interests popup (owner 2026-11-12): categories
  // as tiles, their topics under the open one.
  it('the Spotlight video previews switch writes to the store (desktop with a mouse)', async () => {
    const mm = window.matchMedia
    window.matchMedia = (q) => ({ matches: q.includes('min-width: 769px') && q.includes('hover: hover'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
    try {
      const { user } = mount()
      await user.click(sw('Spotlight video previews'))
      expect(useAppStore.getState().heroPreviewEnabled).toBe(false)
    } finally { window.matchMedia = mm }
  })

  it('Interests: signed out, the tiles are disabled with a hint to log in', async () => {
    const { user } = mount()
    await user.click(screen.getByRole('tab', { name: 'Content' }))
    expect(screen.getByText(/Log in to choose your interests/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Entertainment/ })).toBeDisabled()
  })

  it('Interests: loads the saved topics from Hive and saves a change back', async () => {
    m.fetchUserInterests = vi.fn(async () => ['gaming'])
    signIn()
    const { user } = mount()
    await user.click(screen.getByRole('tab', { name: 'Content' }))
    // A category with a pick opens on its own, its topics below it.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Gaming' })).toHaveAttribute('aria-pressed', 'true'))
    expect(screen.getByRole('button', { name: /^Entertainment/ })).toHaveAttribute('aria-pressed', 'mixed')
    expect(screen.getByRole('button', { name: 'Music' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('button', { name: 'Save to my Hive profile' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Music' }))
    await user.click(screen.getByRole('button', { name: 'Save to my Hive profile' }))
    expect(m.saveInterestsToHive).toHaveBeenCalledWith('listener', ['gaming', 'music'])
    await waitFor(() => expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled())
    expect(toastMessages(toast.success)).toContain('Interests saved to your Hive profile')
  })

  it('Interests: says so when saving fails', async () => {
    m.saveInterestsToHive = vi.fn(async () => { throw new Error('Keychain said no') })
    signIn()
    const { user } = mount()
    await user.click(screen.getByRole('tab', { name: 'Content' }))
    await user.click(screen.getByRole('button', { name: /^Entertainment/ }))   // the whole category
    await user.click(screen.getByRole('button', { name: 'Save to my Hive profile' }))
    expect(m.saveInterestsToHive).toHaveBeenCalledWith('listener', ['entertainment'])
    await waitFor(() => expect(toastMessages(toast.error)).toContain('Keychain said no'))
    expect(screen.getByRole('button', { name: 'Save to my Hive profile' })).toBeEnabled()
  })

  it('About: five quick taps on the node row unlock Butter Auth', async () => {
    const { user } = mount()
    await user.click(screen.getByRole('tab', { name: 'About' }))
    const row = screen.getByText('Hive RPC node')
    // The unlock reloads the page 600 ms later; that timer is dropped unrun.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      for (let i = 0; i < 4; i++) await user.click(row)
      expect(localStorage.getItem('butrauth_unlocked')).toBeNull()
      await user.click(row)
      vi.clearAllTimers()
      expect(localStorage.getItem('butrauth_unlocked')).toBe('true')
      expect(toast.success).toHaveBeenCalledTimes(1)
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })
})

describe('settings: posting authority', () => {
  it('shows that @threespeak may post and removes it after the chain confirms', async () => {
    signIn()
    const { user } = mount()
    expect(screen.getByRole('heading', { name: 'Let 3Speak post for you' })).toBeInTheDocument()
    await screen.findByText('@threespeak can post for you')
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(m.removeAuth).toHaveBeenCalledWith('listener', { signWindow: null })
    expect(await screen.findByRole('button', { name: 'Add' })).toBeEnabled()
    expect(m.waitAuth).toHaveBeenCalledWith('listener', false)
    expect(toastMessages(toast.success)).toContain('@threespeak removed from your posting authority')
  })

  it('sits in the rewards card as one row when that tab exists (38a)', async () => {
    m.adsFor = () => true
    signIn()
    const { user } = mount()
    await user.click(await screen.findByRole('tab', { name: 'Ads & rewards' }))
    expect(screen.getByText('Posting authority')).toBeInTheDocument()
    expect(await screen.findByText('@threespeak can post for you')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'General' }))
    expect(screen.queryByRole('heading', { name: 'Let 3Speak post for you' })).not.toBeInTheDocument()
  })

  it('says when the chain does not show the change yet', async () => {
    m.hasAuth = vi.fn(async () => false)
    m.waitAuth = vi.fn(async () => false)
    signIn()
    const { user } = mount()
    await user.click(await screen.findByRole('button', { name: 'Add' }))
    expect(m.addAuth).toHaveBeenCalledWith('listener', { signWindow: null })
    expect(await screen.findByText(/does not show up on your account yet/)).toBeInTheDocument()
  })

  it('shows the wallet error when signing fails', async () => {
    m.removeAuth = vi.fn(async () => { throw new Error('User rejected') })
    signIn()
    const { user } = mount()
    await user.click(await screen.findByRole('button', { name: 'Remove' }))
    expect(await screen.findByText('User rejected')).toBeInTheDocument()
    expect(m.waitAuth).not.toHaveBeenCalled()
  })

  it('is left out for an account without a Hive account', async () => {
    m.hasAuth = vi.fn(async () => { throw new Error('no account') })
    signIn()
    mount()
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Let 3Speak post for you' })).not.toBeInTheDocument())
  })
})

describe('settings: Connections', () => {
  beforeEach(() => signIn('listener'))

  // Every card of the tab shows at once (38c), so there is no sub-tab to pick.
  async function openConnections(user) {
    await user.click(screen.getByRole('tab', { name: 'Connections' }))
  }

  it('shows the referral card, without the Ads & rewards tab, with the member\'s own link and what it earns', async () => {
    const { user } = mount()
    await openConnections(user)
    expect(screen.getByRole('heading', { name: 'Invite people to 3Speak' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Your referral link' })).toHaveValue(`${window.location.host}/?ref=listener`)
    expect(screen.getByText('3 months')).toBeInTheDocument()
  })

  it('copies the referral link and confirms it', async () => {
    const { user } = mount()
    await openConnections(user)
    const clipboard = stubClipboard()
    try {
      await user.click(screen.getByRole('button', { name: 'Copy' }))
      expect(clipboard.writeText).toHaveBeenCalledWith(`${window.location.origin}/?ref=listener`)
      expect(toastMessages(toast.success)).toContain('Referral link copied')
    } finally { clipboard.restore() }
  })

  it('says when the link could not be copied', async () => {
    const { user } = mount()
    await openConnections(user)
    const clipboard = stubClipboard({ fail: true })
    try {
      await user.click(screen.getByRole('button', { name: 'Copy' }))
      expect(toastMessages(toast.error)).toContain('Could not copy the link')
    } finally { clipboard.restore() }
  })

  it('encodes an unusual account name in the link', async () => {
    signIn('a b&c')
    const { user } = mount()
    await openConnections(user)
    expect(screen.getByRole('textbox', { name: 'Your referral link' })).toHaveValue(`${window.location.host}/?ref=a%20b%26c`)
  })

  it('Linked profiles shows the profile links of the account', async () => {
    const { user } = mount()
    await openConnections(user)
    expect(screen.getByText('Linked profiles of listener')).toBeInTheDocument()
  })

  describe('Support: the Lightning address', () => {
    it('tips go to v4v.app by default', async () => {
      const { user } = mount()
      await openConnections(user)
      expect(await screen.findByText('Tips go to listener@v4v.app')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    })

    it('refuses something that is not a Lightning address', async () => {
      const { user } = mount()
      await openConnections(user)
      const input = await screen.findByRole('textbox', { name: 'Your Lightning address' })
      await waitFor(() => expect(input).toBeEnabled())
      await user.type(input, 'not-an-address{Enter}')
      expect(screen.getByText(/That's not a Lightning address/)).toBeInTheDocument()
      expect(m.saveLn).not.toHaveBeenCalled()
    })

    it('checks an address answers before saving it, lower-cased', async () => {
      const { user } = mount()
      await openConnections(user)
      const input = await screen.findByRole('textbox', { name: 'Your Lightning address' })
      await waitFor(() => expect(input).toBeEnabled())
      await user.type(input, 'Me@Wallet.example')
      await user.click(screen.getByRole('button', { name: 'Save' }))
      expect(m.checkLn).toHaveBeenCalledWith('me@wallet.example')
      expect(m.saveLn).toHaveBeenCalledWith('listener', 'me@wallet.example')
      expect(await screen.findByText('Tips go to me@wallet.example')).toBeInTheDocument()
      expect(toastMessages(toast.success)).toContain('Lightning tips now go to your own address')
    })

    it('does not save an address that does not answer', async () => {
      m.checkLn = vi.fn(async () => { throw new Error('404') })
      const { user } = mount()
      await openConnections(user)
      const input = await screen.findByRole('textbox', { name: 'Your Lightning address' })
      await waitFor(() => expect(input).toBeEnabled())
      await user.type(input, 'me@wallet.example{Enter}')
      expect(await screen.findByText(/did not answer as a Lightning address/)).toBeInTheDocument()
      expect(m.saveLn).not.toHaveBeenCalled()
    })

    it('goes back to v4v.app from an own address', async () => {
      m.readLn = vi.fn(async () => 'me@wallet.example')
      const { user } = mount()
      await openConnections(user)
      await user.click(await screen.findByRole('button', { name: 'Use v4v.app again' }))
      expect(m.checkLn).not.toHaveBeenCalled()
      expect(m.saveLn).toHaveBeenCalledWith('listener', '')
      expect(await screen.findByText('Tips go to listener@v4v.app')).toBeInTheDocument()
    })
  })

  describe('Support: other ways to support', () => {
    it('adds a supported page, normalised, and clears the box', async () => {
      const { user } = mount()
      await openConnections(user)
      const input = await screen.findByRole('textbox', { name: 'Support links' })
      await waitFor(() => expect(input).toBeEnabled())
      await user.type(input, 'www.ko-fi.com/badadib/')
      await user.click(screen.getByRole('button', { name: 'Add' }))
      expect(m.saveLinks).toHaveBeenCalledWith('listener', ['https://ko-fi.com/badadib'])
      expect(await screen.findByRole('link', { name: 'ko-fi.com/badadib' })).toHaveAttribute('href', 'https://ko-fi.com/badadib')
      expect(input).toHaveValue('')
      expect(toastMessages(toast.success)).toContain('Support links saved')
    })

    it('refuses a link to a site it does not know, and a duplicate', async () => {
      m.readLinks = vi.fn(async () => [{ site: { id: 'kofi', label: 'Ko-fi' }, url: 'https://ko-fi.com/badadib' }])
      const { user } = mount()
      await openConnections(user)
      const input = await screen.findByRole('textbox', { name: 'Support links' })
      await waitFor(() => expect(input).toBeEnabled())
      await user.type(input, 'https://example.com/me{Enter}')
      expect(screen.getByText(/Paste the full link to your page/)).toBeInTheDocument()
      await user.clear(input)
      await user.type(input, 'ko-fi.com/badadib{Enter}')
      expect(screen.getByText('That link is already on the list.')).toBeInTheDocument()
      expect(m.saveLinks).not.toHaveBeenCalled()
    })

    it('removes a link from its named button', async () => {
      m.readLinks = vi.fn(async () => [{ site: { id: 'kofi', label: 'Ko-fi' }, url: 'https://ko-fi.com/badadib' }])
      const { user } = mount()
      await openConnections(user)
      await user.click(await screen.findByRole('button', { name: 'Remove the Ko-fi link' }))
      expect(m.saveLinks).toHaveBeenCalledWith('listener', [])
      await waitFor(() => expect(screen.queryByRole('link', { name: 'ko-fi.com/badadib' })).not.toBeInTheDocument())
    })
  })
})

describe('settings: Notifications', () => {
  beforeEach(() => signIn('listener'))

  it('says when this browser cannot show notifications', async () => {
    mount()
    expect(screen.getByText(/This browser can.t show notifications/)).toBeInTheDocument()
  })

  it('registers this device and lists what to be told about, in two groups', async () => {
    m.pushSupported = () => true
    m.getPushPrefs = vi.fn(async () => ({ kinds: ['videos', 'replies', 'votes'], prefs: { votes: false } }))
    const { user } = mount()
    await screen.findByRole('switch', { name: 'Upvotes (off by default)' })
    expect(screen.getByText('From creators you follow')).toBeInTheDocument()
    expect(screen.getByText('About you')).toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: 'New shorts' })).not.toBeInTheDocument()
    expect(sw('Upvotes (off by default)')).toHaveAttribute('aria-checked', 'false')
    expect(sw('Replies')).toHaveAttribute('aria-checked', 'true')

    m.getPushState = vi.fn(async () => ({ supported: true, worker: true, permission: 'granted', subscribed: true }))
    await user.click(sw('Notify this device'))
    expect(m.enablePush).toHaveBeenCalledWith('listener')
    await waitFor(() => expect(sw('Notify this device')).toHaveAttribute('aria-checked', 'true'))
    expect(toastMessages(toast.success)).toContain('This device will be notified')
  })

  it('saves a switched kind, and puts it back when saving fails', async () => {
    m.pushSupported = () => true
    m.setPushPrefs = vi.fn(async () => { throw new Error('offline') })
    const { user } = mount()
    await user.click(await screen.findByRole('switch', { name: 'Replies' }))
    expect(m.setPushPrefs).toHaveBeenCalledWith('listener', { replies: false })
    await waitFor(() => expect(sw('Replies')).toHaveAttribute('aria-checked', 'true'))
    expect(toastMessages(toast.error)).toContain('offline')
  })

  it('says to log in again when the checker wants proof it is them and there is none', async () => {
    m.pushSupported = () => true
    m.setPushPrefs = vi.fn(async () => { throw Object.assign(new Error('raw'), { code: 'not_confirmed' }) })
    const { user } = mount()
    await user.click(await screen.findByRole('switch', { name: 'Replies' }))
    await waitFor(() => expect(sw('Replies')).toHaveAttribute('aria-checked', 'true'))
    expect(toastMessages(toast.error)).toContain('Could not confirm it is you. Log out and back in, then try again.')
  })

  it('cannot be switched on while the browser blocks notifications for the site', async () => {
    m.pushSupported = () => true
    m.getPushState = vi.fn(async () => ({ supported: true, worker: true, permission: 'denied', subscribed: false }))
    const { user } = mount()
    expect(await screen.findByText(/Blocked in your browser settings/)).toBeInTheDocument()
    await user.click(sw('Notify this device'))
    expect(m.enablePush).not.toHaveBeenCalled()
  })
})

describe('settings: Ads & rewards', () => {
  beforeEach(() => {
    m.adsFor = () => true
    signIn('listener')
  })

  async function openRewards(user) {
    await user.click(await screen.findByRole('tab', { name: 'Ads & rewards' }))
  }

  it('turns ads on the creator\'s videos off and says so', async () => {
    const { user } = mount()
    await openRewards(user)
    await waitFor(() => expect(sw('Allow ads on your videos')).toHaveAttribute('aria-checked', 'true'))
    await user.click(sw('Allow ads on your videos'))
    expect(m.saveCreatorAdSettings).toHaveBeenCalledWith('listener', expect.objectContaining({ adsEnabled: false }))
    await waitFor(() => expect(toastMessages(toast.success)).toContain('Ads are off for your videos'))
    expect(screen.queryByRole('switch', { name: 'Video ad rolls' })).not.toBeInTheDocument()
  })

  it('puts the switch back when the save fails', async () => {
    m.saveCreatorAdSettings = vi.fn(async () => { throw new Error('Signature refused') })
    const { user } = mount()
    await openRewards(user)
    await waitFor(() => expect(m.fetchCreatorAdPrefs).toHaveBeenCalled())
    await user.click(sw('Video ad rolls'))
    expect(await screen.findByText('Signature refused')).toBeInTheDocument()
    expect(sw('Video ad rolls')).toHaveAttribute('aria-checked', 'true')
  })

  it('edits the community share within the pool and saves it', async () => {
    m.fetchCreatorAdPrefs = vi.fn(async () => ({ adsEnabled: true, split: { poolPct: 50, communityPct: 10, creatorPct: 40 } }))
    m.saveCreatorAdSettings = vi.fn(async () => ({ chainSaved: false, split: { poolPct: 50, communityPct: 20, creatorPct: 30 } }))
    const { user } = mount()
    await openRewards(user)
    const input = await screen.findByLabelText(/community/i, { selector: 'input' })
    await user.clear(input)
    await user.type(input, '60')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    await user.clear(input)
    await user.type(input, '20{Enter}')
    expect(m.saveCreatorAdSettings).toHaveBeenCalledWith('listener', expect.objectContaining({ communitySharePct: 20 }))
    expect(await screen.findByText(/not on your Hive account/)).toBeInTheDocument()
  })

  it('viewer rewards: one switch turns on watching and listening together', async () => {
    const { user } = mount()
    await openRewards(user)
    const toggle = await screen.findByRole('switch', { name: 'Earn a share of ad revenue for what you watch' })
    await waitFor(() => expect(m.fetchViewerAdPrefs).toHaveBeenCalled())
    await user.click(toggle)
    expect(m.setViewerAdPrefs).toHaveBeenCalledWith('listener', { rewardsEnabled: true })
    await waitFor(() => expect(m.setListenerAdPrefs).toHaveBeenCalledWith('listener', { listenEnabled: true }))
    expect(m.resetViewerRewards).toHaveBeenCalled()
    expect(toastMessages(toast.success)).toContain('Rewards for watching and listening on')
  })

  it('viewer rewards: someone who agreed only to watching can add listening', async () => {
    m.fetchViewerAdPrefs = vi.fn(async () => ({ rewardsEnabled: true, listenEnabled: false }))
    const { user } = mount()
    await openRewards(user)
    const listen = await screen.findByRole('switch', { name: 'Count my listening too' })
    await waitFor(() => expect(listen).toBeEnabled())
    expect(listen).toHaveAttribute('aria-checked', 'false')
    await user.click(listen)
    expect(m.setListenerAdPrefs).toHaveBeenCalledWith('listener', { listenEnabled: true })
    await waitFor(() => expect(listen).toHaveAttribute('aria-checked', 'true'))
    expect(toastMessages(toast.success)).toContain('Your listening now counts toward listener rewards')
  })

  it('viewer rewards: listening can be switched off on its own', async () => {
    m.fetchViewerAdPrefs = vi.fn(async () => ({ rewardsEnabled: true, listenEnabled: true }))
    const { user } = mount()
    await openRewards(user)
    const listen = await screen.findByRole('switch', { name: 'Count my listening too' })
    await waitFor(() => expect(listen).toHaveAttribute('aria-checked', 'true'))
    await user.click(listen)
    expect(m.setListenerAdPrefs).toHaveBeenCalledWith('listener', { listenEnabled: false })
    expect(m.setViewerAdPrefs).not.toHaveBeenCalled()
    await waitFor(() => expect(listen).toHaveAttribute('aria-checked', 'false'))
    expect(sw('Earn a share of ad revenue for what you watch')).toHaveAttribute('aria-checked', 'true')
  })

  it('viewer rewards: the listening switch waits for viewer rewards to be on', async () => {
    const { user } = mount()
    await openRewards(user)
    await waitFor(() => expect(m.fetchViewerAdPrefs).toHaveBeenCalled())
    expect(await screen.findByRole('switch', { name: 'Count my listening too' })).toBeDisabled()
  })

  it('viewer rewards: a failed save is rolled back with the reason', async () => {
    m.setViewerAdPrefs = vi.fn(async () => { throw new Error('Checker down') })
    const { user } = mount()
    await openRewards(user)
    const toggle = await screen.findByRole('switch', { name: 'Earn a share of ad revenue for what you watch' })
    await user.click(toggle)
    expect(await screen.findByText('Checker down')).toBeInTheDocument()
    expect(toggle).toHaveAttribute('aria-checked', 'false')
  })

  it('falls back to General when the account loses access while on the page', async () => {
    const { user } = mount()
    await openRewards(user)
    act(() => useAppStore.setState({ user: null }))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true'))
  })
})
