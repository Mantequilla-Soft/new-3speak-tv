// Automations (server/automations.cjs, automation-catalog.cjs, automation-tasks.cjs):
// what a workflow may contain, which posts start which events, the routes and
// their closed-beta gate, and runs end to end. Hive, the checker, the upload
// service and Discord are stand-ins; nothing leaves the process.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { createRequire } from 'node:module'
import express from 'express'

const require = createRequire(import.meta.url)
const catalog = require('../../server/automation-catalog.cjs')
const tasks = require('../../server/automation-tasks.cjs')
const { mountAutomations, memoryStore } = require('../../server/automations.cjs')

const MIN = 60 * 1000
const hiveTime = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, '')
const WEBHOOK = 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_ABCDEF-123'

const task = (id, type, properties = {}) => ({ id, componentType: 'task', type, name: type, properties })
const ifStep = (id, properties, yes = [], no = []) => ({ id, componentType: 'switch', type: 'if', name: 'If', properties, branches: { yes, no } })
const def = (event, sequence) => ({ properties: { event }, sequence })

const videoPost = (permlink, at, extra = {}) => ({
  author: 'alice', permlink, parent_author: '', category: 'hive-181335', title: `Video ${permlink}`,
  body: 'https://play.3speak.tv/embed?v=alice/abc\n\nAll about cats in the garden.\n\n---\n▶ [Watch on 3speak.tv](https://3speak.tv/watch?v=alice/x)',
  created: hiveTime(at),
  json_metadata: { app: '3speak/embed', tags: ['hive-181335', 'cats'], video: { info: { duration: 300 } }, 'threespeak.video': { surface: 'watch' }, ...extra },
})

describe('catalog: what a workflow may contain', () => {
  it('keeps a valid workflow and only what the catalog knows', () => {
    const v = catalog.validateDefinition(def('video_published', [
      { ...task('a1', 'post_snap', { text: 'New: {title} {url}', tags: ['#Cats', 'bad tag!'], extra: 'x' }), junk: true },
      ifStep('i1', { field: 'title', op: 'contains', value: 'cat' }, [task('b1', 'post_comment', { text: 'Thanks!' })]),
    ]))
    expect(v.error).toBeUndefined()
    expect(v.definition.sequence[0]).toEqual({ id: 'a1', componentType: 'task', type: 'post_snap', name: 'post_snap', properties: { text: 'New: {title} {url}', tags: ['cats'] } })
    expect(v.definition.sequence[1].branches).toEqual({ yes: [expect.objectContaining({ id: 'b1' })], no: [] })
  })

  it('refuses what the runner could not do', () => {
    const bad = (event, seq) => catalog.validateDefinition(def(event, seq))
    expect(bad('nope', [task('a', 'post_snap', { text: 'x' })]).error).toBe('no_event')
    expect(bad('video_published', []).error).toBe('empty')
    expect(bad('video_published', [task('a', 'transfer_hive', {})]).error).toBe('unknown_step')
    // A Short needs a video to cut.
    expect(bad('podcast_published', [task('a', 'post_short', { caption: 'x' })])).toMatchObject({ error: 'task_not_for_event', stepId: 'a' })
    expect(bad('video_published', [task('a', 'post_short', { caption: 'x' }), task('b', 'post_short', { caption: 'y' })]).error).toBe('too_many_of_type')
    expect(bad('video_published', [task('a', 'post_short', { caption: 'x', length: 90 })])).toMatchObject({ error: 'out_of_range', property: 'length' })
    expect(bad('video_published', [task('a', 'send_discord', { webhook: 'https://evil.example/api/webhooks/1/2', text: 'x' })]).error).toBe('bad_webhook')
    expect(bad('video_published', [task('a', 'post_comment', { text: '  ' })])).toMatchObject({ error: 'required', property: 'text' })
    expect(bad('video_published', [task('a', 'post_snap', { text: 'x' }), task('a', 'post_snap', { text: 'y' })]).error).toBe('bad_id')
    // The field must be one this event has, and the operator must fit it.
    expect(bad('stream_started', [ifStep('i', { field: 'duration', op: 'gt', value: '60' })]).error).toBe('bad_field')
    expect(bad('video_published', [ifStep('i', { field: 'title', op: 'gt', value: '60' })]).error).toBe('bad_operator')
    expect(bad('video_published', [ifStep('i', { field: 'duration', op: 'gt', value: 'long' })]).error).toBe('bad_value')
  })

  it('limits the size and the nesting', () => {
    const many = Array.from({ length: 13 }, (_, i) => task(`t${i}`, 'post_comment', { text: 'x' }))
    expect(catalog.validateDefinition(def('video_published', many)).error).toBe('too_many_steps')
    const cond = { field: 'title', op: 'contains', value: 'a' }
    const deep = ifStep('i1', cond, [ifStep('i2', cond, [ifStep('i3', cond, [ifStep('i4', cond)])])])
    expect(catalog.validateDefinition(def('video_published', [deep])).error).toBe('too_deep')
  })

  it('fills templates and tests conditions', () => {
    const values = { title: 'Cats', url: 'https://3speak.tv/watch?v=alice/x', tags: ['cats', 'pets'], duration: 300 }
    expect(catalog.renderTemplate('{title} ▶ {url} {tags} {nope}', values)).toBe('Cats ▶ https://3speak.tv/watch?v=alice/x #cats #pets {nope}')
    expect(catalog.testCondition({ field: 'title', op: 'contains', value: 'CAT' }, values)).toBe(true)
    expect(catalog.testCondition({ field: 'tags', op: 'has_tag', value: 'dogs' }, values)).toBe(false)
    expect(catalog.testCondition({ field: 'duration', op: 'gt', value: '240' }, values)).toBe(true)
    expect(catalog.testCondition({ field: 'duration', op: 'lt', value: '240' }, values)).toBe(false)
  })
})

