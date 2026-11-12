// The app-wide store (src/lib/store.js): which settings survive a reload (and
// which deliberately do not), the migrations that flipped "Hide watched" and
// "Hide AI-generated" to on, and the setters that take a value or an updater.
// Also the small slices composed into it (theme, user details, mini player,
// upload processing, video, studio) and the old Redux user reducer.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { create } from 'zustand'

vi.mock('../../../src/hive-api/aioha', () => ({
  default: { getCurrentUser: () => null, logout: () => {}, switchUser: () => true, removeOtherLogin: () => {} },
  isLoggedIn: () => false,
}))
vi.mock('../../../src/utils/toast', () => ({ toastIn: () => ({ success: () => {}, error: () => {} }) }))
vi.mock('../../../src/i18n', () => ({ t: (k) => k }))
vi.mock('../../../src/utils/api', () => ({ api: { auth: {} } }))
const axiosPost = vi.hoisted(() => vi.fn())
vi.mock('axios', () => ({ default: { post: axiosPost } }))
vi.mock('../../../src/utils/config', () => ({ HIVE_API_URL: 'https://hive.test', API_URL_FROM_WEST: 'https://west.test' }))

const persisted = () => JSON.parse(localStorage.getItem('user-store'))

async function loadStore() {
  vi.resetModules()
  return (await import('../../../src/lib/store.js')).useAppStore
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.classList.remove('dark')
})

describe('first visit defaults', () => {
  it('starts with the documented defaults', async () => {
    const s = (await loadStore()).getState()
    expect(s).toMatchObject({
      theme: 'dark', homeCardSize: 'large', spotlightSize: 'small', previewEnabled: true,
      hideWatched: true, hideAi: true, inlineShorts: true, privateMode: false,
      shortsFeedMode: 'discover', shortsCommentBar: false, openShortsOnStart: false,
      watchHistoryEnabled: true, showNsfw: false, interests: [], appUpdatedFrom: null,
    })
  })
})

describe('what survives a reload', () => {
  it('saves the settings under user-store, but not session-only state', async () => {
    const store = await loadStore()
    store.getState().setUser('badadib')
    store.getState().setPrivateMode(true)
    store.getState().setInterests(['music'])
    store.getState().setAppUpdatedFrom('1.80.0')
    store.getState().setMiniPlayer({ author: 'badadib', permlink: 'p' })

    const saved = persisted()
    expect(saved.version).toBe(4)
    expect(saved.state).toMatchObject({ user: 'badadib', privateMode: true, interests: ['music'], theme: 'dark' })
    expect(saved.state).not.toHaveProperty('appUpdatedFrom')
    expect(saved.state).not.toHaveProperty('miniPlayer')
    expect(saved.state).not.toHaveProperty('authenticated')
  })

  it('a reload restores what was saved', async () => {
    localStorage.setItem('user-store', JSON.stringify({ version: 3, state: { homeCardSize: 'small', hideAi: false, theme: 'light' } }))
    const s = (await loadStore()).getState()
    expect(s).toMatchObject({ homeCardSize: 'small', hideAi: false, theme: 'light' })
  })
})

describe('migrating an older saved store', () => {
  it('drops an old "Simple feeds" choice (the setting is gone)', async () => {
    localStorage.setItem('user-store', JSON.stringify({ version: 3, state: { simpleFeed: true, theme: 'light' } }))
    const s = (await loadStore()).getState()
    expect(s.simpleFeed).toBeUndefined()
    expect(s.theme).toBe('light')
  })

  it.each([
    [0, { hideWatched: false, hideAi: false }, { hideWatched: true, hideAi: true }],
    [1, { hideWatched: false, hideAi: false }, { hideWatched: false, hideAi: true }],
    [2, { hideWatched: false, hideAi: false }, { hideWatched: false, hideAi: false }],
    [3, { hideWatched: false, hideAi: false }, { hideWatched: false, hideAi: false }],
  ])('a version %i store becomes %o -> %o', async (version, state, expected) => {
    localStorage.setItem('user-store', JSON.stringify({ version, state }))
    const s = (await loadStore()).getState()
    expect({ hideWatched: s.hideWatched, hideAi: s.hideAi }).toEqual(expected)
  })

  // v3: phone cards default to one per row (20a); a saved 'large' was a choice.
  it.each([
    [2, 'small', 'large'],
    [2, 'large', 'large'],
    [3, 'small', 'small'],
  ])('a version %i store with %s cards gets %s cards', async (version, saved, expected) => {
    localStorage.setItem('user-store', JSON.stringify({ version, state: { homeCardSize: saved } }))
    expect((await loadStore()).getState().homeCardSize).toBe(expected)
  })
})

