// @vitest-environment jsdom
// openpodAnnounce (src/utils/openpodAnnounce.js): the Hive announcement for an
// OpenPod. A short snap under the latest @peak.snaps container, or a full
// community post whose permlink IS the room name; a standalone stream carries a
// player, a conference room only a join link. Also the shared announce config
// and the "announce when the stream starts" hand-off. The Hive calls are mocked
// and the tests assert the exact operations; nothing is broadcast.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const toastSpy = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('../../../src/utils/toast', () => ({ toastIn: () => toastSpy }))
vi.mock('../../../src/i18n', () => ({ t: (key) => `t:${key}` }))
vi.mock('../../../src/hive-api/aioha', () => ({
  commentWithAioha: vi.fn(async () => ({ success: true })),
  broadcastWithAioha: vi.fn(async () => ({ success: true })),
  KeyTypes: { Posting: 'posting' },
}))
vi.mock('../../../src/utils/snapsContainer', () => ({
  resolveSnapsContainer: vi.fn(async () => ({ author: 'peak.snaps', permlink: 'snaps-container-1' })),
}))

const { commentWithAioha, broadcastWithAioha } = await import('../../../src/hive-api/aioha')

const NOW = new Date('2026-03-01T12:00:00Z').getTime()
let mod
async function load(stored) {
  vi.resetModules()
  localStorage.clear()
  if (stored !== undefined) localStorage.setItem('openpod-announce-config', stored)
  mod = await import('../../../src/utils/openpodAnnounce.js')
  return mod
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  commentWithAioha.mockClear().mockResolvedValue({ success: true })
  broadcastWithAioha.mockClear().mockResolvedValue({ success: true })
  toastSpy.success.mockClear()
  toastSpy.error.mockClear()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  await load()
})

const standalone = (extra = {}) => ({
  name: 'stream-abc',
  title: 'Friday jam',
  description: '  Live music  ',
  backgroundImage: 'https://images.3speak.tv/bg.jpg',
  mode: 'standalone',
  ...extra,
})
const conference = (extra = {}) => ({ name: 'room-xyz', title: 'Town hall', mode: 'conference', ...extra })

const lastComment = () => {
  const [parentAuthor, parentPermlink, permlink, title, body, metadata, options] = commentWithAioha.mock.calls.at(-1)
  return { parentAuthor, parentPermlink, permlink, title, body, metadata, options }
}

describe('announce config', () => {
  it('defaults to announcing in the 3Speak community with rewards on', () => {
    expect(mod.getAnnounceConfig()).toEqual({
      announceEnabled: true,
      community: 'hive-181335',
      communityTitle: '',
      declineRewards: false,
      rewardPowerup: false,
      beneList: [],
    })
  })

  it('restores the persisted choices from the last session, and only those', async () => {
    await load(JSON.stringify({ announceEnabled: false, community: 'hive-1', addToBlog: false, junk: 1 }))
    expect(mod.getAnnounceConfig()).toMatchObject({ announceEnabled: false, community: 'hive-1' })
    expect(mod.getAnnounceConfig()).not.toHaveProperty('junk')
    expect(mod.getAnnounceConfig()).not.toHaveProperty('addToBlog')
  })

  it.each([['{broken'], ['"a string"'], ['null']])('ignores a stored value of %s', async (stored) => {
    await load(stored)
    expect(mod.getAnnounceConfig().community).toBe('hive-181335')
  })

  it('merges edits from either editor and persists the long-lived ones', () => {
    mod.setAnnounceConfig({ community: 'hive-2' })
    mod.setAnnounceConfig({ declineRewards: true, addToBlog: false })
    expect(mod.getAnnounceConfig()).toMatchObject({ community: 'hive-2', declineRewards: true, addToBlog: false })
    const stored = JSON.parse(localStorage.getItem('openpod-announce-config'))
    expect(stored).toMatchObject({ community: 'hive-2', declineRewards: true })
    expect(stored).not.toHaveProperty('addToBlog')
  })

  it('keeps an edit in memory when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full') })
    mod.setAnnounceConfig({ community: 'hive-3' })
    expect(mod.getAnnounceConfig().community).toBe('hive-3')
  })
})