describe('catalog: which posts start which events', () => {
  const at = Date.now()
  it('tells videos, Shorts, imports, audio and streams apart', () => {
    expect(catalog.classifyPost(videoPost('v1', at))).toMatchObject({ events: ['video_published'], values: { title: 'Video v1', description: 'All about cats in the garden.', duration: 300, tags: ['hive-181335', 'cats'], url: 'https://3speak.tv/watch?v=alice/v1' } })
    const short = { ...videoPost('s1', at), parent_author: 'peak.snaps', parent_permlink: 'snaps-1', title: '', body: 'https://play.3speak.tv/embed?v=alice/s\n\nMy short #fun\n\n---\n▶ Watch' }
    expect(catalog.classifyPost(short)).toMatchObject({ events: ['short_published'], values: { description: 'My short #fun', kind: 'short', url: 'https://3speak.tv/shorts?v=alice/s1' } })
    expect(catalog.classifyPost(videoPost('i1', at, { imported_from: { platform: 'youtube', id: 'x' } }))).toMatchObject({ events: ['video_imported'], values: { platform: 'youtube', kind: 'video' } })
    const podcast = { ...videoPost('p1', at), json_metadata: { app: '3speak/audio', tags: ['podcast'], audio: { type: 'podcast' }, 'threespeak.audio': { type: 'podcast', duration: 1800 } } }
    expect(catalog.classifyPost(podcast)).toMatchObject({ events: ['podcast_published', 'audio_published'], values: { audioType: 'podcast', imported: 'no', duration: 1800, url: 'https://3speak.tv/audio/alice/p1' } })
    const song = { ...podcast, json_metadata: { ...podcast.json_metadata, audio: { type: 'song' }, 'threespeak.audio': { type: 'song' } } }
    expect(catalog.classifyPost(song).events).toEqual(['audio_published'])
    expect(catalog.classifyPost(videoPost('l1', at, { openpodRoom: 'room-1' })).events).toEqual(['stream_started'])
  })

  it('ignores posts an automation made and ordinary replies', () => {
    expect(catalog.classifyPost(videoPost('a1', at, { [catalog.MARKER]: { workflow: 'x' } }))).toBeNull()
    expect(catalog.classifyPost({ ...videoPost('r1', at), parent_author: 'bob' })).toBeNull()
  })

  it('tells a written post (no 3Speak video, audio or stream) for narrate_post', () => {
    expect(catalog.classifyPost({ ...videoPost('t1', at), json_metadata: '{"app":"peakd","tags":["travel"]}' })).toMatchObject({
      events: ['text_post_published'], values: { title: 'Video t1', tags: ['travel'], url: 'https://3speak.tv/@alice/t1' },
    })
    expect(catalog.classifyPost({ ...videoPost('t2', at), json_metadata: 'not json' }).events).toEqual(['text_post_published'])
    expect(catalog.classifyWatched({ ...videoPost('t3', at), json_metadata: '{}' }).values.postKind).toBe('post')
  })
})