describe('the setters', () => {
  let store
  beforeEach(async () => { store = await loadStore() })

  it.each([
    ['setShowNsfw', 'showNsfw'],
    ['setHomeCardSize', 'homeCardSize'],
    ['setPreviewEnabled', 'previewEnabled'],
    ['setInterests', 'interests'],
    ['setHideWatched', 'hideWatched'],
    ['setPrivateMode', 'privateMode'],
  ])('%s takes a value or an updater of the previous value', (setter, key) => {
    store.getState()[setter]('first')
    expect(store.getState()[key]).toBe('first')
    store.getState()[setter]((prev) => `${prev}+next`)
    expect(store.getState()[key]).toBe('first+next')
  })

  it.each([
    ['setShortsCommentBar', 'shortsCommentBar'],
    ['setInlineShorts', 'inlineShorts'],
    ['setOpenShortsOnStart', 'openShortsOnStart'],
    ['setHideAi', 'hideAi'],
  ])('%s always stores a boolean, from a value or an updater', (setter, key) => {
    store.getState()[setter]('yes')
    expect(store.getState()[key]).toBe(true)
    store.getState()[setter]((prev) => !prev)
    expect(store.getState()[key]).toBe(false)
    store.getState()[setter](0)
    expect(store.getState()[key]).toBe(false)
  })

  it.each([
    ['interests', 'interests'],
    ['discover', 'discover'],
    ['anything else', 'discover'],
    [undefined, 'discover'],
  ])('the shorts feed mode %s is stored as %s', (input, expected) => {
    store.getState().setShortsFeedMode('interests')
    store.getState().setShortsFeedMode(input)
    expect(store.getState().shortsFeedMode).toBe(expected)
  })

  it('plain setters store what they are given', () => {
    store.getState().setSpotlightSize('medium')
    store.getState().setWatchHistoryEnabled(false)
    expect(store.getState()).toMatchObject({ spotlightSize: 'medium', watchHistoryEnabled: false })
  })
})