describe('postOpenPodAnnouncement: guards', () => {
  it.each([
    ['nobody is logged in', { user: '' }],
    ['the host opted out of Hive', { user: 'alice', options: { notifyOnHive: false } }],
  ])('posts nothing when %s', async (_label, args) => {
    await mod.postOpenPodAnnouncement({ room: standalone(), ...args })
    expect(commentWithAioha).not.toHaveBeenCalled()
    expect(toastSpy.error).not.toHaveBeenCalled()
  })
})

describe('postOpenPodAnnouncement: snap', () => {
  it('replies to the newest snaps container with a dated permlink and the watch link', async () => {
    await mod.postOpenPodAnnouncement({ room: conference(), user: 'alice' })
    const c = lastComment()
    expect([c.parentAuthor, c.parentPermlink, c.permlink, c.title]).toEqual(['peak.snaps', 'snaps-container-1', `openpod-${NOW}`, ''])
    expect(c.body).toContain('**Town hall**')
    expect(c.body.endsWith('https://3speak.tv/watch?v=alice/room-xyz')).toBe(true)
    expect(c.options).toBeUndefined()
    expect(toastSpy.success).not.toHaveBeenCalled()
  })

  it('keeps a conference room snap a plain link: MicroPost envelope, no player', async () => {
    await mod.postOpenPodAnnouncement({ room: conference(), user: 'alice', orientation: 'landscape' })
    const { metadata } = lastComment()
    expect(metadata).toEqual({
      app: '3speak/openpod',
      format: 'markdown',
      tags: ['3speak', 'openpod', 'hive-181335'],
      type: 'openpod',
      room: 'room-xyz',
      oa: { v: 1, object: 'MicroPost' },
    })
  })

  it('makes a standalone stream snap carry the live player, attributed to the host', async () => {
    await mod.postOpenPodAnnouncement({ room: standalone({ host: 'studio' }), user: 'alice', orientation: 'portrait' })
    const { metadata, body } = lastComment()
    const embed = 'https://play.3speak.tv/embed?v=studio/stream-abc'
    expect(body).toContain('https://3speak.tv/watch?v=studio/stream-abc')
    expect(body.startsWith('![Friday jam](https://images.3speak.tv/bg.jpg)')).toBe(true)
    expect(metadata.links).toEqual([embed])
    expect(metadata.video).toEqual({
      platform: '3speak',
      url: embed,
      reusable: false,
      live: true,
      thumbnail: 'https://images.3speak.tv/bg.jpg',
      info: {
        platform: '3speak',
        author: 'studio',
        permlink: 'stream-abc',
        title: 'Friday jam',
        duration: 0,
        live: true,
        sourceMap: [{ url: 'https://images.3speak.tv/bg.jpg', type: 'thumbnail' }],
      },
    })
    expect(metadata['threespeak.video']).toEqual({ surface: 'live', orientation: 'portrait' })
  })

  it('leaves the thumbnail fields and the orientation claim out when unknown', async () => {
    await mod.postOpenPodAnnouncement({ room: standalone({ backgroundImage: '' }), user: 'alice' })
    const { metadata } = lastComment()
    expect(metadata.video).not.toHaveProperty('thumbnail')
    expect(metadata.video.info).not.toHaveProperty('sourceMap')
    expect(metadata).not.toHaveProperty('threespeak.video')
  })

  it('tells the host when the snap could not be posted, without throwing', async () => {
    commentWithAioha.mockRejectedValueOnce(new Error('RC exhausted'))
    await expect(mod.postOpenPodAnnouncement({ room: conference(), user: 'alice' })).resolves.toBeUndefined()
    expect(toastSpy.error).toHaveBeenCalledWith('t:misc.openpod.announceFailed')
  })
})

