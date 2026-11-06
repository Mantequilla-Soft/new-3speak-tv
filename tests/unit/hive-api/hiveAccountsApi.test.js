// Account and community helpers in src/hive-api/api.js: the account_create
// operation every creation route shares (posting authority for the creator ONLY,
// never a third-party app), creating a community or badge by wallet, by the Keychain
// extension without an app login, or with a pasted key, writing the new account's
// profile afterwards, name checks that never call a failed lookup "free", key
// derivation, and the read-only bridge lookups. The Hive client, the wallet helpers
// and Keychain are fakes; nothing is broadcast.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PrivateKey } from '@hiveio/dhive'

const client = vi.hoisted(() => ({
  call: null,
  database: { call: null, getAccounts: null, getDynamicGlobalProperties: null },
  broadcast: { sendOperations: null },
}))
const wallet = vi.hoisted(() => ({ broadcastWithAioha: null, isLoggedIn: null }))
const axiosPost = vi.hoisted(() => ({ fn: null }))

vi.mock('../../../src/utils/hiveNode', () => ({ getHiveClient: () => client, getHiveUrl: () => 'https://node.test' }))
vi.mock('../../../src/utils/config', () => ({ HIVE_API_URL: 'https://node.test', HIVE_API_NODES: ['https://node.test'] }))
vi.mock('../../../src/i18n', () => ({ t: (key) => key }))
vi.mock('axios', () => ({ default: { post: (...a) => axiosPost.fn(...a) } }))
vi.mock('../../../src/hive-api/aioha', () => ({
  broadcastWithAioha: (...a) => wallet.broadcastWithAioha(...a),
  isLoggedIn: () => wallet.isLoggedIn(),
  KeyTypes: { Posting: 'posting', Active: 'active', Memo: 'memo' },
}))

const api = await import('../../../src/hive-api/api.js')

// Real, deterministic Hive keys for a made-up account (dhive derives them locally).
const keys = api.getPrivateKeys('hive-123456', 'P5made-up-master-password')

const expectedCreateOp = (creator, name) => ['account_create', {
  creator,
  new_account_name: name,
  owner: { weight_threshold: 1, account_auths: [], key_auths: [[keys.ownerPubkey, 1]] },
  active: { weight_threshold: 1, account_auths: [], key_auths: [[keys.activePubkey, 1]] },
  posting: { weight_threshold: 1, account_auths: [[creator, 1]], key_auths: [[keys.postingPubkey, 1]] },
  memo_key: keys.memoPubkey,
  json_metadata: '',
  extensions: [],
  fee: '3.000 HIVE',
}]

// A Keychain extension that answers each request with `answers[method]`.
function keychain(answers = {}) {
  const kc = {
    requestBroadcast: vi.fn((user, ops, key, cb) => cb(answers.requestBroadcast)),
    requestAddAccount: vi.fn((user, k, cb) => cb(answers.requestAddAccount ?? { success: true })),
  }
  window.hive_keychain = kc
  return kc
}

beforeEach(() => {
  client.call = vi.fn()
  client.database.call = vi.fn()
  client.database.getAccounts = vi.fn()
  client.database.getDynamicGlobalProperties = vi.fn()
  client.broadcast.sendOperations = vi.fn(async () => ({ id: 'tx1' }))
  wallet.broadcastWithAioha = vi.fn(async () => ({ success: true, result: 'tx' }))
  wallet.isLoggedIn = vi.fn(() => true)
  axiosPost.fn = vi.fn()
  for (const m of ['log', 'error', 'warn']) vi.spyOn(console, m).mockImplementation(() => {})
})
afterEach(() => { delete window.hive_keychain })

describe('the account_create operation', () => {
  it('gives posting authority to the creator and nobody else, for the 3 HIVE fee', () => {
    expect(api.buildAccountCreateOp('alice', 'hive-123456', keys)).toEqual(expectedCreateOp('alice', 'hive-123456'))
  })

  it('never hands posting rights to a third-party app', () => {
    const [, op] = api.buildAccountCreateOp('alice', 'hive-123456', keys)
    expect(JSON.stringify(op)).not.toContain('ecency.app')
  })

  it('orders account_auths by name (Hive refuses them otherwise) without touching the input', () => {
    const auths = [['zed', 1], ['alice', 1], ['mike', 1]]
    expect(api.sortAuths(auths)).toEqual([['alice', 1], ['mike', 1], ['zed', 1]])
    expect(auths[0]).toEqual(['zed', 1])
    expect(api.sortAuths([['a', 1], ['a', 2]])).toEqual([['a', 1], ['a', 2]])
  })
})