describe('the theme', () => {
  let listeners
  let prefersDark
  let store

  beforeEach(async () => {
    listeners = []
    prefersDark = false
    window.matchMedia = vi.fn(() => ({ matches: prefersDark, addEventListener: (_e, fn) => listeners.push(fn) }))
    store = await loadStore()
  })

  it('applies dark: data-theme plus the dark class Tailwind-styled widgets read', () => {
    store.getState().setTheme('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('applies light and removes the dark class', () => {
    store.getState().setTheme('dark')
    store.getState().setTheme('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('toggles between dark and light', () => {
    store.getState().toggleTheme()
    expect(store.getState().theme).toBe('light')
    store.getState().toggleTheme()
    expect(store.getState().theme).toBe('dark')
  })

  it.each([[true, 'dark'], [false, 'light']])('"system" follows the device (prefers dark: %s -> %s)', (dark, expected) => {
    prefersDark = dark
    store.getState().setTheme('system')
    expect(store.getState().theme).toBe('system')
    expect(store.getState().getEffectiveTheme()).toBe(expected)
    expect(document.documentElement.getAttribute('data-theme')).toBe(expected)
  })

  it('an explicit theme is its own effective theme', () => {
    store.getState().setTheme('light')
    expect(store.getState().getEffectiveTheme()).toBe('light')
  })

  it('on load re-applies the saved theme, and with "system" follows later device changes', () => {
    store.setState({ theme: 'system' })
    store.getState().initializeTheme()
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(listeners).toHaveLength(1)

    listeners[0]({ matches: true })
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    listeners[0]({ matches: false })
    expect(document.documentElement.classList.contains('dark')).toBe(false)

    // Once an explicit theme is chosen, device changes no longer apply.
    store.getState().setTheme('dark')
    listeners[0]({ matches: false })
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('an explicit saved theme does not listen to the device', () => {
    store.getState().initializeTheme()
    expect(listeners).toHaveLength(0)
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })
})

describe('the Hive profile details', () => {
  let store
  beforeEach(async () => { store = await loadStore(); vi.spyOn(console, 'log').mockImplementation(() => {}); axiosPost.mockReset() })

  it('asks a Hive node for the account and keeps the profile from posting_json_metadata', async () => {
    axiosPost.mockResolvedValue({ data: { result: [{ posting_json_metadata: JSON.stringify({ profile: { name: 'Bada' } }) }] } })
    await store.getState().getUserHiveDetails('badadib')
    expect(axiosPost).toHaveBeenCalledWith('https://hive.test',
      expect.objectContaining({ jsonrpc: '2.0', method: 'condenser_api.get_accounts', params: [['badadib']] }), expect.any(Object))
    expect(store.getState().userhiveDetails).toEqual({ name: 'Bada' })
  })

  it('an account without posting metadata keeps no profile', async () => {
    axiosPost.mockResolvedValue({ data: { result: [{ posting_json_metadata: '' }] } })
    await store.getState().getUserHiveDetails('badadib')
    expect(store.getState().userhiveDetails).toBeNull()
  })

  // BUG: getUserHiveDetails (src/lib/slices/createUserStore.js:37) reads
  // response.data.result[0].posting_json_metadata without checking the array has
  // an entry; an unknown account (result: []) throws a TypeError instead of
  // leaving the details empty.
  it('BUG: an unknown account (empty result) leaves the profile empty instead of throwing', async () => {
    axiosPost.mockResolvedValue({ data: { result: [] } })
    await expect(store.getState().getUserHiveDetails('nobody')).resolves.toBeDefined()
    expect(store.getState().userhiveDetails).toBeNull()
  })

  it('setUserHiveDetails remembers the name', async () => {
    await store.getState().setUserHiveDetails('badadib')
    expect(store.getState().userName).toBe('badadib')
  })
})

describe('the small slices', () => {
  let store
  beforeEach(async () => { store = await loadStore() })

  it('the mini player opens with a video and clears', () => {
    store.getState().setMiniPlayer({ author: 'badadib', permlink: 'p', currentTime: 12 })
    expect(store.getState().miniPlayer).toEqual({ author: 'badadib', permlink: 'p', currentTime: 12 })
    store.getState().clearMiniPlayer()
    expect(store.getState().miniPlayer).toBeNull()
  })

  it('upload processing remembers which post is processing, and persists it', () => {
    store.getState().updateProcessing('perm-1', 'My video', 'badadib')
    expect(store.getState()).toMatchObject({ isProcessing: 'perm-1', title: 'My video', processUser: 'badadib' })
    expect(persisted().state.isProcessing).toBe('perm-1')
  })

  it('the current video is set', async () => {
    await store.getState().setVideo({ permlink: 'p' })
    expect(store.getState().video).toEqual({ permlink: 'p' })
  })

  it('the studio starts with its placeholder news and replaces it from the server', async () => {
    expect(store.getState().news).toHaveLength(10)
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => [{ id: 1, title: 'x' }] })))
    await store.getState().fetchNews()
    expect(store.getState().news).toEqual([{ id: 1, title: 'x' }])
  })
})

describe('the unused identities slice', () => {
  it('stores what its endpoints return', async () => {
    const { createPostSlice } = await import('../../../src/lib/slices/createIdentitiesSlice.js')
    const s = create((...a) => createPostSlice(...a))
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ['a'] })))
    await s.getState().switch()
    await s.getState().disconnect()
    expect(s.getState()).toMatchObject({ account: ['a'], accounts: ['a'] })
  })
})

describe('the Redux user reducer', () => {
  it('walks a login through start, success and logout', async () => {
    const { default: store } = await import('../../../src/redux/Store.js')
    const { loginStart, loginSuccess, logout } = await import('../../../src/redux/userReducer.js')
    expect(store.getState().user).toEqual({ currentUser: null, token: null, loading: false, error: null })
    store.dispatch(loginStart())
    expect(store.getState().user.loading).toBe(true)
    store.dispatch(loginSuccess({ user: 'badadib', token: 't' }))
    expect(store.getState().user).toMatchObject({ loading: false, currentUser: 'badadib', token: 't' })
    store.dispatch(logout())
    expect(store.getState().user).toMatchObject({ currentUser: null, token: null })
  })

  it('a failed login keeps the error and clears it on the next attempt', async () => {
    const { default: reducer, loginFailure, loginStart } = await import('../../../src/redux/userReducer.js')
    let s = reducer(undefined, loginFailure('Wrong password'))
    expect(s).toMatchObject({ loading: false, error: 'Wrong password' })
    s = reducer(s, loginStart())
    expect(s.error).toBeNull()
  })
})