describe('postOpenPodAnnouncement: full post', () => {
  const post = (room, extra = {}) => mod.postOpenPodAnnouncement({ room, user: 'alice', options: { announceType: 'post' }, ...extra })

  it('posts a standalone stream with the room name as permlink and the player first', async () => {
    await post(standalone(), { orientation: 'landscape' })
    const c = lastComment()
    expect([c.parentAuthor, c.parentPermlink, c.permlink, c.title]).toEqual(['', 'hive-181335', 'stream-abc', 'Friday jam'])
    expect(c.body).toBe(
      'https://play.3speak.tv/embed?v=alice/stream-abc\n\n'
      + 'Live music\n\n'
      + '---\n▶ [Watch on 3speak.tv](https://3speak.tv/watch?v=alice/stream-abc)',
    )
    expect(c.metadata).toMatchObject({
      app: '3speak/embed',
      format: 'markdown',
      tags: ['hive-181335', 'openpod', '3speak'],
      image: ['https://images.3speak.tv/bg.jpg'],
      openpodRoom: 'stream-abc',
      oa: { v: 1, object: 'Article' },
      links: ['https://play.3speak.tv/embed?v=alice/stream-abc'],
      'threespeak.video': { surface: 'live', orientation: 'landscape' },
    })
    expect(c.metadata.video.info).toMatchObject({ author: 'alice', permlink: 'stream-abc', live: true, duration: 0 })
    expect(toastSpy.success).toHaveBeenCalledWith('t:misc.openpod.announced')
  })

  it('posts a conference room with only a join link: no player anywhere', async () => {
    await post(conference({ description: 'Bring questions' }))
    const c = lastComment()
    expect(c.body).toBe('Bring questions\n\n---\n🎙️ [Join the live session](https://3speak.tv/openpods/room-xyz)')
    expect(c.metadata.links).toEqual(['https://3speak.tv/openpods/room-xyz'])
    expect(c.metadata).not.toHaveProperty('video')
    expect(c.metadata).not.toHaveProperty('threespeak.video')
    expect(c.metadata).not.toHaveProperty('image')
  })

  it('omits an empty description from the body', async () => {
    await post(standalone({ description: '   ' }))
    expect(lastComment().body).toBe('https://play.3speak.tv/embed?v=alice/stream-abc\n\n---\n▶ [Watch on 3speak.tv](https://3speak.tv/watch?v=alice/stream-abc)')
  })

  it('posts into the chosen community, adding the host\'s tags without duplicates', async () => {
    mod.setAnnounceConfig({ community: 'hive-777' })
    await post(conference({ post: { tags: ['music', '3speak', 'hive-777', ''] } }))
    const c = lastComment()
    expect(c.parentPermlink).toBe('hive-777')
    expect(c.metadata.tags).toEqual(['hive-777', 'openpod', '3speak', 'music'])
  })

  it.each([[''], [null], [42]])('falls back to the 3Speak community for a community of %j', async (community) => {
    mod.setAnnounceConfig({ community })
    await post(conference())
    expect(lastComment().parentPermlink).toBe('hive-181335')
  })

  it('gives a non-Pro host\'s post the locked 10% @threespeakfund split, full payout, 50/50 HBD', async () => {
    await post(conference())
    expect(lastComment().options).toEqual({
      author: 'alice',
      permlink: 'room-xyz',
      max_accepted_payout: '1000000.000 HBD',
      percent_hbd: 10000,
      allow_votes: true,
      allow_curation_rewards: true,
      extensions: [[0, { beneficiaries: [{ account: 'threespeakfund', weight: 1000 }] }]],
    })
  })

  it('merges the host\'s splits (highest weight per account wins) and sorts them by account', async () => {
    mod.setAnnounceConfig({
      beneList: [
        { account: 'zed', weight: 500 },
        { account: 'bob', weight: 200 },
        { account: 'bob', weight: 300 },
        { account: 'threespeakfund', weight: 1500 },
      ],
    })
    await post(conference())
    expect(lastComment().options.extensions).toEqual([[0, {
      beneficiaries: [
        { account: 'bob', weight: 300 },
        { account: 'threespeakfund', weight: 1500 },
        { account: 'zed', weight: 500 },
      ],
    }]])
  })

  it('omits the beneficiaries extension for a Pro host with no splits (Hive rejects an empty one)', async () => {
    await post(conference(), { isPremium: true })
    expect(lastComment().options.extensions).toEqual([])
  })

  it('declining the payout zeroes it and skips beneficiaries; power-up sets 100% HP', async () => {
    mod.setAnnounceConfig({ declineRewards: true, rewardPowerup: true, beneList: [{ account: 'bob', weight: 100 }] })
    await post(conference())
    expect(lastComment().options).toMatchObject({ max_accepted_payout: '0.000 HBD', percent_hbd: 0, extensions: [] })
  })

  it('reblogs the post onto the host\'s blog by default, as its own broadcast', async () => {
    await post(conference())
    expect(broadcastWithAioha).toHaveBeenCalledWith([['custom_json', {
      required_auths: [],
      required_posting_auths: ['alice'],
      id: 'follow',
      json: JSON.stringify(['reblog', { account: 'alice', author: 'alice', permlink: 'room-xyz' }]),
    }]], 'posting')
    expect(commentWithAioha.mock.invocationCallOrder[0]).toBeLessThan(broadcastWithAioha.mock.invocationCallOrder[0])
  })

  it.each([
    ['the announce config says no', () => mod.setAnnounceConfig({ addToBlog: false })],
    ['the host switched it off last time', () => localStorage.setItem('3speak_add_to_blog', '0')],
  ])('does not reblog when %s', async (_label, arrange) => {
    arrange()
    await post(conference())
    expect(broadcastWithAioha).not.toHaveBeenCalled()
  })

  it('still counts the announcement as done when only the reblog fails', async () => {
    broadcastWithAioha.mockRejectedValueOnce(new Error('user rejected'))
    await post(conference())
    expect(toastSpy.success).toHaveBeenCalled()
    expect(toastSpy.error).not.toHaveBeenCalled()
  })

  it.each([
    ['rejected by the wallet', () => commentWithAioha.mockResolvedValueOnce({ success: false })],
    ['failing to broadcast', () => commentWithAioha.mockRejectedValueOnce(new Error('timeout'))],
  ])('shows an error, and does not reblog, for a post %s', async (_label, arrange) => {
    arrange()
    await post(conference())
    expect(toastSpy.error).toHaveBeenCalledWith('t:misc.openpod.announceFailed')
    expect(toastSpy.success).not.toHaveBeenCalled()
    expect(broadcastWithAioha).not.toHaveBeenCalled()
  })
})