describe('creating a community with the signed-in wallet', () => {
  it('broadcasts the shared operation with the ACTIVE key', async () => {
    keychain()
    await expect(api.createHiveCommunity('alice', 'hive-123456', keys)).resolves.toEqual({ success: true, result: 'tx' })
    expect(wallet.broadcastWithAioha).toHaveBeenCalledWith([expectedCreateOp('alice', 'hive-123456')], 'active')
  })

  it('then offers the new keys to Keychain', async () => {
    const kc = keychain()
    await api.createHiveCommunity('alice', 'hive-123456', keys)
    expect(kc.requestAddAccount).toHaveBeenCalledWith('hive-123456',
      { active: keys.active, posting: keys.posting, memo: keys.memo }, expect.any(Function))
  })

  it('still succeeds without Keychain (HiveAuth and friends)', async () => {
    await expect(api.createHiveCommunity('alice', 'hive-123456', keys)).resolves.toMatchObject({ success: true })
  })

  it('still succeeds when the user declines adding the keys to Keychain', async () => {
    keychain({ requestAddAccount: { success: false } })
    await expect(api.createHiveCommunity('alice', 'hive-123456', keys)).resolves.toMatchObject({ success: true })
  })

  it('asks a logged-out user to log in, broadcasting nothing', async () => {
    wallet.isLoggedIn.mockReturnValue(false)
    await expect(api.createHiveCommunity('alice', 'hive-123456', keys)).rejects.toThrow('misc.hiveApi.loginToCreateCommunity')
    expect(wallet.broadcastWithAioha).not.toHaveBeenCalled()
  })

  it('passes a broadcast failure on', async () => {
    wallet.broadcastWithAioha.mockRejectedValue(new Error('Insufficient funds'))
    await expect(api.createHiveCommunity('alice', 'hive-123456', keys)).rejects.toThrow('Insufficient funds')
  })
})

describe('creating a community through the Keychain extension, without logging in', () => {
  it('asks Keychain for ONE active signature on the shared operation', async () => {
    const kc = keychain({ requestBroadcast: { success: true, result: { id: 'kc-tx' } } })
    await expect(api.createHiveCommunityWithKeychain('alice', 'hive-123456', keys))
      .resolves.toEqual({ success: true, result: { id: 'kc-tx' } })
    expect(kc.requestBroadcast).toHaveBeenCalledWith('alice', [expectedCreateOp('alice', 'hive-123456')], 'Active', expect.any(Function))
    expect(kc.requestAddAccount).toHaveBeenCalledWith('hive-123456',
      { active: keys.active, posting: keys.posting, memo: keys.memo }, expect.any(Function))
    expect(wallet.broadcastWithAioha).not.toHaveBeenCalled()
  })

  it('a declined add-account does not undo a created account', async () => {
    keychain({ requestBroadcast: { success: true, result: 'r' }, requestAddAccount: { success: false } })
    await expect(api.createHiveCommunityWithKeychain('alice', 'hive-123456', keys)).resolves.toEqual({ success: true, result: 'r' })
  })

  it.each([
    ['with Keychain\'s reason', { success: false, message: 'Request was canceled by the user.' }, 'Request was canceled by the user.'],
    ['with a fallback when Keychain gives none', { success: false }, 'misc.hiveApi.keychainNotSigned'],
    ['when Keychain answers nothing', undefined, 'misc.hiveApi.keychainNotSigned'],
  ])('a refused signature fails %s', async (_, resp, message) => {
    keychain({ requestBroadcast: resp })
    await expect(api.createHiveCommunityWithKeychain('alice', 'hive-123456', keys)).rejects.toThrow(message)
  })

  it('fails clearly when Keychain is not installed', async () => {
    await expect(api.createHiveCommunityWithKeychain('alice', 'hive-123456', keys))
      .rejects.toThrow('Hive Keychain is not installed in this browser')
  })
})