describe('catalog: wallet history, polls and other accounts', () => {
  const tx = (from, amount, memo, to = 'alice') => ['transfer', { from, to, amount, memo }]
  it('tells tips, boosts and power ups apart, and ignores the rest', () => {
    expect(catalog.classifyHistory(tx('fan', '1.000 HIVE', 'nice https://3speak.tv/watch?v=alice/cats'), 'alice')).toMatchObject({
      events: ['tip_received'], values: { from: 'fan', amount: 1, asset: 'HIVE', message: 'nice', via: 'hive' }, post: { author: 'alice', permlink: 'cats' },
    })
    const ln = catalog.classifyHistory(tx('v4vapp', '0.820 HIVE', 'Converted 100 sats to 0.820 HIVE for alice | so good https://3speak.tv/watch?v=alice/cats #lightningaddress | § x | Thank you'), 'alice')
    expect(ln.values).toMatchObject({ from: '', via: 'lightning', message: 'so good', amount: 0.82 })
    expect(catalog.classifyHistory(tx('fan', '2.000 HBD', 'go https://3speak.tv/watch?v=alice/cats #boost'), 'alice')).toMatchObject({ events: ['boost_received'], values: { boostKind: 'post', asset: 'HBD' } })
    expect(catalog.classifyHistory(tx('escrow', '0.950 HBD', 'boost payout:alice-1abc:tx'), 'alice')).toMatchObject({ events: ['boost_received'], values: { boostKind: 'stream', from: '' }, post: { permlink: 'alice-1abc' } })
    // A tip for someone else's video: still a tip, but nothing of hers to answer under.
    expect(catalog.classifyHistory(tx('fan', '1.000 HIVE', 'https://3speak.tv/watch?v=bob/x'), 'alice').post).toBeUndefined()
    expect(catalog.classifyHistory(tx('spammer', '0.001 HIVE', 'visit spam.example'), 'alice')).toBeNull()
    expect(catalog.classifyHistory(tx('alice', '1.000 HIVE', 'https://3speak.tv/watch?v=bob/x', 'bob'), 'alice')).toBeNull()
    expect(catalog.classifyHistory(tx('fan', '1.000 HIVE', '#encrypted'), 'alice')).toBeNull()
    expect(catalog.classifyHistory(['transfer_to_vesting', { from: 'alice', to: 'alice', amount: '10.000 HIVE' }], 'alice').values).toEqual({ from: 'alice', amount: 10, author: 'alice', self: 'yes' })
    expect(catalog.classifyHistory(['transfer_to_vesting', { from: 'fan', to: 'alice', amount: '5.000 HIVE' }], 'alice').values.self).toBe('no')
  })

  it('reads ended snap polls and stream polls with their results', () => {
    const row = { status: 'Ended', author: 'alice', permlink: 'p1', question: 'Cats or dogs?', poll_stats: { total_voting_accounts_num: 5 },
      poll_choices: [{ choice_num: 1, choice_text: 'Cats', votes: { total_votes: 3 } }, { choice_num: 2, choice_text: 'Dogs', votes: { total_votes: 2 } }] }
    expect(catalog.classifyPoll(row)).toMatchObject({ events: ['poll_ended'], values: { winner: 'Cats', votes: 5, results: 'Cats: 3 (60%)\nDogs: 2 (40%)' }, post: { author: 'alice', permlink: 'p1' } })
    expect(catalog.classifyPoll({ ...row, status: 'Active' })).toBeNull()
    const view = { id: 'q', room: 'alice-1abc', kind: 'prediction', status: 'resolved', question: 'Who wins?', total: 4, winner: 1, options: [{ label: 'A', votes: 3 }, { label: 'B', votes: 1 }] }
    expect(catalog.classifyStreamPoll(view, 'alice').values).toMatchObject({ winner: 'B', votes: 4, url: 'https://3speak.tv/watch?v=alice/alice-1abc' })
    expect(catalog.classifyStreamPoll({ ...view, status: 'open' }, 'alice')).toBeNull()
  })

  it('tells what kind of post someone else made', () => {
    const at = Date.now()
    expect(catalog.classifyWatched({ ...videoPost('v', at), author: 'bob' }).values).toMatchObject({ author: 'bob', postKind: 'video' })
    expect(catalog.classifyWatched({ author: 'bob', permlink: 's', parent_author: 'peak.snaps', body: 'hi', json_metadata: '{}' }).values.postKind).toBe('snap')
    expect(catalog.classifyWatched({ author: 'bob', permlink: 't', parent_author: '', title: 'Text', body: 'b', json_metadata: '{}' }).values.postKind).toBe('post')
    expect(catalog.classifyWatched({ author: 'bob', permlink: 'r', parent_author: 'carol', body: 'b', json_metadata: '{}' })).toBeNull()
  })

  it('needs the accounts for someone_posted, and keeps tasks to the events they fit', () => {
    const one = (event, sequence, extra = {}) => catalog.validateDefinition({ properties: { event, ...extra }, sequence })
    expect(one('someone_posted', [task('a', 'reblog')]).error).toBe('no_accounts')
    expect(one('someone_posted', [task('a', 'reblog')], { accounts: ['Bad Name'] }).error).toBe('bad_account')
    expect(one('someone_posted', [task('a', 'reblog')], { accounts: ['@Bob', 'bob'] }).definition.properties.accounts).toEqual(['bob'])
    expect(one('video_published', [task('a', 'reblog')]).error).toBe('task_not_for_event')
    expect(one('video_published', [task('a', 'upvote_sender')]).error).toBe('task_not_for_event')
    expect(one('power_up', [task('a', 'post_comment', { text: 'x' })]).error).toBe('task_not_for_event')
    expect(one('tip_received', [task('a', 'upvote_sender', { weight: 30 })]).error).toBeUndefined()
    expect(one('podcast_published', [task('a', 'post_video', { title: '{title}' })]).error).toBeUndefined()
    expect(one('video_published', [task('a', 'post_audio', { title: '{title}', audioType: 'opera' })])).toMatchObject({ error: 'bad_value', property: 'audioType' })
    expect(one('tip_received', [ifStep('i', { field: 'amount', op: 'gt', value: '0.5' })]).error).toBeUndefined()
  })
})

