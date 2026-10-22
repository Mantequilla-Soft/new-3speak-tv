// A creator's ad settings, kept in the checker AND mirrored into their own
// posting_json_metadata under 3speak.ads (src/utils/adSettings.js).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const h = vi.hoisted(() => ({
  getAccounts: vi.fn(),
  broadcastWithAioha: vi.fn(),
  fetchCreatorAdPrefs: vi.fn(),
  setCreatorAdPrefs: vi.fn(),
}))
vi.mock('../../../src/hive-api/hiveApi', () => ({ getAccounts: h.getAccounts }))
vi.mock('../../../src/hive-api/aioha', () => ({
  broadcastWithAioha: h.broadcastWithAioha,
  KeyTypes: { Posting: 'posting', Active: 'active' },
}))
vi.mock('../../../src/lib/advertiseData', () => ({
  fetchCreatorAdPrefs: h.fetchCreatorAdPrefs,
  setCreatorAdPrefs: h.setCreatorAdPrefs,
}))

import {
  readAdSettingsFromAccount,
  fetchAdSettingsFromHive,
  saveAdSettingsToHive,
  readCreatorAdChoice,
  saveCreatorAdSettings,
} from '../../../src/utils/adSettings.js'

const withAds = (ads, extra = {}) => ({ posting_json_metadata: JSON.stringify({ ...extra, '3speak': { ads } }) })

beforeEach(() => {
  Object.values(h).forEach((f) => f.mockReset())
})

describe('readAdSettingsFromAccount', () => {
  it('is null when the creator never chose (not the same as "ads off")', () => {
    expect(readAdSettingsFromAccount(null)).toBeNull()
    expect(readAdSettingsFromAccount({ posting_json_metadata: '' })).toBeNull()
    expect(readAdSettingsFromAccount({ posting_json_metadata: '{"profile":{}}' })).toBeNull()
    expect(readAdSettingsFromAccount({ posting_json_metadata: '{broken' })).toBeNull()
    expect(readAdSettingsFromAccount(withAds('yes'))).toBeNull()
  })

  it('only a literal false turns ads or rolls off', () => {
    expect(readAdSettingsFromAccount(withAds({ enabled: false, rolls: false }))).toMatchObject({ enabled: false, rolls: false })
    expect(readAdSettingsFromAccount(withAds({ enabled: 'false', rolls: 0 }))).toMatchObject({ enabled: true, rolls: true })
    expect(readAdSettingsFromAccount(withAds({}))).toMatchObject({ enabled: true, rolls: true })
  })

  it('accepts an integer community share between 0 and 100 only', () => {
    expect(readAdSettingsFromAccount(withAds({ communityPct: 0 })).communityPct).toBe(0)
    expect(readAdSettingsFromAccount(withAds({ communityPct: 100 })).communityPct).toBe(100)
    expect(readAdSettingsFromAccount(withAds({ communityPct: '30' })).communityPct).toBe(30)
    expect(readAdSettingsFromAccount(withAds({ communityPct: 101 })).communityPct).toBeNull()
    expect(readAdSettingsFromAccount(withAds({ communityPct: -1 })).communityPct).toBeNull()
    expect(readAdSettingsFromAccount(withAds({ communityPct: 12.5 })).communityPct).toBeNull()
    expect(readAdSettingsFromAccount(withAds({})).communityPct).toBeNull()
  })

  it('reads metadata that is already an object, and keeps updatedAt only as a string', () => {
    const acct = { posting_json_metadata: { '3speak': { ads: { enabled: true, updatedAt: '2026-10-01T00:00:00Z' } } } }
    expect(readAdSettingsFromAccount(acct).updatedAt).toBe('2026-10-01T00:00:00Z')
    expect(readAdSettingsFromAccount(withAds({ updatedAt: 5 })).updatedAt).toBeNull()
  })
})

describe('fetchAdSettingsFromHive', () => {
  it('cleans the name and reads the account', async () => {
    h.getAccounts.mockResolvedValue([withAds({ enabled: false })])
    expect(await fetchAdSettingsFromHive(' @Alice ')).toMatchObject({ enabled: false })
    expect(h.getAccounts).toHaveBeenCalledWith(['alice'])
  })

  it('is null for no name, no account or a failed lookup', async () => {
    expect(await fetchAdSettingsFromHive('')).toBeNull()
    h.getAccounts.mockResolvedValueOnce([])
    expect(await fetchAdSettingsFromHive('ghost')).toBeNull()
    h.getAccounts.mockRejectedValueOnce(new Error('down'))
    expect(await fetchAdSettingsFromHive('alice')).toBeNull()
  })
})

