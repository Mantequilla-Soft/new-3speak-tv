// Which name (if any) a watch session carries for ad viewer rewards: only an
// opted-in, still-logged-in viewer is ever named (src/utils/viewerRewards.js).
import { describe, it, expect, beforeEach, vi } from 'vitest'

const state = vi.hoisted(() => ({ user: null }))
const fetchViewerAdPrefs = vi.hoisted(() => vi.fn())

vi.mock('../../../src/lib/store', () => ({ useAppStore: { getState: () => state } }))
vi.mock('../../../src/lib/advertiseData', () => ({ fetchViewerAdPrefs }))

let mod
beforeEach(async () => {
  vi.resetModules()
  fetchViewerAdPrefs.mockReset()
  state.user = null
  mod = await import('../../../src/utils/viewerRewards.js')
})

describe('viewerRewardsName', () => {
  it('names nobody when logged out', async () => {
    expect(await mod.viewerRewardsName()).toBeNull()
    expect(fetchViewerAdPrefs).not.toHaveBeenCalled()
  })

  it('names an opted-in viewer on the very first video (cold cache)', async () => {
    state.user = 'alice'
    fetchViewerAdPrefs.mockResolvedValue({ rewardsEnabled: true })
    expect(await mod.viewerRewardsName()).toBe('alice')
  })

  it('does not name a viewer who declined or was never asked', async () => {
    state.user = 'alice'
    fetchViewerAdPrefs.mockResolvedValue({ rewardsEnabled: false })
    expect(await mod.viewerRewardsName()).toBeNull()
    mod.primeViewerRewards(null)
    fetchViewerAdPrefs.mockResolvedValue({})
    expect(await mod.viewerRewardsName()).toBeNull()
  })

  it('only a strict true opts in', async () => {
    state.user = 'alice'
    fetchViewerAdPrefs.mockResolvedValue({ rewardsEnabled: 'true' })
    expect(await mod.viewerRewardsName()).toBeNull()
  })

  it('fails closed when the preference cannot be read', async () => {
    state.user = 'alice'
    fetchViewerAdPrefs.mockRejectedValue(new Error('down'))
    expect(await mod.viewerRewardsName()).toBeNull()
  })

  it('fetches the opt-in once per account and reuses it', async () => {
    state.user = 'alice'
    fetchViewerAdPrefs.mockResolvedValue({ rewardsEnabled: true })
    await mod.viewerRewardsName()
    await mod.viewerRewardsName()
    expect(fetchViewerAdPrefs).toHaveBeenCalledTimes(1)
    expect(fetchViewerAdPrefs).toHaveBeenCalledWith('alice')
  })

  it('never sends a name when the account changed while the fetch was in flight', async () => {
    state.user = 'alice'
    let release
    fetchViewerAdPrefs.mockReturnValue(new Promise((r) => { release = r }))
    const pending = mod.viewerRewardsName()
    state.user = 'bob'
    release({ rewardsEnabled: true })
    expect(await pending).toBeNull()
  })

  it('never sends a name after logout during the fetch', async () => {
    state.user = 'alice'
    let release
    fetchViewerAdPrefs.mockReturnValue(new Promise((r) => { release = r }))
    const pending = mod.viewerRewardsName()
    state.user = null
    release({ rewardsEnabled: true })
    expect(await pending).toBeNull()
  })
})

describe('primeViewerRewards', () => {
  it('resolves false and clears the cache without an account', async () => {
    expect(await mod.primeViewerRewards(null)).toBe(false)
    expect(fetchViewerAdPrefs).not.toHaveBeenCalled()
  })

  it('shares one in-flight request between concurrent callers', async () => {
    fetchViewerAdPrefs.mockResolvedValue({ rewardsEnabled: true })
    const [a, b] = await Promise.all([mod.primeViewerRewards('alice'), mod.primeViewerRewards('alice')])
    expect(a).toBe(true)
    expect(b).toBe(true)
    expect(fetchViewerAdPrefs).toHaveBeenCalledTimes(1)
  })
})
