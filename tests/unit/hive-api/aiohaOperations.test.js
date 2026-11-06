// What the Hive helpers in src/hive-api/aioha.js hand to a signer: votes (with and
// without a viewer tag), tags, transfers, follows, badge awards, reblogs,
// custom_json, comments and raw broadcasts. Each one picks a route by who is signed
// in: a warm-up (incubating) user goes to the off-chain store, a Butter Auth session
// to /api/broadcast, a wallet login to the @threespeak proxy (falling back to the
// wallet itself when @threespeak was never granted), and the wallet signs the rest.
// The tests read back the exact operations each route was given. Nothing is signed
// or broadcast for real: the wallet and the API are fakes.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  wallet, resetWallet, signedInAs, fakeApi, ok, fail, requestsTo, Providers,
} from './helpers/fakeAioha.js'

vi.mock('@aioha/aioha', async () => (await import('./helpers/fakeAioha.js')).aiohaModule)
vi.mock('../../../src/utils/config.js', () => ({ ENABLE_METAMASK_SNAP: false, EMBED_API_KEY: 'test-app-key' }))
vi.mock('../../../src/utils/vscContract.js', () => ({ IS_VSC_TESTNET: false, VSC_NET_ID: 'vsc-mainnet' }))
vi.mock('../../../src/utils/hiveNode.js', () => ({
  getHiveUrl: () => 'https://node.test',
  ensureHealthyNode: () => new Promise(() => {}),
}))
const incubation = vi.hoisted(() => ({
  voteIncubation: null, followIncubation: null, saveIncubationProfile: null,
  playlistIncubation: null, postIncubationContent: null,
}))
vi.mock('../../../src/lib/incubation', () => incubation)

const aioha = await import('../../../src/hive-api/aioha.js')
const {
  voteWithAioha, tagVideoWithAioha, transferWithAioha, followWithAioha, awardBadgeWithAioha,
  reblogWithAioha, customJsonWithAioha, commentWithAioha, broadcastWithAioha, signMessageWithAioha,
  broadcastViaManteAuth, isManteAuthLogin, isLoggedIn, getCurrentUser, getOperationUser,
  getCurrentProvider, isHiveAuthProvider, setHiveAuthCallbacks, setActiveAuthHandler,
  withHiveAuthWaiting, VIEWER_TAG_CJ_ID, KeyTypes,
} = aioha

const BROADCAST = '/api/broadcast'
const signed = { success: true, result: { id: 'wallet-tx' } }

// The three kinds of signed-in viewer, plus the warm-up user with no Hive account.
const asButrAuth = (user = 'alice') => {
  localStorage.setItem('manteauth_login', 'true')
  localStorage.setItem('user_id', user)
}
const asIncubating = (handle = 'newbie') => localStorage.setItem('incubation_handle', handle)
const asKeychain = (user = 'alice') => signedInAs(Providers.Keychain, user)

// What reached /api/broadcast, as the list of operations.
const broadcastOps = (fetchMock) => requestsTo(fetchMock, BROADCAST).map((r) => r.body.operations)

