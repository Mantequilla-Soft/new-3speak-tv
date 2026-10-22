// The Hive `profile` block (src/utils/profileMeta.js): reading it from either
// metadata field, deciding if it is empty, and saving edits without losing
// other apps' keys.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../src/hive-api/hiveApi', () => ({ getAccounts: vi.fn() }))
vi.mock('../../../src/hive-api/aioha', () => ({ broadcastWithAioha: vi.fn(), KeyTypes: { Posting: 'posting' } }))
vi.mock('../../../src/i18n', () => ({ t: (k) => k }))

import { getAccounts } from '../../../src/hive-api/hiveApi'
import { broadcastWithAioha } from '../../../src/hive-api/aioha'
import {
  readProfileFromAccount, fetchProfile, isProfileEmpty, saveProfileToHive, EDITABLE_PROFILE_FIELDS,
} from '../../../src/utils/profileMeta.js'

beforeEach(() => {
  vi.mocked(getAccounts).mockReset()
  vi.mocked(broadcastWithAioha).mockReset()
})

const savedMeta = () => JSON.parse(vi.mocked(broadcastWithAioha).mock.calls[0][0][0][1].posting_json_metadata)

describe('readProfileFromAccount', () => {
  it('reads posting_json_metadata first', () => {
    const account = {
      posting_json_metadata: JSON.stringify({ profile: { name: 'New' } }),
      json_metadata: JSON.stringify({ profile: { name: 'Old' } }),
    }
    expect(readProfileFromAccount(account)).toEqual({ name: 'New' })
  })

  it('falls back to the legacy json_metadata', () => {
    expect(readProfileFromAccount({ posting_json_metadata: '{}', json_metadata: '{"profile":{"about":"hi"}}' })).toEqual({ about: 'hi' })
    expect(readProfileFromAccount({ posting_json_metadata: { profile: { name: 'obj' } } })).toEqual({ name: 'obj' })
  })

  it('is empty for no account, malformed JSON or a non-object profile', () => {
    expect(readProfileFromAccount(null)).toEqual({})
    expect(readProfileFromAccount({ posting_json_metadata: '{bad', json_metadata: 'also bad' })).toEqual({})
    expect(readProfileFromAccount({ posting_json_metadata: '{"profile":"x"}' })).toEqual({})
  })
})

describe('fetchProfile', () => {
  it('cleans the name and returns the profile', async () => {
    vi.mocked(getAccounts).mockResolvedValue([{ posting_json_metadata: '{"profile":{"name":"A"}}' }])
    expect(await fetchProfile(' @Alice')).toEqual({ name: 'A' })
    expect(getAccounts).toHaveBeenCalledWith(['alice'])
  })

  it('tells "could not read" (null) apart from "no profile" ({})', async () => {
    expect(await fetchProfile('')).toBeNull()
    vi.mocked(getAccounts).mockResolvedValueOnce([])
    expect(await fetchProfile('ghost')).toBeNull()
    vi.mocked(getAccounts).mockImplementationOnce(async () => { throw new Error('rpc') })
    expect(await fetchProfile('bob')).toBeNull()
    vi.mocked(getAccounts).mockResolvedValueOnce([{ posting_json_metadata: '' }])
    expect(await fetchProfile('bob')).toEqual({})
  })
})

describe('isProfileEmpty', () => {
  it('only whitespace or unrelated keys count as empty', () => {
    expect(isProfileEmpty(null)).toBe(true)
    expect(isProfileEmpty({})).toBe(true)
    expect(isProfileEmpty({ name: '   ', website: 'https://x', version: 2 })).toBe(true)
    expect(isProfileEmpty({ location: 'Berlin' })).toBe(false)
    expect(isProfileEmpty({ cover_image: 'https://c' })).toBe(false)
  })
})

describe('saveProfileToHive', () => {
  const account = {
    posting_json_metadata: JSON.stringify({
      profile: { name: 'Old', about: 'bio', cover_image: 'c', custom: 'kept' },
      '3speak': { spotlight: { headline: 'x' }, interests: ['music'] },
      otherApp: { a: 1 },
    }),
  }

  it('updates only the fields given, clears blanked ones, keeps everything else', async () => {
    vi.mocked(getAccounts).mockResolvedValue([account])
    vi.mocked(broadcastWithAioha).mockResolvedValue({ success: true })
    const profile = await saveProfileToHive('Alice', { name: '  New  ', about: '   ', notAllowed: 'x' })
    expect(profile).toEqual({ name: 'New', cover_image: 'c', custom: 'kept', version: 2 })
    const meta = savedMeta()
    expect(meta.profile).toEqual(profile)
    expect(meta.otherApp).toEqual({ a: 1 })
    expect(meta['3speak']).toEqual({ spotlight: { headline: 'x' }, interests: ['music'] })
    const [[ops, key]] = vi.mocked(broadcastWithAioha).mock.calls
    expect(key).toBe('posting')
    expect(ops[0][1]).toMatchObject({ account: 'alice', json_metadata: '', extensions: [] })
  })

  it('keeps an existing profile version', async () => {
    vi.mocked(getAccounts).mockResolvedValue([{ posting_json_metadata: '{"profile":{"version":3}}' }])
    vi.mocked(broadcastWithAioha).mockResolvedValue({ success: true })
    expect((await saveProfileToHive('a', {})).version).toBe(3)
  })

  it('writes interests in the same operation, normalised', async () => {
    vi.mocked(getAccounts).mockResolvedValue([account])
    vi.mocked(broadcastWithAioha).mockResolvedValue({ success: true })
    await saveProfileToHive('alice', { name: 'N' }, { interests: ['#Music', 'music', 'not-a-real-topic-xyz'] })
    expect(broadcastWithAioha).toHaveBeenCalledTimes(1)
    const meta = savedMeta()
    expect(meta['3speak'].interests).toEqual(['music'])
    expect(meta['3speak'].spotlight).toEqual({ headline: 'x' })
  })

  it('every editable field can be set', async () => {
    vi.mocked(getAccounts).mockResolvedValue([{ posting_json_metadata: '' }])
    vi.mocked(broadcastWithAioha).mockResolvedValue({ success: true })
    const fields = Object.fromEntries(EDITABLE_PROFILE_FIELDS.map((f) => [f, `v-${f}`]))
    const profile = await saveProfileToHive('a', fields)
    for (const f of EDITABLE_PROFILE_FIELDS) expect(profile[f]).toBe(`v-${f}`)
  })

  it('fails clearly without a user, an account, or a successful broadcast', async () => {
    await expect(saveProfileToHive('', {})).rejects.toThrow('Not logged in')
    vi.mocked(getAccounts).mockResolvedValueOnce([])
    await expect(saveProfileToHive('ghost', {})).rejects.toThrow('@ghost not found')
    vi.mocked(getAccounts).mockResolvedValueOnce([account])
    vi.mocked(broadcastWithAioha).mockResolvedValueOnce(null)
    await expect(saveProfileToHive('alice', {})).rejects.toThrow('Could not save your profile to Hive')
  })
})
