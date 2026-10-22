// Badges the user controls: the server-side creator record with a local cache,
// chain-verified authority, and current holders (src/utils/badgeAwards.js).
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'

const axios = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }))
vi.mock('axios', () => ({ default: axios }))
vi.mock('../../../src/utils/hiveNode', () => ({ getHiveUrl: () => 'https://node.test' }))

import {
  rememberCreatedBadge,
  rememberedBadges,
  canAwardBadge,
  listAwardableBadges,
  badgeHolders,
  indexNewCommunity,
} from '../../../src/utils/badgeAwards.js'

const rpcReply = (result) => ({ data: { result } })

beforeEach(() => {
  localStorage.clear()
  axios.post.mockReset()
  axios.get.mockReset()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('rememberCreatedBadge', () => {
  it('records the badge locally and on the checker', async () => {
    axios.post.mockResolvedValue({})
    await rememberCreatedBadge('alice', 'badge-one')
    await rememberCreatedBadge('alice', 'badge-one')
    await rememberCreatedBadge('alice', 'badge-two')
    expect(rememberedBadges('alice')).toEqual(['badge-one', 'badge-two'])
    expect(axios.post).toHaveBeenCalledWith('https://checker.3speak.tv/badges/created', { creator: 'alice', account: 'badge-one' })
  })

  it('keeps the local copy when the checker write fails', async () => {
    axios.post.mockRejectedValue(new Error('down'))
    await expect(rememberCreatedBadge('alice', 'badge-x')).resolves.toBeUndefined()
    expect(rememberedBadges('alice')).toEqual(['badge-x'])
  })

  it('does nothing without both names', async () => {
    await rememberCreatedBadge('', 'badge-x')
    await rememberCreatedBadge('alice', '')
    expect(axios.post).not.toHaveBeenCalled()
  })

  it('rememberedBadges survives corrupt storage', () => {
    localStorage.setItem('created_badges', '[1,2]')
    expect(rememberedBadges('alice')).toEqual([])
    localStorage.setItem('created_badges', 'nope')
    expect(rememberedBadges('alice')).toEqual([])
  })
})

describe('canAwardBadge', () => {
  it('is true only when the user is in the badge\'s posting account_auths', async () => {
    axios.post.mockResolvedValueOnce(rpcReply([{ posting: { account_auths: [['alice', 1]] } }]))
    expect(await canAwardBadge('alice', ' Badge-One ')).toBe(true)
    expect(axios.post.mock.calls[0][1]).toEqual({ jsonrpc: '2.0', method: 'condenser_api.get_accounts', params: [['badge-one']], id: 1 })

    axios.post.mockResolvedValueOnce(rpcReply([{ posting: { account_auths: [['mallory', 1]] } }]))
    expect(await canAwardBadge('alice', 'badge-one')).toBe(false)
  })

  it('is false for missing input, a missing account, an RPC error body or a network failure', async () => {
    expect(await canAwardBadge('', 'badge')).toBe(false)
    axios.post.mockResolvedValueOnce(rpcReply([]))
    expect(await canAwardBadge('alice', 'badge')).toBe(false)
    axios.post.mockResolvedValueOnce({ data: { error: { message: 'bad' } } })
    expect(await canAwardBadge('alice', 'badge')).toBe(false)
    axios.post.mockRejectedValueOnce(new Error('down'))
    expect(await canAwardBadge('alice', 'badge')).toBe(false)
  })
})

describe('listAwardableBadges', () => {
  it('uses the checker list when it answers', async () => {
    axios.get.mockResolvedValue({ data: { badges: [{ account: 'badge-a' }] } })
    expect(await listAwardableBadges('alice')).toEqual([{ account: 'badge-a' }])
    expect(axios.get).toHaveBeenCalledWith('https://checker.3speak.tv/badges/by-creator/alice')
    expect(axios.post).not.toHaveBeenCalled()
  })

  it('falls back to remembered badge- accounts, still verified on chain', async () => {
    localStorage.setItem('created_badges', JSON.stringify({ alice: ['badge-a', 'badge-b', 'not-a-badge'] }))
    axios.get.mockRejectedValue(new Error('down'))
    axios.post.mockResolvedValue(rpcReply([
      { name: 'badge-a', posting: { account_auths: [['alice', 1]] }, posting_json_metadata: '{"profile":{"name":"Star","profile_image":"https://i/x.png"}}' },
      { name: 'badge-b', posting: { account_auths: [['someoneelse', 1]] } },
    ]))
    expect(await listAwardableBadges('alice')).toEqual([{ account: 'badge-a', title: 'Star', image: 'https://i/x.png' }])
    expect(axios.post.mock.calls[0][1].params).toEqual([['badge-a', 'badge-b']])
  })

  it('titles a badge by its account name when its profile is unreadable', async () => {
    localStorage.setItem('created_badges', JSON.stringify({ alice: ['badge-a'] }))
    axios.get.mockResolvedValue({ data: {} })
    axios.post.mockResolvedValue(rpcReply([{ name: 'badge-a', posting: { account_auths: [['alice', 1]] }, posting_json_metadata: '{bad' }]))
    expect(await listAwardableBadges('alice')).toEqual([{ account: 'badge-a', title: 'badge-a', image: '' }])
  })

  it('is empty with no user, nothing remembered, or the chain down', async () => {
    expect(await listAwardableBadges('')).toEqual([])
    axios.get.mockRejectedValue(new Error('down'))
    expect(await listAwardableBadges('alice')).toEqual([])
    localStorage.setItem('created_badges', JSON.stringify({ alice: ['badge-a'] }))
    axios.post.mockRejectedValue(new Error('down'))
    expect(await listAwardableBadges('alice')).toEqual([])
  })
})

describe('badgeHolders', () => {
  it('is the set of accounts the badge follows', async () => {
    axios.post.mockResolvedValue(rpcReply([{ following: 'a' }, { following: 'b' }]))
    expect(await badgeHolders('badge-a')).toEqual(new Set(['a', 'b']))
    expect(axios.post.mock.calls[0][1].params).toEqual(['badge-a', '', 'blog', 1000])
  })

  it('is empty on failure', async () => {
    axios.post.mockRejectedValue(new Error('down'))
    expect(await badgeHolders('badge-a')).toEqual(new Set())
  })
})

describe('indexNewCommunity', () => {
  it('tells the checker, and never throws', async () => {
    axios.post.mockResolvedValueOnce({})
    await indexNewCommunity('hive-123')
    expect(axios.post).toHaveBeenCalledWith('https://checker.3speak.tv/community/created', { name: 'hive-123' })
    axios.post.mockRejectedValueOnce(new Error('down'))
    await expect(indexNewCommunity('hive-123')).resolves.toBeUndefined()
    await indexNewCommunity('')
    expect(axios.post).toHaveBeenCalledTimes(2)
  })
})