beforeEach(() => {
  localStorage.clear()
  resetWallet()
  for (const k of Object.keys(incubation)) incubation[k] = vi.fn(async () => ({ permlink: 'stored-permlink' }))
  setHiveAuthCallbacks(null, null)
  setActiveAuthHandler(null)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => { localStorage.clear() })

describe('voting', () => {
  it('a wallet with no @threespeak route signs the vote itself', async () => {
    wallet.vote.mockResolvedValue(signed)
    await expect(voteWithAioha('bob', 'my-video', 5000)).resolves.toEqual({ success: true, result: { id: 'wallet-tx' } })
    expect(wallet.vote).toHaveBeenCalledWith('bob', 'my-video', 5000)
    expect(wallet.signAndBroadcastTx).not.toHaveBeenCalled()
  })

  it('a full upvote is the default weight', async () => {
    wallet.vote.mockResolvedValue(signed)
    await voteWithAioha('bob', 'my-video')
    expect(wallet.vote).toHaveBeenCalledWith('bob', 'my-video', 10000)
  })

  it('a viewer tag goes in the SAME transaction as the vote, lower-cased and trimmed', async () => {
    signedInAs(null, 'alice')
    wallet.signAndBroadcastTx.mockResolvedValue(signed)
    await voteWithAioha('bob', 'my-video', 7500, '  Cooking ')
    expect(wallet.vote).not.toHaveBeenCalled()
    expect(wallet.signAndBroadcastTx).toHaveBeenCalledWith([
      ['vote', { voter: 'alice', author: 'bob', permlink: 'my-video', weight: 7500 }],
      ['custom_json', {
        required_auths: [],
        required_posting_auths: ['alice'],
        id: '3speak-viewer-tag',
        json: JSON.stringify({ app: 'threespeak', author: 'bob', permlink: 'my-video', tag: 'cooking', weight: 7500 }),
      }],
    ], KeyTypes.Posting)
    expect(VIEWER_TAG_CJ_ID).toBe('3speak-viewer-tag')
  })

  it('a downvote keeps its negative weight, but the tag records how strong it was', async () => {
    asButrAuth('alice')
    const api = fakeApi({ [BROADCAST]: ok() })
    await voteWithAioha('bob', 'my-video', -5000, 'spam')
    const [ops] = broadcastOps(api)
    expect(ops[0]).toEqual(['vote', { voter: 'alice', author: 'bob', permlink: 'my-video', weight: -5000 }])
    expect(JSON.parse(ops[1][1].json)).toMatchObject({ tag: 'spam', weight: 5000 })
  })

  it('a Butter Auth session sends the vote to /api/broadcast with its cookie, as the account in user_id', async () => {
    asButrAuth('alice')
    const api = fakeApi({ [BROADCAST]: ok({ success: true, result: { id: 'srv-tx' } }) })
    await expect(voteWithAioha('bob', 'my-video', 10000)).resolves.toEqual({ success: true, result: { id: 'srv-tx' } })
    const [req] = requestsTo(api, BROADCAST)
    expect(req).toMatchObject({ method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } })
    expect(req.body).toEqual({ operations: [['vote', { voter: 'alice', author: 'bob', permlink: 'my-video', weight: 10000 }]] })
    expect(wallet.vote).not.toHaveBeenCalled()
  })

  it('a wallet login goes through the @threespeak proxy, naming the user, with no wallet prompt', async () => {
    asKeychain('alice')
    const api = fakeApi({ [BROADCAST]: ok() })
    await voteWithAioha('bob', 'my-video', 10000)
    const [req] = requestsTo(api, BROADCAST)
    expect(req.headers).toEqual({ 'Content-Type': 'application/json', 'X-API-Key': 'test-app-key' })
    expect(req.body).toEqual({
      operations: [['vote', { voter: 'alice', author: 'bob', permlink: 'my-video', weight: 10000 }]],
      username: 'alice',
    })
    expect(wallet.vote).not.toHaveBeenCalled()
  })

  it('when @threespeak was never granted posting authority, the wallet signs it instead', async () => {
    asKeychain('alice')
    fakeApi({ [BROADCAST]: fail(403, { error: 'Authorization required' }) })
    wallet.vote.mockResolvedValue(signed)
    await expect(voteWithAioha('bob', 'my-video', 10000)).resolves.toMatchObject({ success: true })
    expect(wallet.vote).toHaveBeenCalledWith('bob', 'my-video', 10000)
  })

  it('any other proxy refusal is the answer: nothing is signed behind it', async () => {
    asKeychain('alice')
    fakeApi({ [BROADCAST]: fail(500, { error: 'Node unavailable' }) })
    await expect(voteWithAioha('bob', 'my-video')).rejects.toThrow('Node unavailable')
    expect(wallet.vote).not.toHaveBeenCalled()
  })

  it('a warm-up user votes off-chain and the viewer tag is dropped', async () => {
    asIncubating()
    const api = fakeApi({})
    await expect(voteWithAioha('bob', 'my-video', 10000, 'cooking')).resolves.toEqual({ success: true, incubation: true })
    expect(incubation.voteIncubation).toHaveBeenCalledWith('bob', 'my-video', 10000)
    expect(api).not.toHaveBeenCalled()
    expect(wallet.vote).not.toHaveBeenCalled()
    expect(wallet.signAndBroadcastTx).not.toHaveBeenCalled()
  })

  it.each([
    ['a plain string', { success: false, error: 'RC exhausted' }, 'RC exhausted'],
    ['an error object', { success: false, error: { message: 'Missing posting authority' } }, 'Missing posting authority'],
    ['a nested node error', { success: false, error: { code: -32000, data: { stack: [] } } }, '{"code":-32000,"data":{"stack":[]}}'],
    ['a top-level message', { success: false, message: 'User rejected' }, 'User rejected'],
    ['nothing at all', { success: false }, 'Vote failed (no error returned by aioha)'],
  ])('a wallet refusal with %s says why', async (_, result, message) => {
    wallet.vote.mockResolvedValue(result)
    await expect(voteWithAioha('bob', 'my-video')).rejects.toThrow(message)
  })

  it('a wallet that throws passes the error on', async () => {
    wallet.vote.mockRejectedValue(new Error('Keychain locked'))
    await expect(voteWithAioha('bob', 'my-video')).rejects.toThrow('Keychain locked')
  })
})