describe('pending announcement (standalone streams announce on Start)', () => {
  const queue = (room = standalone()) => mod.setPendingAnnouncement({ room, user: 'alice', options: { announceType: 'post' } })

  it('does nothing when no announcement is waiting', async () => {
    await mod.firePendingAnnouncement('stream-abc')
    expect(commentWithAioha).not.toHaveBeenCalled()
  })

  it('fires once for its own room and is consumed', async () => {
    queue()
    await mod.firePendingAnnouncement('stream-abc')
    await mod.firePendingAnnouncement('stream-abc')
    expect(commentWithAioha).toHaveBeenCalledTimes(1)
  })

  it('ignores the start signal of another room and stays queued', async () => {
    queue()
    await mod.firePendingAnnouncement('other-room')
    expect(commentWithAioha).not.toHaveBeenCalled()
    await mod.firePendingAnnouncement('stream-abc')
    expect(commentWithAioha).toHaveBeenCalledTimes(1)
  })

  it('fires whatever is waiting when no room name is given', async () => {
    queue()
    await mod.firePendingAnnouncement()
    expect(lastComment().permlink).toBe('stream-abc')
  })

  it('is consumed without posting when the host switched announcing off in the studio', async () => {
    queue()
    mod.setAnnounceConfig({ announceEnabled: false })
    await mod.firePendingAnnouncement('stream-abc')
    mod.setAnnounceConfig({ announceEnabled: true })
    await mod.firePendingAnnouncement('stream-abc')
    expect(commentWithAioha).not.toHaveBeenCalled()
  })

  it('can be cleared', async () => {
    queue()
    mod.clearPendingAnnouncement()
    await mod.firePendingAnnouncement('stream-abc')
    expect(commentWithAioha).not.toHaveBeenCalled()
  })

  it('posts the latest studio edits over the create-time details', async () => {
    queue()
    await mod.firePendingAnnouncement('stream-abc', {
      title: 'Renamed jam',
      description: 'New words',
      thumbnail: 'https://images.3speak.tv/new.jpg',
      tags: ['music'],
      orientation: 'portrait',
    })
    const c = lastComment()
    expect(c.title).toBe('Renamed jam')
    expect(c.body).toContain('New words')
    expect(c.metadata.image).toEqual(['https://images.3speak.tv/new.jpg'])
    expect(c.metadata.tags).toContain('music')
    expect(c.metadata['threespeak.video']).toEqual({ surface: 'live', orientation: 'portrait' })
  })

  it('keeps the create-time title and thumbnail for empty edits, but allows clearing the description', async () => {
    queue()
    await mod.firePendingAnnouncement('stream-abc', { title: '', thumbnail: '', description: '' })
    const c = lastComment()
    expect(c.title).toBe('Friday jam')
    expect(c.metadata.image).toEqual(['https://images.3speak.tv/bg.jpg'])
    expect(c.body).not.toContain('Live music')
    expect(c.metadata).not.toHaveProperty('threespeak.video')
  })
})