describe('creating a community with a pasted active key', () => {
  it('signs the shared operation with that key', async () => {
    await expect(api.createHiveCommunityKY('alice', 'hive-123456', keys, keys.active)).resolves.toEqual({ id: 'tx1' })
    const [ops, key] = client.broadcast.sendOperations.mock.calls[0]
    expect(ops).toEqual([expectedCreateOp('alice', 'hive-123456')])
    expect(key.toString()).toBe(keys.active)
  })

  it('rejects a key that is not a key, broadcasting nothing', async () => {
    await expect(api.createHiveCommunityKY('alice', 'hive-123456', keys, 'not-a-key')).rejects.toThrow()
    expect(client.broadcast.sendOperations).not.toHaveBeenCalled()
  })

  it('passes a node refusal on', async () => {
    client.broadcast.sendOperations.mockRejectedValue(new Error('missing required active authority'))
    await expect(api.createHiveCommunityKY('alice', 'hive-123456', keys, keys.active)).rejects.toThrow('missing required active authority')
  })
})

describe('the community_create custom_json', () => {
  it('is an active-key custom_json naming the creator', async () => {
    await api.createHiveCommunityX('alice', 'hive-123456', { posting: 'STM1' })
    expect(wallet.broadcastWithAioha).toHaveBeenCalledWith([['custom_json', {
      required_auths: ['alice'],
      required_posting_auths: [],
      id: 'community_create',
      json: JSON.stringify({ creator: 'alice', name: 'hive-123456', keys: { posting: 'STM1' } }),
    }]], 'active')
  })

  it('needs a login', async () => {
    wallet.isLoggedIn.mockReturnValue(false)
    await expect(api.createHiveCommunityX('alice', 'hive-123456', {})).rejects.toThrow('misc.hiveApi.loginToCreateCommunity')
  })
})

describe('setting the new account up', () => {
  const profile = { name: 'Cooking Club', about: 'Recipes', profile_image: 'https://img.test/a.png' }

  it('writes the profile, and for a community its title and description, signed by the NEW account', async () => {
    await api.finalizeNewAccount('hive-123456', keys, { profile, community: { title: 'Cooking Club', about: 'Recipes' } })
    const [ops, key] = client.broadcast.sendOperations.mock.calls[0]
    expect(ops).toEqual([
      ['account_update2', {
        account: 'hive-123456', json_metadata: '', posting_json_metadata: JSON.stringify({ profile }), extensions: [],
      }],
      ['custom_json', {
        required_auths: [],
        required_posting_auths: ['hive-123456'],
        id: 'community',
        json: JSON.stringify(['updateProps', { community: 'hive-123456', props: { title: 'Cooking Club', about: 'Recipes' } }]),
      }],
    ])
    expect(key.toString()).toBe(keys.posting)
  })

  it('a badge only gets its profile', async () => {
    await api.finalizeNewAccount('badge-123456', keys, { profile })
    expect(client.broadcast.sendOperations.mock.calls[0][0].map(([type]) => type)).toEqual(['account_update2'])
  })
})

describe('new names', () => {
  it.each([[0, 'hive-100000'], [0.999999, 'hive-199999']])('a community name is hive- plus six digits (random %s)', (r, name) => {
    vi.spyOn(Math, 'random').mockReturnValue(r)
    expect(api.genCommuninityName()).toBe(name)
  })

  it.each([[0, 'badge-100000'], [0.999999, 'badge-999999']])('a badge name is badge- plus six digits (random %s)', (r, name) => {
    vi.spyOn(Math, 'random').mockReturnValue(r)
    expect(api.genBadgeName()).toBe(name)
  })
})