describe('saveAdSettingsToHive', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.UTC(2026, 9, 22))
    h.broadcastWithAioha.mockResolvedValue({ success: true })
  })
  afterEach(() => vi.useRealTimers())

  it('merges into the existing metadata and broadcasts with posting authority', async () => {
    h.getAccounts.mockResolvedValue([{ posting_json_metadata: JSON.stringify({ profile: { name: 'A' }, '3speak': { interests: ['music'] }, other: 1 }) }])
    const ads = await saveAdSettingsToHive('@Alice', { adsEnabled: true, communitySharePct: 20 })
    expect(ads).toEqual({ enabled: true, updatedAt: '2026-10-22T00:00:00.000Z', communityPct: 20 })

    const [[op], keyType] = h.broadcastWithAioha.mock.calls[0]
    expect(keyType).toBe('posting')
    expect(op[0]).toBe('account_update2')
    expect(op[1]).toMatchObject({ account: 'alice', json_metadata: '', extensions: [] })
    expect(JSON.parse(op[1].posting_json_metadata)).toEqual({
      profile: { name: 'A' },
      other: 1,
      '3speak': { interests: ['music'], ads },
    })
  })

  it('writes rolls:false only when rolls are off while ads are on', async () => {
    h.getAccounts.mockResolvedValue([{}])
    expect((await saveAdSettingsToHive('a', { adsEnabled: true, rollsEnabled: false })).rolls).toBe(false)
    expect('rolls' in (await saveAdSettingsToHive('a', { adsEnabled: true }))).toBe(false)
    expect('rolls' in (await saveAdSettingsToHive('a', { adsEnabled: false, rollsEnabled: false }))).toBe(false)
  })

  it('omits communityPct when no integer is given', async () => {
    h.getAccounts.mockResolvedValue([{}])
    expect('communityPct' in (await saveAdSettingsToHive('a', { adsEnabled: true, communitySharePct: null }))).toBe(false)
    expect('communityPct' in (await saveAdSettingsToHive('a', { adsEnabled: true, communitySharePct: 2.5 }))).toBe(false)
  })

  it('throws without a username or when the broadcast fails', async () => {
    await expect(saveAdSettingsToHive('', { adsEnabled: true })).rejects.toThrow()
    h.getAccounts.mockResolvedValue([{}])
    h.broadcastWithAioha.mockResolvedValue({ success: false })
    await expect(saveAdSettingsToHive('a', { adsEnabled: true })).rejects.toThrow()
  })
})

describe('readCreatorAdChoice', () => {
  it('chosen is null (do not prompt) when neither store can be read', async () => {
    h.fetchCreatorAdPrefs.mockRejectedValue(new Error('down'))
    h.getAccounts.mockRejectedValue(new Error('down'))
    expect(await readCreatorAdChoice('alice')).toEqual({ chosen: null, split: null, adsEnabled: true, rollsEnabled: true })
  })

  it('no username is "unknown", not "never chose"', async () => {
    expect((await readCreatorAdChoice('')).chosen).toBeNull()
  })

  it('a server row without updatedAt is not a choice, but chain settings are', async () => {
    h.fetchCreatorAdPrefs.mockResolvedValue({ split: { creatorPct: 70 }, adsEnabled: true })
    h.getAccounts.mockResolvedValue([{}])
    expect((await readCreatorAdChoice('alice')).chosen).toBe(false)

    h.getAccounts.mockResolvedValue([withAds({ enabled: true })])
    expect((await readCreatorAdChoice('alice')).chosen).toBe(true)
  })

  it('the server row wins for the switches and supplies the split', async () => {
    h.fetchCreatorAdPrefs.mockResolvedValue({ updatedAt: 'x', split: { communityPct: 10 }, adsEnabled: false, rollsEnabled: false })
    h.getAccounts.mockResolvedValue([withAds({ enabled: true, rolls: true })])
    expect(await readCreatorAdChoice('alice')).toEqual({ chosen: true, split: { communityPct: 10 }, adsEnabled: false, rollsEnabled: false })
  })

  it('falls back to the chain copy when the checker is down', async () => {
    h.fetchCreatorAdPrefs.mockRejectedValue(new Error('down'))
    h.getAccounts.mockResolvedValue([withAds({ enabled: false, rolls: false })])
    expect(await readCreatorAdChoice('alice')).toEqual({ chosen: true, split: null, adsEnabled: false, rollsEnabled: false })
  })
})

describe('saveCreatorAdSettings', () => {
  it('saves the checker first and mirrors the share the server settled on', async () => {
    h.setCreatorAdPrefs.mockResolvedValue({ ok: true, split: { communityPct: 15 } })
    h.getAccounts.mockResolvedValue([{}])
    h.broadcastWithAioha.mockResolvedValue({ success: true })
    const r = await saveCreatorAdSettings('alice', { adsEnabled: true, communitySharePct: 99 })
    expect(h.setCreatorAdPrefs).toHaveBeenCalledWith('alice', { adsEnabled: true, rollsEnabled: true, communitySharePct: 99 })
    const meta = JSON.parse(h.broadcastWithAioha.mock.calls[0][0][0][1].posting_json_metadata)
    expect(meta['3speak'].ads.communityPct).toBe(15)
    expect(r).toMatchObject({ ok: true, chainSaved: true, chainError: null })
  })

  it('a rejected wallet write still reports the checker save as done', async () => {
    h.setCreatorAdPrefs.mockResolvedValue({ ok: true })
    h.getAccounts.mockResolvedValue([{}])
    h.broadcastWithAioha.mockResolvedValue({ success: false })
    const r = await saveCreatorAdSettings('alice', { adsEnabled: false })
    expect(r.ok).toBe(true)
    expect(r.chainSaved).toBe(false)
    expect(typeof r.chainError).toBe('string')
  })

  it('a failed checker save fails the whole save and skips the chain', async () => {
    h.setCreatorAdPrefs.mockRejectedValue(new Error('checker down'))
    await expect(saveCreatorAdSettings('alice', { adsEnabled: true })).rejects.toThrow('checker down')
    expect(h.broadcastWithAioha).not.toHaveBeenCalled()
  })
})
