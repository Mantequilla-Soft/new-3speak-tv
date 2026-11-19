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

  it('ignores posts an automation made, ordinary replies and text posts', () => {
    expect(catalog.classifyPost(videoPost('a1', at, { [catalog.MARKER]: { workflow: 'x' } }))).toBeNull()
    expect(catalog.classifyPost({ ...videoPost('r1', at), parent_author: 'bob' })).toBeNull()
    expect(catalog.classifyPost({ ...videoPost('t1', at), json_metadata: '{"app":"peakd"}' })).toBeNull()
    expect(catalog.classifyPost({ ...videoPost('t2', at), json_metadata: 'not json' })).toBeNull()
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
      hiveCall: async (method, params) => (params.sort === 'posts' ? st.posts.filter((p) => !p.parent_author) : st.posts.filter((p) => p.parent_author)),
      broadcast: async (user, ops) => { st.broadcasts.push({ user, ops }) },
      snapsContainer: async () => ({ author: 'peak.snaps', permlink: 'snaps-container' }),
      indexSnap: async () => ({}),
      videoSource: async () => st.source,
      fetch: async (url, init) => { st.discord.push({ url, body: JSON.parse(init.body) }); return { ok: st.discordStatus < 300, status: st.discordStatus } },
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
    st.posts = [{ ...videoPost('carolvid', st.now + MIN), author: 'carol' }]
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