describe('the HiveAuth approval prompt', () => {
  it('opens while a HiveAuth user approves on their phone, and closes after', async () => {
    signedInAs(Providers.HiveAuth, 'alice')
    fakeApi({ [BROADCAST]: fail(403, { error: 'Authorization required' }) })
    const onWaiting = vi.fn()
    const onComplete = vi.fn()
    setHiveAuthCallbacks(onWaiting, onComplete)
    wallet.vote.mockImplementation(async () => {
      expect(onWaiting).toHaveBeenCalledWith('Approve vote on HiveAuth...')
      expect(onComplete).not.toHaveBeenCalled()
      return signed
    })
    await voteWithAioha('bob', 'my-video')
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('closes even when the approval fails', async () => {
    signedInAs(Providers.HiveAuth, 'alice')
    const onComplete = vi.fn()
    setHiveAuthCallbacks(vi.fn(), onComplete)
    await expect(withHiveAuthWaiting(async () => { throw new Error('denied') })).rejects.toThrow('denied')
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('never shows for other wallets', async () => {
    asKeychain()
    const onWaiting = vi.fn()
    const onComplete = vi.fn()
    setHiveAuthCallbacks(onWaiting, onComplete)
    await expect(withHiveAuthWaiting(async () => 42)).resolves.toBe(42)
    expect(onWaiting).not.toHaveBeenCalled()
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('knows when the provider is HiveAuth', () => {
    signedInAs(Providers.HiveAuth, 'alice')
    expect(isHiveAuthProvider()).toBe(true)
    asKeychain()
    expect(isHiveAuthProvider()).toBe(false)
  })
})

describe('tagging a video without voting', () => {
  const tagOp = (voter, tag = 'travel', weight = 10000) => ['custom_json', {
    required_auths: [],
    required_posting_auths: [voter],
    id: '3speak-viewer-tag',
    json: JSON.stringify({ app: 'threespeak', author: 'bob', permlink: 'my-video', tag, weight }),
  }]

  it('refuses an empty tag', async () => {
    await expect(tagVideoWithAioha('bob', 'my-video', '   ')).rejects.toThrow('No tag provided')
  })

  it('a Butter Auth session broadcasts only the tag custom_json', async () => {
    asButrAuth('alice')
    const api = fakeApi({ [BROADCAST]: ok() })
    await tagVideoWithAioha('bob', 'my-video', 'Travel')
    expect(broadcastOps(api)).toEqual([[tagOp('alice')]])
  })

  it('a wallet login uses the proxy', async () => {
    asKeychain('alice')
    const api = fakeApi({ [BROADCAST]: ok() })
    await tagVideoWithAioha('bob', 'my-video', 'travel', 5000)
    expect(broadcastOps(api)).toEqual([[tagOp('alice', 'travel', 5000)]])
  })

  it('without the grant, the wallet signs the tag with the posting key', async () => {
    asKeychain('alice')
    fakeApi({ [BROADCAST]: fail(403, { error: 'Authorization required' }) })
    wallet.signAndBroadcastTx.mockResolvedValue(signed)
    await tagVideoWithAioha('bob', 'my-video', 'travel')
    expect(wallet.signAndBroadcastTx).toHaveBeenCalledWith([tagOp('alice')], KeyTypes.Posting)
  })

  it('a proxy failure other than the grant is passed on', async () => {
    asKeychain('alice')
    fakeApi({ [BROADCAST]: fail(500, { message: 'down' }) })
    await expect(tagVideoWithAioha('bob', 'my-video', 'travel')).rejects.toThrow('down')
  })

  it('a refused signature says why', async () => {
    wallet.signAndBroadcastTx.mockResolvedValue({ success: false, error: 'cancelled' })
    await expect(tagVideoWithAioha('bob', 'my-video', 'travel')).rejects.toThrow('cancelled')
  })
})

describe('transfers', () => {
  it('a Butter Auth session hands the transfer to the active-key dialog, amount to three decimals', async () => {
    asButrAuth('alice')
    const handler = vi.fn(async () => ({ success: true, result: 'via-wallet' }))
    setActiveAuthHandler(handler)
    const api = fakeApi({})
    await expect(transferWithAioha('bob', 1.5, 'HBD')).resolves.toEqual({ success: true, result: 'via-wallet' })
    expect(handler).toHaveBeenCalledWith([['transfer', { from: 'alice', to: 'bob', amount: '1.500 HBD', memo: '' }]])
    expect(api).not.toHaveBeenCalled()
  })

  it('keeps the memo', async () => {
    asButrAuth('alice')
    const handler = vi.fn(async () => ({ success: true }))
    setActiveAuthHandler(handler)
    await transferWithAioha('bob', '2', 'HIVE', 'thanks!')
    expect(handler.mock.calls[0][0][0][1]).toEqual({ from: 'alice', to: 'bob', amount: '2.000 HIVE', memo: 'thanks!' })
  })

  it('with no dialog registered, the Butter Auth user is told to reload', async () => {
    asButrAuth('alice')
    await expect(transferWithAioha('bob', 1, 'HIVE')).rejects.toThrow('Active key operations need a Hive wallet')
  })

  it('a user cancelling the dialog cancels the transfer', async () => {
    asButrAuth('alice')
    setActiveAuthHandler(async () => { throw new Error('Cancelled') })
    await expect(transferWithAioha('bob', 1, 'HIVE')).rejects.toThrow('Cancelled')
  })

  it('a wallet signs it itself, never through @threespeak (posting authority cannot move funds)', async () => {
    asKeychain('alice')
    const api = fakeApi({})
    wallet.transfer.mockResolvedValue(signed)
    await expect(transferWithAioha('bob', 3, 'HIVE', 'memo')).resolves.toEqual({ success: true, result: { id: 'wallet-tx' } })
    expect(wallet.transfer).toHaveBeenCalledWith('bob', 3, 'HIVE', 'memo')
    expect(api).not.toHaveBeenCalled()
  })

  it('a refused transfer says why', async () => {
    wallet.transfer.mockResolvedValue({ success: false, error: 'Insufficient funds' })
    await expect(transferWithAioha('bob', 3, 'HIVE')).rejects.toThrow('Insufficient funds')
  })
})

describe('follows', () => {
  const followOp = (follower, what) => ['custom_json', {
    required_auths: [],
    required_posting_auths: [follower],
    id: 'follow',
    json: JSON.stringify(['follow', { follower, following: 'bob', what }]),
  }]

  it.each([[true, 'following'], [false, 'unfollowed']])('a warm-up user follow=%s is stored off-chain as %s', async (follow, state) => {
    asIncubating()
    await expect(followWithAioha('bob', follow)).resolves.toEqual({ success: true, incubation: true })
    expect(incubation.followIncubation).toHaveBeenCalledWith('bob', state)
  })

  it.each([[true, ['blog']], [false, []]])('a Butter Auth follow=%s broadcasts what: %j', async (follow, what) => {
    asButrAuth('alice')
    const api = fakeApi({ [BROADCAST]: ok() })
    await followWithAioha('bob', follow)
    expect(broadcastOps(api)).toEqual([[followOp('alice', what)]])
  })

  it('a wallet login follows through the proxy', async () => {
    asKeychain('alice')
    const api = fakeApi({ [BROADCAST]: ok() })
    await followWithAioha('bob')
    expect(broadcastOps(api)).toEqual([[followOp('alice', ['blog'])]])
  })

  it('without the grant, the wallet follows with its own follow call', async () => {
    asKeychain('alice')
    fakeApi({ [BROADCAST]: fail(403, { error: 'Authorization required' }) })
    wallet.follow.mockResolvedValue(signed)
    await followWithAioha('bob', true)
    expect(wallet.follow).toHaveBeenCalledWith('bob')
  })

  it('and unfollows with a custom_json, since the wallet has no unfollow', async () => {
    signedInAs(null, 'alice')
    wallet.customJSON.mockResolvedValue(signed)
    await followWithAioha('bob', false)
    expect(wallet.customJSON).toHaveBeenCalledWith(
      KeyTypes.Posting, 'follow',
      JSON.stringify(['follow', { follower: 'alice', following: 'bob', what: [] }]),
      'Unfollow @bob',
    )
  })

  it('a proxy failure other than the grant is passed on', async () => {
    asKeychain('alice')
    fakeApi({ [BROADCAST]: fail(500, { error: 'boom' }) })
    await expect(followWithAioha('bob')).rejects.toThrow('boom')
    expect(wallet.follow).not.toHaveBeenCalled()
  })

  it('a refused follow says why', async () => {
    wallet.follow.mockResolvedValue({ success: false, error: 'nope' })
    await expect(followWithAioha('bob')).rejects.toThrow('nope')
  })
})

describe('badge awards', () => {
  const badgeOp = (what) => [['custom_json', {
    required_auths: [],
    required_posting_auths: ['badge-123456'],
    id: 'follow',
    json: JSON.stringify(['follow', { follower: 'badge-123456', following: 'bob', what }]),
  }]]

  it('the BADGE follows the person, authorised by the badge account, not the signer', async () => {
    asButrAuth('alice')
    const api = fakeApi({ [BROADCAST]: ok() })
    await awardBadgeWithAioha('badge-123456', 'bob')
    expect(broadcastOps(api)).toEqual([badgeOp(['blog'])])
  })

  it('withdrawing it is the same op with nothing in what', async () => {
    asKeychain('alice')
    const api = fakeApi({ [BROADCAST]: ok() })
    await awardBadgeWithAioha('badge-123456', 'bob', false)
    expect(broadcastOps(api)).toEqual([badgeOp([])])
  })

  it('without the grant, the wallet signs it with the posting key', async () => {
    asKeychain('alice')
    fakeApi({ [BROADCAST]: fail(403, { error: 'Authorization required' }) })
    wallet.signAndBroadcastTx.mockResolvedValue(signed)
    await awardBadgeWithAioha('badge-123456', 'bob')
    expect(wallet.signAndBroadcastTx).toHaveBeenCalledWith(badgeOp(['blog']), KeyTypes.Posting)
  })

  it('a proxy failure other than the grant is passed on', async () => {
    asKeychain('alice')
    fakeApi({ [BROADCAST]: fail(403, { error: 'You do not hold posting authority over @badge-123456' }) })
    await expect(awardBadgeWithAioha('badge-123456', 'bob')).rejects.toThrow('posting authority over @badge-123456')
  })

  it('a warm-up user cannot award one, and nothing is stored off-chain', async () => {
    asIncubating()
    await expect(awardBadgeWithAioha('badge-123456', 'bob')).rejects.toThrow('Badges are awarded from a Hive account')
    expect(incubation.followIncubation).not.toHaveBeenCalled()
  })
})

describe('reblogs', () => {
  it('a Butter Auth reblog is the follow custom_json with a reblog action, as the session account', async () => {
    asButrAuth('alice')
    const api = fakeApi({ [BROADCAST]: ok() })
    await reblogWithAioha('bob', 'my-video')
    expect(broadcastOps(api)).toEqual([[['custom_json', {
      required_auths: [],
      required_posting_auths: ['alice'],
      id: 'follow',
      json: JSON.stringify(['reblog', { account: 'alice', author: 'bob', permlink: 'my-video' }]),
    }]]])
  })

  it('a wallet with no proxy signs it with a readable title', async () => {
    signedInAs(null, 'alice')
    wallet.customJSON.mockResolvedValue(signed)
    await reblogWithAioha('bob', 'my-video')
    expect(wallet.customJSON).toHaveBeenCalledWith(
      KeyTypes.Posting, 'follow',
      JSON.stringify(['reblog', { account: 'alice', author: 'bob', permlink: 'my-video' }]),
      'Reblog @bob/my-video',
    )
  })

  it('a warm-up user is refused before anything is sent (it would read as a follow off-chain)', async () => {
    asIncubating()
    const api = fakeApi({})
    await expect(reblogWithAioha('bob', 'my-video')).rejects.toThrow('Reblogging needs a Hive account')
    expect(api).not.toHaveBeenCalled()
    expect(incubation.followIncubation).not.toHaveBeenCalled()
  })
})

describe('custom_json', () => {
  it('a warm-up follow custom_json is stored off-chain as a follow', async () => {
    asIncubating()
    const json = JSON.stringify(['follow', { follower: 'newbie', following: 'bob', what: ['blog'] }])
    await expect(customJsonWithAioha(KeyTypes.Posting, 'follow', json)).resolves.toEqual({ success: true, incubation: true })
    expect(incubation.followIncubation).toHaveBeenCalledWith('bob', 'following')
  })

  it('a warm-up follow without the array wrapper is read the same way', async () => {
    asIncubating()
    await customJsonWithAioha(KeyTypes.Posting, 'follow', JSON.stringify({ following: 'bob', what: [] }))
    expect(incubation.followIncubation).toHaveBeenCalledWith('bob', 'unfollowed')
  })

  it('a warm-up playlist op goes to the playlist store with the op name and payload', async () => {
    asIncubating()
    incubation.playlistIncubation = vi.fn(async () => ({ id: 'pl1' }))
    const res = await customJsonWithAioha(KeyTypes.Posting, '3speak_playlist_create', JSON.stringify({ name: 'Faves' }))
    expect(incubation.playlistIncubation).toHaveBeenCalledWith('create', { name: 'Faves' })
    expect(res).toEqual({ success: true, incubation: true, result: { id: 'pl1' } })
  })

  it('a warm-up custom_json with no off-chain equivalent is not swallowed', async () => {
    asIncubating()
    wallet.customJSON.mockResolvedValue(signed)
    await customJsonWithAioha(KeyTypes.Posting, 'community', '[]')
    expect(wallet.customJSON).toHaveBeenCalledWith(KeyTypes.Posting, 'community', '[]', '')
  })

  it('a Butter Auth posting custom_json is broadcast as the session account', async () => {
    asButrAuth('alice')
    const api = fakeApi({ [BROADCAST]: ok() })
    await customJsonWithAioha(KeyTypes.Posting, 'community', '["subscribe",{"community":"hive-1"}]')
    expect(broadcastOps(api)).toEqual([[['custom_json', {
      required_auths: [], required_posting_auths: ['alice'], id: 'community', json: '["subscribe",{"community":"hive-1"}]',
    }]]])
  })

  it('an ACTIVE custom_json never goes to the posting-only routes', async () => {
    asButrAuth('alice')
    const api = fakeApi({})
    wallet.customJSON.mockResolvedValue(signed)
    await customJsonWithAioha(KeyTypes.Active, 'ssc-mainnet-hive', '{}', 'Swap')
    expect(api).not.toHaveBeenCalled()
    expect(wallet.customJSON).toHaveBeenCalledWith(KeyTypes.Active, 'ssc-mainnet-hive', '{}', 'Swap')
  })

  it('a wallet login uses the proxy, and falls back to the wallet without the grant', async () => {
    asKeychain('alice')
    const api = fakeApi({ [BROADCAST]: [fail(403, { error: 'Authorization required' })] })
    wallet.customJSON.mockResolvedValue(signed)
    await customJsonWithAioha(KeyTypes.Posting, 'community', '[]')
    expect(broadcastOps(api)).toHaveLength(1)
    expect(wallet.customJSON).toHaveBeenCalledTimes(1)
  })

  it('a proxy failure other than the grant is passed on', async () => {
    asKeychain('alice')
    fakeApi({ [BROADCAST]: fail(500, {}) })
    await expect(customJsonWithAioha(KeyTypes.Posting, 'community', '[]')).rejects.toThrow('Broadcast via @threespeak failed')
  })

  it('a refused custom_json says why', async () => {
    wallet.customJSON.mockResolvedValue({ success: false })
    await expect(customJsonWithAioha(KeyTypes.Posting, 'x', '{}')).rejects.toThrow('Custom JSON failed (no error returned by aioha)')
  })
})

describe('comments and posts', () => {
  const meta = { app: '3speak/0.3', video: { info: { permlink: 'vid123' } } }
  const options = { max_accepted_payout: '1000000.000 HBD', percent_hbd: 10000, allow_votes: true, allow_curation_rewards: true, extensions: [] }

  it('a warm-up user stores the post off-chain under the SAME permlink, and drops the payout options', async () => {
    asIncubating()
    const res = await commentWithAioha('', 'hive-181335', 'my-post', 'Title', 'Body', meta, options)
    expect(incubation.postIncubationContent).toHaveBeenCalledWith({
      title: 'Title', body: 'Body', permlink: 'my-post', parentAuthor: '', parentPermlink: 'hive-181335',
      jsonMetadata: meta, videoId: 'vid123',
    })
    expect(res).toEqual({ success: true, incubation: true, permlink: 'stored-permlink' })
  })

  it('a warm-up reply with no metadata still has a parent and no video', async () => {
    asIncubating()
    await commentWithAioha(null, null, 'reply-1', '', 'Nice!', null)
    expect(incubation.postIncubationContent).toHaveBeenCalledWith(expect.objectContaining({
      parentAuthor: '', parentPermlink: '', jsonMetadata: {}, videoId: null,
    }))
  })

  it('a Butter Auth post is the comment plus its comment_options, as the session account', async () => {
    asButrAuth('alice')
    const api = fakeApi({ [BROADCAST]: ok() })
    await commentWithAioha('', 'hive-181335', 'my-post', 'Title', 'Body', meta, options)
    expect(broadcastOps(api)).toEqual([[
      ['comment', {
        parent_author: '', parent_permlink: 'hive-181335', author: 'alice', permlink: 'my-post',
        title: 'Title', body: 'Body', json_metadata: JSON.stringify(meta),
      }],
      ['comment_options', { author: 'alice', permlink: 'my-post', ...options }],
    ]])
  })

  it('a reply without options is a single comment op', async () => {
    asButrAuth('alice')
    const api = fakeApi({ [BROADCAST]: ok() })
    await commentWithAioha('bob', 'my-video', 're-bob', '', 'Great', {})
    expect(broadcastOps(api)[0]).toHaveLength(1)
  })

  it('a wallet login posts through the proxy, options included', async () => {
    asKeychain('alice')
    const api = fakeApi({ [BROADCAST]: ok() })
    await commentWithAioha('bob', 'my-video', 're-bob', '', 'Great', {}, options)
    expect(broadcastOps(api)[0].map(([type]) => type)).toEqual(['comment', 'comment_options'])
    expect(broadcastOps(api)[0][0][1].author).toBe('alice')
  })

  it('without the grant, the wallet signs the comment, metadata as JSON', async () => {
    asKeychain('alice')
    fakeApi({ [BROADCAST]: fail(403, { error: 'Authorization required' }) })
    wallet.comment.mockResolvedValue(signed)
    await commentWithAioha('bob', 'my-video', 're-bob', '', 'Great', meta, options)
    expect(wallet.comment).toHaveBeenCalledWith('bob', 'my-video', 're-bob', '', 'Great', JSON.stringify(meta), options)
  })

  it('a proxy failure other than the grant is passed on', async () => {
    asKeychain('alice')
    fakeApi({ [BROADCAST]: fail(400, { error: 'Comment too long' }) })
    await expect(commentWithAioha('bob', 'my-video', 're-bob', '', 'x')).rejects.toThrow('Comment too long')
  })

  it('a refused comment says why', async () => {
    wallet.comment.mockResolvedValue({ success: false, error: 'You may only post once every 5 minutes' })
    await expect(commentWithAioha('', 'hive-1', 'p', 'T', 'B')).rejects.toThrow('once every 5 minutes')
  })
})

describe('raw broadcasts', () => {
  const profileOp = ['account_update2', {
    account: 'newbie', json_metadata: '',
    posting_json_metadata: JSON.stringify({ profile: { name: 'New Bie', interests: ['music'] } }), extensions: [],
  }]
  const playlistOps = [
    ['custom_json', { id: '3speak_playlist_create', json: '{"name":"A"}' }],
    ['custom_json', { id: '3speak_playlist_add', json: '{"item":"x"}' }],
  ]

  it('an active-key broadcast is the default and the wallet signs it', async () => {
    asKeychain('alice')
    const api = fakeApi({})
    wallet.signAndBroadcastTx.mockResolvedValue(signed)
    const ops = [['transfer_to_vesting', { from: 'alice', to: 'alice', amount: '1.000 HIVE' }]]
    await expect(broadcastWithAioha(ops)).resolves.toEqual({ success: true, result: { id: 'wallet-tx' } })
    expect(wallet.signAndBroadcastTx).toHaveBeenCalledWith(ops, KeyTypes.Active)
    expect(api).not.toHaveBeenCalled()
  })

  it('a warm-up profile update is saved off-chain with its interests', async () => {
    asIncubating()
    await expect(broadcastWithAioha([profileOp], KeyTypes.Posting)).resolves.toEqual({ success: true, incubation: true })
    expect(incubation.saveIncubationProfile).toHaveBeenCalledWith({ name: 'New Bie', interests: ['music'] }, ['music'])
  })

  it('a warm-up vote op is stored off-chain', async () => {
    asIncubating()
    await broadcastWithAioha([['vote', { voter: 'newbie', author: 'bob', permlink: 'p', weight: 100 }]], KeyTypes.Posting)
    expect(incubation.voteIncubation).toHaveBeenCalledWith('bob', 'p', 100)
  })

  it('warm-up playlist ops are applied off-chain IN ORDER (the add needs the create)', async () => {
    asIncubating()
    const order = []
    incubation.playlistIncubation = vi.fn(async (op) => { order.push(op) })
    await expect(broadcastWithAioha(playlistOps, KeyTypes.Posting)).resolves.toEqual({ success: true, incubation: true })
    expect(order).toEqual(['create', 'add'])
  })

  it('any other warm-up multi-op transaction is NOT half-applied off-chain', async () => {
    asIncubating()
    wallet.signAndBroadcastTx.mockResolvedValue(signed)
    const ops = [profileOp, ['vote', { voter: 'newbie', author: 'bob', permlink: 'p', weight: 100 }]]
    await broadcastWithAioha(ops, KeyTypes.Posting)
    expect(incubation.saveIncubationProfile).not.toHaveBeenCalled()
    expect(incubation.voteIncubation).not.toHaveBeenCalled()
    expect(wallet.signAndBroadcastTx).toHaveBeenCalledWith(ops, KeyTypes.Posting)
  })

  it('a Butter Auth posting broadcast goes to /api/broadcast as given', async () => {
    asButrAuth('alice')
    const api = fakeApi({ [BROADCAST]: ok() })
    await broadcastWithAioha(playlistOps, KeyTypes.Posting)
    expect(broadcastOps(api)).toEqual([playlistOps])
  })

  it('a Butter Auth active broadcast goes to the active-key dialog instead', async () => {
    asButrAuth('alice')
    const handler = vi.fn(async () => ({ success: true }))
    setActiveAuthHandler(handler)
    const ops = [['account_witness_vote', { account: 'alice', witness: 'threespeak', approve: true }]]
    await broadcastWithAioha(ops, KeyTypes.Active)
    expect(handler).toHaveBeenCalledWith(ops)
  })

  it('a wallet posting broadcast uses the proxy, falling back to the wallet without the grant', async () => {
    asKeychain('alice')
    fakeApi({ [BROADCAST]: fail(403, { error: 'Authorization required' }) })
    wallet.signAndBroadcastTx.mockResolvedValue(signed)
    await broadcastWithAioha(playlistOps, KeyTypes.Posting)
    expect(wallet.signAndBroadcastTx).toHaveBeenCalledWith(playlistOps, KeyTypes.Posting)
  })

  it('a proxy failure other than the grant is passed on', async () => {
    asKeychain('alice')
    fakeApi({ [BROADCAST]: fail(500, { error: 'x' }) })
    await expect(broadcastWithAioha(playlistOps, KeyTypes.Posting)).rejects.toThrow('x')
  })

  it('a refused broadcast says why', async () => {
    wallet.signAndBroadcastTx.mockResolvedValue({ success: false, error: 'Missing active authority' })
    await expect(broadcastWithAioha([['transfer', {}]])).rejects.toThrow('Missing active authority')
  })
})

describe('signing a message', () => {
  it('returns the signature', async () => {
    wallet.signMessage.mockResolvedValue({ success: true, result: 'SIG' })
    await expect(signMessageWithAioha('challenge')).resolves.toEqual({ success: true, result: 'SIG' })
    expect(wallet.signMessage).toHaveBeenCalledWith('challenge', KeyTypes.Posting)
  })

  it.each([
    [{ success: false, error: 'declined' }, 'declined'],
    [{ success: false, errorMessage: 'locked' }, 'locked'],
    [{ success: true, result: '' }, 'Sign message failed'],
  ])('fails on %j', async (result, message) => {
    wallet.signMessage.mockResolvedValue(result)
    await expect(signMessageWithAioha('challenge', KeyTypes.Active)).rejects.toThrow(message)
  })
})

describe('the Butter Auth broadcast endpoint', () => {
  it.each([
    [fail(401, { error: 'Session expired' }), 'Session expired'],
    [ok({ success: false, message: 'Rejected by node' }), 'Rejected by node'],
    [fail(500, {}), 'Broadcast failed'],
  ])('a failed broadcast says why', async (response, message) => {
    fakeApi({ [BROADCAST]: response })
    await expect(broadcastViaManteAuth([['vote', {}]])).rejects.toThrow(message)
  })
})

describe('who is signed in', () => {
  it('a Butter Auth session counts, when Butter Auth is switched on', () => {
    localStorage.setItem('manteauth_login', 'true')
    expect(isManteAuthLogin()).toBe(true)
    expect(isLoggedIn()).toBe(true)
  })

  it('with Butter Auth switched off, a leftover session does not count', () => {
    vi.stubEnv('VITE_ENABLE_BUTRAUTH', 'false')
    localStorage.setItem('manteauth_login', 'true')
    expect(isManteAuthLogin()).toBe(false)
  })

  it('the hidden soft-launch unlock turns it back on', () => {
    vi.stubEnv('VITE_ENABLE_BUTRAUTH', 'false')
    localStorage.setItem('manteauth_login', 'true')
    localStorage.setItem('butrauth_unlocked', 'true')
    expect(isManteAuthLogin()).toBe(true)
  })

  it('a wallet login counts; nobody signed in does not', () => {
    expect(isLoggedIn()).toBe(false)
    asKeychain('alice')
    expect(isLoggedIn()).toBe(true)
    expect(getCurrentUser()).toBe('alice')
    expect(getCurrentProvider()).toBe(Providers.Keychain)
  })

  it('operations are attributed to the Butter Auth account, which the wallet never knows', () => {
    asButrAuth('alice')
    expect(getCurrentUser()).toBeNull()
    expect(getOperationUser()).toBe('alice')
  })

  it('a Butter Auth session with no stored account attributes to nobody, never "null"', () => {
    localStorage.setItem('manteauth_login', 'true')
    expect(getOperationUser()).toBeNull()
  })

  it('otherwise the wallet account', () => {
    asKeychain('bob')
    expect(getOperationUser()).toBe('bob')
  })
})
