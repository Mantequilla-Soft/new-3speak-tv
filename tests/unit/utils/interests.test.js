// Viewer interests stored in Hive posting_json_metadata (src/utils/interests.js).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const hive = vi.hoisted(() => ({ getAccounts: vi.fn(), broadcastWithAioha: vi.fn() }))
vi.mock('../../../src/hive-api/hiveApi', () => ({ getAccounts: hive.getAccounts }))
vi.mock('../../../src/hive-api/aioha', () => ({ broadcastWithAioha: hive.broadcastWithAioha, KeyTypes: { Posting: 'posting' } }))
vi.mock('../../../src/i18n', () => ({ t: (k) => `T(${k})` }))
vi.mock('../../../src/utils/config', () => ({ CHECKER_URL: 'https://checker.test' }))
vi.mock('axios', () => ({ default: { get: vi.fn() } }))

const m = await import('../../../src/utils/interests.js')

beforeEach(() => {
  hive.getAccounts.mockReset()
  hive.broadcastWithAioha.mockReset()
})

describe('normalizeInterestList', () => {
  it('keeps v2 topics and categories and the old v1 ids', () => {
    expect(m.normalizeInterestList(['programming', 'tech-science', 'news', 'vlog'])).toEqual(['programming', 'tech-science', 'news', 'vlog'])
  })

  it('moves the retired tutorial tag to education', () => {
    expect(m.normalizeInterestList(['tutorial'])).toEqual(['education'])
    expect(m.normalizeInterestList(['tutorial', 'education'])).toEqual(['education'])
  })

  it('cleans case, # and spaces, drops unknowns and repeats', () => {
    expect(m.normalizeInterestList([' #Music ', 'MUSIC', 'made-up', '', null, 42, 'film-tv'])).toEqual(['music', 'film-tv'])
    expect(m.normalizeInterestList(undefined)).toEqual([])
  })
})

describe('displayTag', () => {
  it('uses the curated name, then the v2 label, then the raw tag', () => {
    expect(m.displayTag('Cryptocurrency')).toBe('T(tags.display.cryptocurrency)')
    expect(m.displayTag('story-time')).toBe('T(tags.labels.story-time)')
    expect(m.displayTag('SomethingElse')).toBe('somethingelse')
    expect(m.displayTag(null)).toBe('')
  })
})

describe('readInterestsFromAccount', () => {
  const acct = (meta) => ({ posting_json_metadata: typeof meta === 'string' ? meta : JSON.stringify(meta) })

  it('reads the 3speak namespace and normalises it', () => {
    expect(m.readInterestsFromAccount(acct({ profile: {}, '3speak': { interests: ['programming', 'tutorial', 'bogus'] } })))
      .toEqual(['programming', 'education'])
  })

  it('returns [] for missing, malformed or odd metadata', () => {
    expect(m.readInterestsFromAccount(null)).toEqual([])
    expect(m.readInterestsFromAccount(acct('{broken'))).toEqual([])
    expect(m.readInterestsFromAccount(acct(''))).toEqual([])
    expect(m.readInterestsFromAccount(acct('null'))).toEqual([])
    expect(m.readInterestsFromAccount(acct({ '3speak': { interests: 'music' } }))).toEqual([])
    expect(m.readInterestsFromAccount({ posting_json_metadata: { '3speak': { interests: ['music'] } } })).toEqual(['music'])
  })
})

describe('fetchUserInterests', () => {
  it('fetches the account by its cleaned name', async () => {
    hive.getAccounts.mockResolvedValue([{ posting_json_metadata: JSON.stringify({ '3speak': { interests: ['news'] } }) }])
    expect(await m.fetchUserInterests(' @Alice ')).toEqual(['news'])
    expect(hive.getAccounts).toHaveBeenCalledWith(['alice'])
  })

  it('returns null when the account cannot be read, so callers can tell it from no interests', async () => {
    hive.getAccounts.mockResolvedValue([])
    expect(await m.fetchUserInterests('alice')).toBeNull()
    hive.getAccounts.mockRejectedValue(new Error('rpc down'))
    expect(await m.fetchUserInterests('alice')).toBeNull()
    expect(await m.fetchUserInterests('')).toBeNull()
  })
})

describe('saveInterestsToHive', () => {
  it('merges into the existing metadata and broadcasts account_update2 with posting auth', async () => {
    hive.getAccounts.mockResolvedValue([{ posting_json_metadata: JSON.stringify({ profile: { name: 'Alice' }, '3speak': { theme: 'dark', interests: ['art'] } }) }])
    hive.broadcastWithAioha.mockResolvedValue({ success: true })
    expect(await m.saveInterestsToHive('@alice', ['Programming', 'tutorial', 'junk'])).toEqual(['programming', 'education'])
    const [[ops, key]] = hive.broadcastWithAioha.mock.calls
    expect(key).toBe('posting')
    expect(ops).toHaveLength(1)
    const [name, op] = ops[0]
    expect(name).toBe('account_update2')
    expect(op.account).toBe('alice')
    expect(op.json_metadata).toBe('')
    expect(JSON.parse(op.posting_json_metadata)).toEqual({
      profile: { name: 'Alice' }, '3speak': { theme: 'dark', interests: ['programming', 'education'] },
    })
  })

  it('throws when not logged in or when the broadcast fails', async () => {
    await expect(m.saveInterestsToHive('', ['news'])).rejects.toThrow('Not logged in')
    hive.getAccounts.mockResolvedValue([{}])
    hive.broadcastWithAioha.mockResolvedValue({ success: false })
    await expect(m.saveInterestsToHive('alice', ['news'])).rejects.toThrow('Could not save interests')
    hive.broadcastWithAioha.mockResolvedValue(null)
    await expect(m.saveInterestsToHive('alice', ['news'])).rejects.toThrow('Could not save interests')
  })
})