describe('tasks', () => {
  it('cuts an upright clip from the chosen second', () => {
    const args = tasks.clipArgs('https://gw/ipfs/x/720p/index.m3u8', '/tmp/o.mp4', { start: 12, length: 30, vertical: true })
    expect(args.slice(args.indexOf('-ss'), args.indexOf('-ss') + 6)).toEqual(['-ss', '12', '-i', 'https://gw/ipfs/x/720p/index.m3u8', '-t', '30'])
    expect(args[args.indexOf('-vf') + 1]).toMatch(/^crop=.*scale=720:1280/)
    expect(tasks.clipArgs('in', 'out', { start: 0, length: 5, vertical: false })[tasks.clipArgs('in', 'out', { start: 0, length: 5, vertical: false }).indexOf('-vf') + 1]).toMatch(/^scale=/)
  })

  it('picks the rendition nearest 720p', () => {
    const master = '#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=640x360\n360p/index.m3u8\n#EXT-X-STREAM-INF:RESOLUTION=1280x720\n720p/index.m3u8\n#EXT-X-STREAM-INF:RESOLUTION=1920x1080\n1080p/index.m3u8\n'
    expect(tasks.pickVariant(master)).toBe('720p/index.m3u8')
  })
})

describe('routes and runs', () => {
  let server
  let base
  let auto
  const st = {}

  function reset() {
    Object.assign(st, {
      now: Date.parse('2026-11-19T12:00:00Z'),
      pro: { alice: true, bob: true, carol: false },
      grant: true,
      posts: [],
      broadcasts: [],
      discord: [],
      discordStatus: 204,
      source: null,
      // Other accounts' posts, the wallet history, snap polls, stream polls.
      others: {},
      history: [],
      polls: [],
      streamPolls: {},
    })
  }

  beforeAll(async () => {
    reset()
    const app = express()
    app.use(express.json())
    auto = mountAutomations(app, {
      enabled: true,
      timers: false,
      store: memoryStore(),
      betaUsers: ['alice', 'carol'],
      now: () => st.now,
      resolveUser: async (req) => req.headers['x-test-user'] || null,
      isPro: async (u) => !!st.pro[u],
      hasPostingGrant: async () => st.grant,
      hiveCall: async (method, params) => {
        if (method === 'condenser_api.get_account_history') return st.history
        const list = params.account === 'alice' ? st.posts : (st.others[params.account] || [])
        return params.sort === 'posts' ? list.filter((p) => !p.parent_author) : list.filter((p) => p.parent_author)
      },
      broadcast: async (user, ops) => { st.broadcasts.push({ user, ops }) },
      snapsContainer: async () => ({ author: 'peak.snaps', permlink: 'snaps-container' }),
      indexSnap: async () => ({}),
      videoSource: async () => st.source,
      fetch: async (url, init) => {
        if (url.startsWith('https://polls.hivehub.dev/')) return { ok: true, status: 200, json: async () => st.polls }
        const room = url.match(/^https:\/\/live\.3speak\.tv\/rooms\/([^/]+)\/polls$/)
        if (room) return st.streamPolls[room[1]] ? { ok: true, status: 200, json: async () => ({ polls: st.streamPolls[room[1]] }) } : { ok: false, status: 404 }
        st.discord.push({ url, body: JSON.parse(init.body) })
        return { ok: st.discordStatus < 300, status: st.discordStatus }
      },
    })
    await new Promise((resolve) => { server = app.listen(0, resolve) })
    base = `http://127.0.0.1:${server.address().port}`
  })
  afterAll(() => server?.close())
  beforeEach(async () => {
    const keep = st.now
    reset()
    st.now = keep + 24 * 3600 * 1000
    for (const w of await auto.store.listWorkflows({})) await auto.store.deleteWorkflow(w._id)
  })

  const call = async (user, method, path, body) => {
    const r = await fetch(`${base}/api/automations${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(user ? { 'x-test-user': user } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    return { status: r.status, body: await r.json() }
  }
  const later = async (min) => { st.now += min * MIN; await auto.tick() }

  it('is only for signed-in Pro accounts in the beta', async () => {
    expect((await call(null, 'GET', '')).status).toBe(401)
    expect((await call('bob', 'GET', '')).body.errorCode).toBe('not_in_beta')
    expect((await call('carol', 'GET', '')).body.errorCode).toBe('pro_required')
    const ok = await call('alice', 'GET', '')
    expect(ok.status).toBe(200)
    expect(Object.keys(ok.body.catalog.events)).toContain('video_imported')
    expect(ok.body.catalog.tasks.post_short.events).toEqual(['video_published', 'video_imported'])
  })

  it('lets a tester without Pro skip the Pro check, for their own account only, and take it back', async () => {
    const pro = await call('carol', 'GET', '')
    expect(pro.body).toMatchObject({ errorCode: 'pro_required', canSkip: true })
    // Outside the beta there is nothing to skip.
    expect((await call('bob', 'POST', '/skip-pro')).body.errorCode).toBe('not_in_beta')
    expect((await call('carol', 'POST', '/skip-pro')).body).toEqual({ ok: true, proSkipped: true })
    const open = await call('carol', 'GET', '')
    expect(open.status).toBe(200)
    expect(open.body.proSkipped).toBe(true)
    expect((await call('alice', 'GET', '')).body.proSkipped).toBe(false)

    // The post watcher goes by it too.
    const definition = def('video_published', [task('a1', 'post_comment', { text: 'Hi' })])
    await call('carol', 'POST', '', { name: 'Hi', definition, enabled: true })
    st.others.carol = [{ ...videoPost('carolvid', st.now + MIN), author: 'carol' }]
    await later(6)
    expect(st.broadcasts.map((b) => b.user)).toEqual(['carol'])

    expect((await call('carol', 'DELETE', '/skip-pro')).body.proSkipped).toBe(false)
    expect((await call('carol', 'GET', '')).body.errorCode).toBe('pro_required')
  })

  it('creates, changes, lists and deletes workflows; switching on needs the grant', async () => {
    const definition = def('video_published', [task('a1', 'post_snap', { text: '{title}' })])
    const made = await call('alice', 'POST', '', { name: 'Snap my videos', definition })
    expect(made.status).toBe(200)
    const id = made.body.workflow.id
    expect(made.body.workflow).toMatchObject({ name: 'Snap my videos', enabled: false })
    expect((await call('alice', 'POST', '', { name: 'x', definition: def('video_published', [task('a', 'nope')]) })).body).toMatchObject({ errorCode: 'unknown_step', stepId: 'a' })

    st.grant = false
    expect((await call('alice', 'PUT', `/${id}`, { enabled: true })).body.errorCode).toBe('no_grant')
    st.grant = true
    const on = await call('alice', 'PUT', `/${id}`, { enabled: true })
    expect(on.body.workflow.enabledAt).toBe(new Date(st.now).toISOString())
    expect((await call('alice', 'GET', '')).body.workflows).toHaveLength(1)
    // Someone else's id is not found, not changed.
    expect((await call('carol', 'PUT', `/${id}`, { enabled: false })).status).toBe(403)
    expect((await call('alice', 'DELETE', `/${id}`)).body.ok).toBe(true)
    expect((await call('alice', 'GET', '')).body.workflows).toHaveLength(0)
  })

  it('test-runs on the newest matching post without posting anything', async () => {
    st.posts = [videoPost('old', st.now - 60 * MIN), videoPost('cats', st.now - 5 * MIN)]
    const definition = def('video_published', [
      ifStep('i1', { field: 'title', op: 'contains', value: 'cats' },
        [task('y1', 'post_snap', { text: 'New: {title} {url}', tags: ['pets'] })],
        [task('n1', 'send_discord', { webhook: WEBHOOK, text: '{title}' })]),
    ])
    const r = await call('alice', 'POST', '/test', { definition })
    expect(r.body).toMatchObject({ sample: false, status: 'done', post: { permlink: 'cats', title: 'Video cats' } })
    expect(r.body.steps.i1.branch).toBe('yes')
    expect(r.body.steps.y1.result).toEqual({ would: 'post_snap', text: 'New: Video cats https://3speak.tv/watch?v=alice/cats', tags: ['community', 'pets'] })
    expect(r.body.steps.n1).toBeUndefined()
    expect(st.broadcasts).toHaveLength(0)

    // No post of that kind yet: example values.
    const s = await call('alice', 'POST', '/test', { definition: def('podcast_published', [task('a', 'post_comment', { text: '{title}' })]) })
    expect(s.body).toMatchObject({ sample: true, status: 'done' })
  })

  it('runs on new posts after switching on, once each, marked so they never start another run', async () => {
    st.posts = [videoPost('before', st.now - 10 * MIN)]
    const definition = def('video_published', [
      task('s1', 'post_snap', { text: 'New video: {title} {url}' }),
      ifStep('i1', { field: 'duration', op: 'gt', value: '600' }, [task('c1', 'post_comment', { text: 'Long one!' })], [task('d1', 'send_discord', { webhook: WEBHOOK, text: '{title} {url}' })]),
    ])
    const id = (await call('alice', 'POST', '', { name: 'Share', definition, enabled: true })).body.workflow.id

    await later(6)
    expect(st.broadcasts).toHaveLength(0)

    st.posts.push(videoPost('fresh', st.now + MIN))
    await later(6)
    expect(st.broadcasts).toHaveLength(1)
    const [type, op] = st.broadcasts[0].ops[0]
    expect(type).toBe('comment')
    expect(op).toMatchObject({ author: 'alice', parent_author: 'peak.snaps', parent_permlink: 'snaps-container', body: 'New video: Video fresh https://3speak.tv/watch?v=alice/fresh' })
    expect(JSON.parse(op.json_metadata)).toMatchObject({ app: '3speak/snap', type: 'snap', tags: ['community'], [catalog.MARKER]: { workflow: id } })
    // 300 s is not over 600: the "no" branch.
    expect(st.discord).toHaveLength(1)
    expect(st.discord[0]).toMatchObject({ url: WEBHOOK, body: { content: 'Video fresh https://3speak.tv/watch?v=alice/fresh', allowed_mentions: { parse: [] } } })

    const runs = (await call('alice', 'GET', `/${id}/runs`)).body.runs
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ status: 'done', post: { permlink: 'fresh' } })
    expect((await call('alice', 'GET', '')).body.workflows[0].lastRun.status).toBe('done')

    // The snap it posted is on the account now: seen, never a new run.
    st.posts.push({ ...videoPost('snapback', st.now + MIN, { [catalog.MARKER]: { workflow: id } }), parent_author: 'peak.snaps' })
    await later(6)
    await later(6)
    expect(st.broadcasts).toHaveLength(1)
    expect((await call('alice', 'GET', `/${id}/runs`)).body.runs).toHaveLength(1)
  })

  it('waits for a video that is still encoding without doing the earlier tasks again', async () => {
    const definition = def('video_published', [
      task('s1', 'post_snap', { text: '{title}' }),
      task('v1', 'post_short', { caption: '{title}', start: 0, length: 20 }),
    ])
    const id = (await call('alice', 'POST', '', { name: 'Clip', definition, enabled: true })).body.workflow.id
    st.posts = [videoPost('enc', st.now + MIN)]
    await later(6)
    let [run] = (await call('alice', 'GET', `/${id}/runs`)).body.runs
    expect(run).toMatchObject({ status: 'waiting', attempts: 1 })
    expect(run.steps.s1.status).toBe('done')
    expect(run.steps.v1).toMatchObject({ status: 'waiting', code: 'video_not_ready' })

    await later(11)
    ;[run] = (await call('alice', 'GET', `/${id}/runs`)).body.runs
    expect(run.attempts).toBe(2)
    expect(st.broadcasts).toHaveLength(1)
  })

  it('stops a run whose workflow was switched off, and leaves the queue on Discord trouble', async () => {
    const definition = def('video_published', [task('d1', 'send_discord', { webhook: WEBHOOK, text: '{title}' })])
    const id = (await call('alice', 'POST', '', { name: 'Ping', definition, enabled: true })).body.workflow.id
    st.discordStatus = 503
    st.posts = [videoPost('busy', st.now + MIN)]
    await later(6)
    expect((await call('alice', 'GET', `/${id}/runs`)).body.runs[0].status).toBe('waiting')
    await call('alice', 'PUT', `/${id}`, { enabled: false })
    await later(11)
    expect((await call('alice', 'GET', `/${id}/runs`)).body.runs[0].status).toBe('cancelled')
  })

  it('thanks a tipper under the video and upvotes their newest post', async () => {
    const definition = def('tip_received', [
      task('c1', 'post_comment', { text: 'Thanks @{from} for {amount} {message}' }),
      task('u1', 'upvote_sender', { weight: 25 }),
    ])
    await call('alice', 'POST', '', { name: 'Thanks', definition, enabled: true })
    st.others.fan = [{ ...videoPost('fanvid', st.now - 3600 * 1000), author: 'fan' }]
    st.history = [[7, { timestamp: hiveTime(st.now + MIN), op: ['transfer', { from: 'fan', to: 'alice', amount: '3.000 HBD', memo: 'yay https://3speak.tv/watch?v=alice/cats' }] }]]
    await later(6)
    expect(st.broadcasts.map((b) => b.ops[0][0])).toEqual(['comment', 'vote'])
    expect(st.broadcasts[0].ops[0][1]).toMatchObject({ parent_author: 'alice', parent_permlink: 'cats', body: 'Thanks @fan for 3 yay' })
    expect(st.broadcasts[1].ops[0][1]).toEqual({ voter: 'alice', author: 'fan', permlink: 'fanvid', weight: 2500 })
    // The same transfer is never a second run.
    await later(6)
    expect(st.broadcasts).toHaveLength(2)
  })

  it('upvotes and reblogs new posts of the listed accounts only', async () => {
    const definition = { properties: { event: 'someone_posted', accounts: ['bob'] }, sequence: [
      ifStep('i1', { field: 'postKind', op: 'is', value: 'video' }, [task('v1', 'upvote_post', { weight: 10 }), task('r1', 'reblog')], []),
    ] }
    await call('alice', 'POST', '', { name: 'Friends', definition, enabled: true })
    st.others.bob = [{ ...videoPost('bobvid', st.now + MIN), author: 'bob' }, { author: 'bob', permlink: 'bobsnap', parent_author: 'peak.snaps', body: 'hi', created: hiveTime(st.now + MIN), json_metadata: '{}' }]
    st.others.carol = [{ ...videoPost('carolvid', st.now + MIN), author: 'carol' }]
    await later(6)
    expect(st.broadcasts.map((b) => b.ops[0][0])).toEqual(['vote', 'custom_json'])
    expect(st.broadcasts[0].ops[0][1]).toMatchObject({ voter: 'alice', author: 'bob', permlink: 'bobvid', weight: 1000 })
    expect(JSON.parse(st.broadcasts[1].ops[0][1].json)).toEqual(['reblog', { account: 'alice', author: 'bob', permlink: 'bobvid' }])
  })

  it('replies to an ended poll with its results', async () => {
    await call('alice', 'POST', '', { name: 'Results', definition: def('poll_ended', [task('c1', 'post_comment', { text: '{question}\n{results}' })]), enabled: true })
    st.polls = [{ status: 'Ended', author: 'alice', permlink: 'poll1', end_time: hiveTime(st.now + MIN), question: 'Tea?', poll_choices: [{ choice_num: 1, choice_text: 'Yes', votes: { total_votes: 1 } }] }]
    await later(6)
    expect(st.broadcasts[0].ops[0][1]).toMatchObject({ parent_author: 'alice', parent_permlink: 'poll1', body: 'Tea?\nYes: 1 (100%)' })
  })

  it('test-runs money events on example values when the wallet has none', async () => {
    const r = await call('alice', 'POST', '/test', { definition: def('power_up', [task('s1', 'post_snap', { text: 'Powered up {amount}!' }), task('u1', 'upvote_sender')]) })
    expect(r.body).toMatchObject({ sample: true, status: 'done' })
    expect(r.body.steps.s1.result.text).toBe('Powered up 5!')
    // The example sender (@badadib) has no post in the last week here.
    expect(r.body.steps.u1.result).toEqual({ skipped: 'no_recent_post' })
    expect(st.broadcasts).toHaveLength(0)
  })

  it('pauses workflows while the grant is gone, and shows why', async () => {
    const definition = def('video_published', [task('a1', 'post_comment', { text: 'Hi' })])
    await call('alice', 'POST', '', { name: 'Hi', definition, enabled: true })
    st.grant = false
    st.posts = [videoPost('nogrant', st.now + MIN)]
    await later(6)
    expect(st.broadcasts).toHaveLength(0)
    expect((await call('alice', 'GET', '')).body.workflows[0].problem).toBe('no_grant')
  })
})