describe('is a name taken', () => {
  it('accountExists: an account is taken, none is free', async () => {
    client.database.getAccounts.mockResolvedValueOnce([{ name: 'bob' }]).mockResolvedValueOnce([])
    await expect(api.accountExists('bob')).resolves.toBe(true)
    await expect(api.accountExists('nobody')).resolves.toBe(false)
    expect(client.database.getAccounts).toHaveBeenCalledWith(['bob'])
  })

  it('accountExists calls a failed lookup "taken", so nobody spends 3 HIVE on a guess', async () => {
    client.database.getAccounts.mockRejectedValue(new Error('timeout'))
    await expect(api.accountExists('bob')).resolves.toBe(true)
  })

  it.each([
    ['an existing account', async () => [{ name: 'bob' }], 'taken'],
    ['no account', async () => [], 'free'],
    ['an answer that is not a list', async () => null, 'unknown'],
    ['a failed lookup', async () => { throw new Error('timeout') }, 'unknown'],
  ])('handleStateOnHive tells %s apart: %s', async (_, answer, state) => {
    client.database.getAccounts.mockImplementation(answer)
    await expect(api.handleStateOnHive('bob')).resolves.toBe(state)
  })

  it('handleStateOnHive looks the cleaned-up name up, and an empty name is unknown without asking', async () => {
    client.database.getAccounts.mockResolvedValue([])
    await api.handleStateOnHive('  Bob ')
    expect(client.database.getAccounts).toHaveBeenCalledWith(['bob'])
    await expect(api.handleStateOnHive('')).resolves.toBe('unknown')
    await expect(api.handleStateOnHive(null)).resolves.toBe('unknown')
    expect(client.database.getAccounts).toHaveBeenCalledTimes(1)
  })

  it('isAccountValid: true for an account, false for none or a failed lookup', async () => {
    client.database.getAccounts.mockResolvedValueOnce([{}]).mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('x'))
    expect(await api.isAccountValid('bob')).toBe(true)
    expect(await api.isAccountValid('bob')).toBe(false)
    expect(await api.isAccountValid('bob')).toBe(false)
  })
})

describe('keys and passwords', () => {
  it('derives all four role keys from the master password, each with its public key', () => {
    for (const role of ['owner', 'active', 'posting', 'memo']) {
      expect(keys[role]).toBe(PrivateKey.fromLogin('hive-123456', 'P5made-up-master-password', role).toString())
      expect(keys[`${role}Pubkey`]).toBe(PrivateKey.from(keys[role]).createPublic().toString())
      expect(keys[`${role}Pubkey`]).toMatch(/^STM/)
    }
    expect(new Set([keys.owner, keys.active, keys.posting, keys.memo]).size).toBe(4)
  })

  it('the same login always gives the same keys', () => {
    expect(api.getPrivateKeys('hive-123456', 'P5made-up-master-password')).toEqual(keys)
    expect(api.getPrivateKeys('hive-654321', 'P5made-up-master-password').posting).not.toBe(keys.posting)
  })

  it('writes bytes as two-digit hex', () => {
    expect(api.arrayToHex(new Uint8Array([0, 15, 16, 255]))).toBe('000f10ff')
    expect(api.arrayToHex([256, -1])).toBe('00ff')
  })

  it('a generated password is P plus a key seeded from the browser\'s random bytes', async () => {
    const getRandomValues = vi.fn((arr) => arr.fill(7))
    vi.stubGlobal('crypto', { getRandomValues })
    const pw = await api.generatePassword(32)
    expect(getRandomValues).toHaveBeenCalledWith(expect.any(Uint8Array))
    expect(getRandomValues.mock.calls[0][0]).toHaveLength(32)
    expect(pw).toBe(`P${PrivateKey.fromSeed('07'.repeat(32)).toString()}`)
  })

  it('refuses to make a password without a secure random source', async () => {
    vi.stubGlobal('crypto', undefined)
    await expect(api.generatePassword(32)).rejects.toThrow('crypto.getRandomValues is not supported')
  })
})

describe('the old keychainBroadcast helper', () => {
  it.each([['Active', 'active'], ['Posting', 'posting'], ['Memo', 'memo'], ['Owner', 'active'], [undefined, 'active']])(
    'maps the %s key to %s and broadcasts through the wallet helpers',
    async (key, keyType) => {
      const ops = [['vote', {}]]
      await api.keychainBroadcast('alice', ops, key)
      expect(wallet.broadcastWithAioha).toHaveBeenCalledWith(ops, keyType)
    },
  )

  it('needs a login', async () => {
    wallet.isLoggedIn.mockReturnValue(false)
    await expect(api.keychainBroadcast('alice', [], 'Active')).rejects.toThrow('misc.hiveApi.loginFirst')
    expect(wallet.broadcastWithAioha).not.toHaveBeenCalled()
  })
})

