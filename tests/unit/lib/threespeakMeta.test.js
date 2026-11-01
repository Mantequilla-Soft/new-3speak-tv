// The account's `3speak` settings (src/lib/threespeakMeta.js): two settings saved
// close together must both survive, even while the node still answers with the
// metadata from before the first save.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../src/hive-api/hiveApi', () => ({ getAccounts: vi.fn() }))
vi.mock('../../../src/hive-api/aioha', () => ({ broadcastWithAioha: vi.fn(), KeyTypes: { Posting: 'posting' } }))

const { saveThreespeakMeta } = await import('../../../src/lib/threespeakMeta.js')
const { getAccounts } = await import('../../../src/hive-api/hiveApi')
const { broadcastWithAioha } = await import('../../../src/hive-api/aioha')

const written = () => broadcastWithAioha.mock.calls.map(([[op]]) => JSON.parse(op[1].posting_json_metadata))

describe('saveThreespeakMeta', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // The node never catches up: it always returns the metadata from before.
    getAccounts.mockResolvedValue([{ posting_json_metadata: JSON.stringify({ profile: { name: 'B' } }) }])
  })

  it('keeps both of two saves started at the same time', async () => {
    let release
    broadcastWithAioha.mockImplementationOnce(() => new Promise((r) => { release = () => r({ success: true }) }))
    broadcastWithAioha.mockResolvedValue({ success: true })
    const first = saveThreespeakMeta('badadib', (ns) => { ns.lightning = { address: 'a@b.c' } })
    const second = saveThreespeakMeta('badadib', (ns) => { ns.supportLinks = ['https://ko-fi.com/badadib'] })
    await vi.waitFor(() => expect(broadcastWithAioha).toHaveBeenCalledTimes(1))
    release()
    await Promise.all([first, second])
    const last = written().at(-1)
    expect(last.profile).toEqual({ name: 'B' })
    expect(last['3speak']).toEqual({ lightning: { address: 'a@b.c' }, supportLinks: ['https://ko-fi.com/badadib'] })
  })

  it('a failed save neither blocks the next one nor counts as written', async () => {
    broadcastWithAioha.mockResolvedValueOnce({ success: false, error: 'rejected' })
    broadcastWithAioha.mockResolvedValue({ success: true })
    await expect(saveThreespeakMeta('alice', (ns) => { ns.lightning = { address: 'x@y.z' } })).rejects.toThrow('rejected')
    await saveThreespeakMeta('alice', (ns) => { ns.supportLinks = [] })
    expect(written().at(-1)['3speak']).toEqual({ supportLinks: [] })
  })

  it('keeps what other writers saved meanwhile, and only our own fresh keys win', async () => {
    broadcastWithAioha.mockResolvedValue({ success: true })
    await saveThreespeakMeta('carol', (ns) => { ns.supportLinks = ['https://ko-fi.com/carol'] })
    // Meanwhile another part of the app saved the ad choice and a new profile; the
    // node has those, but not yet our support links.
    getAccounts.mockResolvedValue([{ posting_json_metadata: JSON.stringify({
      profile: { name: 'C2' }, '3speak': { ads: { audio: false } },
    }) }])
    await saveThreespeakMeta('carol', (ns) => { ns.lightning = { address: 'c@d.e' } })
    expect(written().at(-1)).toEqual({
      profile: { name: 'C2' },
      '3speak': { ads: { audio: false }, supportLinks: ['https://ko-fi.com/carol'], lightning: { address: 'c@d.e' } },
    })
  })

  it('a removed key stays removed while the node still has it', async () => {
    broadcastWithAioha.mockResolvedValue({ success: true })
    getAccounts.mockResolvedValue([{ posting_json_metadata: JSON.stringify({ '3speak': { lightning: { address: 'old@x.y' } } }) }])
    await saveThreespeakMeta('dave', (ns) => { delete ns.lightning })
    await saveThreespeakMeta('dave', (ns) => { ns.supportLinks = [] })
    expect(written().at(-1)['3speak']).toEqual({ supportLinks: [] })
  })
})