describe('adding keys to Keychain', () => {
  it('resolves with Keychain\'s answer', async () => {
    keychain({ requestAddAccount: { success: true, message: 'added' } })
    await expect(api.addAccountTokeychain('hive-1', { posting: 'k' })).resolves.toEqual({ success: true, message: 'added' })
  })

  it('a declined request is "cancelled"', async () => {
    keychain({ requestAddAccount: { success: false } })
    await expect(api.addAccountTokeychain('hive-1', {})).rejects.toEqual({ message: 'misc.hiveApi.cancelled' })
  })

  it('without Keychain, says so', async () => {
    await expect(api.addAccountTokeychain('hive-1', {})).rejects.toEqual({ message: 'Hive Keychain not available' })
  })
})

describe('reading from Hive', () => {
  it('a bridge call is a JSON-RPC request to the session node', async () => {
    axiosPost.fn.mockResolvedValue({ data: { result: { name: 'bob' } } })
    await expect(api.getHiveUserProfile('bob')).resolves.toEqual({ name: 'bob' })
    expect(axiosPost.fn).toHaveBeenCalledWith('https://node.test', {
      jsonrpc: '2.0', id: 1, method: 'bridge.get_profile', params: { account: 'bob' },
    })
  })

  it('hiveBridgeCall sends empty params by default', async () => {
    axiosPost.fn.mockResolvedValue({ data: { result: [] } })
    await api.hiveBridgeCall('list_pop_communities')
    expect(axiosPost.fn.mock.calls[0][1].params).toEqual({})
  })

  it('getCommunity asks the bridge for the community, as the observer', async () => {
    client.call.mockResolvedValue({ name: 'hive-1', title: 'Cooks' })
    await expect(api.getCommunity('hive-1', 'alice')).resolves.toEqual({ name: 'hive-1', title: 'Cooks' })
    expect(client.call).toHaveBeenCalledWith('bridge', 'get_community', { name: 'hive-1', observer: 'alice' })
  })

  it('getRelationshipBetweenAccounts asks follower first, then following', async () => {
    client.call.mockResolvedValue({ follows: true })
    await expect(api.getRelationshipBetweenAccounts('alice', 'bob')).resolves.toEqual({ follows: true })
    expect(client.call).toHaveBeenCalledWith('bridge', 'get_relationship_between_accounts', ['alice', 'bob'])
  })

  it('getFollowers returns the follow counts', async () => {
    client.database.call.mockResolvedValue({ follower_count: 5, following_count: 2 })
    await expect(api.getFollowers('bob')).resolves.toEqual({ follower_count: 5, following_count: 2 })
    expect(client.database.call).toHaveBeenCalledWith('get_follow_count', ['bob'])
  })

  it.each([
    ['getCommunity', () => client.call, () => api.getCommunity('hive-1')],
    ['getRelationshipBetweenAccounts', () => client.call, () => api.getRelationshipBetweenAccounts('a', 'b')],
    ['getFollowers', () => client.database.call, () => api.getFollowers('bob')],
  ])('%s answers null when the node fails', async (_, fn, run) => {
    fn().mockRejectedValue(new Error('timeout'))
    await expect(run()).resolves.toBeNull()
  })

  it('fetchBalances converts vests to Hive Power at the current rate', async () => {
    client.database.getAccounts.mockResolvedValue([{
      vesting_shares: '200.000000 VESTS', hbd_balance: '1.250 HBD', balance: '3.500 HIVE', savings_hbd_balance: '10.000 HBD',
    }])
    client.database.getDynamicGlobalProperties.mockResolvedValue({
      total_vesting_shares: '2000.000000 VESTS', total_vesting_fund_hive: '1000.000 HIVE',
    })
    await expect(api.fetchBalances('bob')).resolves.toEqual({ hp: 100, hbd: 1.25, hive: 3.5, savings_hbd: 10 })
  })

  it('fetchBalances answers nothing when the lookup fails', async () => {
    client.database.getAccounts.mockRejectedValue(new Error('timeout'))
    await expect(api.fetchBalances('bob')).resolves.toBeUndefined()
  })
})
