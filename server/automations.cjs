// 🤖 Automations (beta, Pro only): a creator's own workflows, "when this happens
// on my channel, do these things".
//
// The editor in the browser (src/page/Automations.jsx) is Sequential Workflow
// Designer; the runner here is sequential-workflow-machine, from the same
// authors and reading the same definition format. 3Speak only brings the parts
// that are ours: the events and tasks (automation-catalog.cjs), what the tasks
// do (automation-tasks.cjs), and this file, which keeps the workflows, watches
// the creators' posts and runs what they set up.
//
// How a run starts: every INTERVAL_MIN this server reads the newest posts and
// replies of each creator with a workflow switched on (bridge.get_account_posts),
// and every post it has not seen, made after the workflow was switched on and in
// the last day, is matched to the events (classifyPost). Each match queues a run
// with a copy of the workflow as it was then. Runs go one at a time; a task that
// has to wait (a video still encoding) puts its run back with a later `nextAt`,
// and the tasks it already did are not done again.
//
// Closed beta: AUTOMATIONS_ENABLED=true on the server, and the account must be
// Pro and on the team list or AUTOMATIONS_BETA_USERS. Workflows are kept per
// environment (AUTOMATIONS_ENV, else IMPORT_BATCH_ENV), so preview and prod never
// both act on the same post. No Mongo configured = kept in memory (tests).

const crypto = require('crypto')
const swm = require('sequential-workflow-machine')
const catalog = require('./automation-catalog.cjs')
const { HANDLERS } = require('./automation-tasks.cjs')

const ENABLED = process.env.AUTOMATIONS_ENABLED === 'true'
const ENV = process.env.AUTOMATIONS_ENV || process.env.IMPORT_BATCH_ENV || 'preview'
const INTERVAL_MIN = Math.max(2, Number(process.env.AUTOMATIONS_INTERVAL_MIN) || 5)
const TEAM = ['badadib', 'meno', 'tibfox', 'coolmole']
const BETA = new Set([...TEAM, ...String(process.env.AUTOMATIONS_BETA_USERS || '').split(',')].map((u) => u.trim().toLowerCase()).filter(Boolean))
const MONGO_URI = process.env.AUTOMATIONS_MONGODB_URI || process.env.MONGODB_URI || ''
const MONGO_DB = process.env.AUTOMATIONS_DATABASE_NAME || process.env.DATABASE_NAME || ''

const MAX_WORKFLOWS = 10
const MAX_RUNS_PER_DAY = 50
const MAX_AGE_MS = 24 * 3600 * 1000
// A run that waits (video still encoding, Discord busy) tries again this often,
// this many times in all: about two hours.
const RETRY_MS = 10 * 60 * 1000
const MAX_ATTEMPTS = 12
const SEEN_MAX = 300
const RUNS_KEPT = 30
const ID_RE = /^[a-z0-9]{12}$/
const USER_RE = /^[a-z0-9][a-z0-9.-]{1,15}$/

const newId = () => crypto.randomBytes(9).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '0').slice(0, 12)

// ── Store ────────────────────────────────────────────────────────────────────
function memoryStore() {
  const workflows = new Map()
  const runs = new Map()
  const state = new Map()
  return {
    ready: Promise.resolve(true),
    async listWorkflows(q) { return [...workflows.values()].filter((w) => w.env === ENV && (!q.user || w.user === q.user) && (q.enabled === undefined || w.enabled === q.enabled)) },
    async getWorkflow(id) { return workflows.get(id) || null },
    async putWorkflow(doc) { workflows.set(doc._id, doc); return doc },
    async deleteWorkflow(id) { workflows.delete(id) },
    async getState(user) { return state.get(`${ENV}|${user}`) || null },
    async putState(doc) { state.set(doc._id, doc) },
    async addRun(doc) { runs.set(doc._id, doc); return doc },
    async updateRun(id, patch) { const r = runs.get(id); if (r) Object.assign(r, patch) },
    async listRuns(workflowId, limit) { return [...runs.values()].filter((r) => r.workflowId === workflowId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, limit) },
    async dueRuns(now, limit) { return [...runs.values()].filter((r) => r.env === ENV && ['queued', 'waiting'].includes(r.status) && r.nextAt <= now).sort((a, b) => a.nextAt - b.nextAt).slice(0, limit) },
    async countRunsSince(user, since) { return [...runs.values()].filter((r) => r.env === ENV && r.user === user && r.createdAt >= since).length },
    async pruneRuns(workflowId, keep) { const old = (await this.listRuns(workflowId, 1000)).slice(keep); for (const r of old) if (!['queued', 'waiting'].includes(r.status)) runs.delete(r._id) },
  }
}

function mongoStore() {
  let cols = null
  const ready = (async () => {
    const { MongoClient } = require('mongodb')
    const client = new MongoClient(MONGO_URI, { maxPoolSize: 2, serverSelectionTimeoutMS: 20000 })
    await client.connect()
    const db = client.db(MONGO_DB || undefined)
    cols = { workflows: db.collection('automations'), runs: db.collection('automation-runs'), state: db.collection('automation-state') }
    await cols.workflows.createIndex({ env: 1, user: 1 }, { name: 'env_user' }).catch(() => {})
    await cols.workflows.createIndex({ env: 1, enabled: 1 }, { name: 'env_enabled' }).catch(() => {})
    await cols.runs.createIndex({ env: 1, status: 1, nextAt: 1 }, { name: 'env_due' }).catch(() => {})
    await cols.runs.createIndex({ workflowId: 1, createdAt: -1 }, { name: 'workflow_recent' }).catch(() => {})
    await cols.runs.createIndex({ env: 1, user: 1, createdAt: -1 }, { name: 'env_user_recent' }).catch(() => {})
    return true
  })().catch((e) => {
    console.error(`[automations] could not open the store, automations are OFF until a restart: ${e.message}`)
    return false
  })
  const c = () => {
    if (!cols) throw Object.assign(new Error('Automations are not available right now'), { status: 503, code: 'unavailable' })
    return cols
  }
  return {
    ready,
    async listWorkflows(q) {
      const f = { env: ENV }
      if (q.user) f.user = q.user
      if (q.enabled !== undefined) f.enabled = q.enabled
      return c().workflows.find(f).sort({ createdAt: 1 }).limit(2000).toArray()
    },
    async getWorkflow(id) { return c().workflows.findOne({ _id: id }) },
    async putWorkflow(doc) { await c().workflows.replaceOne({ _id: doc._id }, doc, { upsert: true }); return doc },
    async deleteWorkflow(id) { await c().workflows.deleteOne({ _id: id }) },
    async getState(user) { return c().state.findOne({ _id: `${ENV}|${user}` }) },
    async putState(doc) { await c().state.replaceOne({ _id: doc._id }, doc, { upsert: true }) },
    async addRun(doc) { await c().runs.insertOne(doc); return doc },
    async updateRun(id, patch) { await c().runs.updateOne({ _id: id }, { $set: patch }) },
    async listRuns(workflowId, limit) { return c().runs.find({ workflowId }).sort({ createdAt: -1 }).limit(limit).toArray() },
    async dueRuns(now, limit) { return c().runs.find({ env: ENV, status: { $in: ['queued', 'waiting'] }, nextAt: { $lte: now } }).sort({ nextAt: 1 }).limit(limit).toArray() },
    async countRunsSince(user, since) { return c().runs.countDocuments({ env: ENV, user, createdAt: { $gte: since } }) },
    async pruneRuns(workflowId, keep) {
      const old = await c().runs.find({ workflowId, status: { $nin: ['queued', 'waiting'] } }, { projection: { _id: 1 } }).sort({ createdAt: -1 }).skip(keep).toArray()
      if (old.length) await c().runs.deleteMany({ _id: { $in: old.map((r) => r._id) } })
    },
  }
}

// ── Shapes for the browser ───────────────────────────────────────────────────
const publicWorkflow = (w) => ({
  id: w.id, name: w.name, definition: w.definition, enabled: !!w.enabled, enabledAt: w.enabledAt || null,
  createdAt: w.createdAt, updatedAt: w.updatedAt, lastRun: w.lastRun || null, problem: w.problem || null,
})
const publicRun = (r) => ({
  id: r._id, status: r.status, createdAt: r.createdAt, finishedAt: r.finishedAt || null, attempts: r.attempts || 0,
  error: r.error || null, post: { author: r.event.author, permlink: r.event.permlink, title: r.event.values.title || '', url: r.event.values.url },
  steps: r.steps || {},
})

// Values for a test run when the creator has no post of that kind yet.
const SAMPLE = {
  title: 'My new video', description: 'What this video is about.', tags: ['threespeak', 'hive'], duration: 245,
  community: 'hive-181335', platform: 'youtube', kind: 'video', audioType: 'podcast', imported: 'no',
}

// ── Running a workflow ───────────────────────────────────────────────────────
/**
 * Runs `definition` for one event. `steps` carries what earlier attempts did
 * (step id → { status, result, data }); `persist(steps)` is called after each
 * step. → { status: 'done' | 'failed' | 'waiting', steps, error? }
 */
function execute({ definition, event, user, marker, steps = {}, dryRun = false, persist = async () => {}, deps }) {
  const state = { steps: { ...steps } }
  const save = async () => { if (!dryRun) await persist(state.steps) }

  const tasks = Object.keys(catalog.TASKS).map((type) => swm.createAtomActivityFromHandler(type, async (step, g) => {
    const before = g.steps[step.id]
    if (before?.status === 'done') return
    const ctx = {
      user,
      marker,
      dryRun,
      saved: before?.data || null,
      save: async (data) => { g.steps[step.id] = { ...(g.steps[step.id] || {}), status: 'running', data }; await save() },
    }
    try {
      const result = await HANDLERS[type](step, event, ctx, deps)
      g.steps[step.id] = { status: 'done', at: new Date().toISOString(), result, ...(g.steps[step.id]?.data ? { data: g.steps[step.id].data } : {}) }
      await save()
    } catch (e) {
      g.steps[step.id] = { ...(g.steps[step.id] || {}), status: e.retry ? 'waiting' : 'failed', at: new Date().toISOString(), error: String(e.message || e).slice(0, 300), code: e.code || null }
      await save()
      throw e
    }
  }))
  const ifStep = swm.createForkActivity(catalog.IF_TYPE, {
    init: () => ({}),
    handler: async (step, g) => {
      const yes = catalog.testCondition(step.properties, event.values)
      g.steps[step.id] = { status: 'done', at: new Date().toISOString(), branch: yes ? 'yes' : 'no' }
      await save()
      return swm.branchName(yes ? 'yes' : 'no')
    },
  })
  const machine = swm.createWorkflowMachineBuilder(swm.createActivitySet([...tasks, ifStep])).build(definition)

  return new Promise((resolve) => {
    const it = machine.create({ init: () => state })
    it.onDone(() => {
      const snap = it.getSnapshot()
      if (!snap.isFailed()) return resolve({ status: 'done', steps: state.steps })
      const failedId = snap.unhandledError?.stepId
      const waiting = failedId && state.steps[failedId]?.status === 'waiting'
      resolve({ status: waiting ? 'waiting' : 'failed', steps: state.steps, error: String(snap.unhandledError?.message || 'failed').slice(0, 300) })
    })
    it.start()
  })
}

// ── Mount ────────────────────────────────────────────────────────────────────
/**
 * deps: resolveUser(req, res), limiter, isPro(user), hasPostingGrant(user),
 *   hiveCall(method, params), the task deps (automation-tasks.cjs): broadcast,
 *   snapsContainer, indexSnap, videoSource, uploadImage, mintUploadToken,
 *   tusUpload, commissionEncode, buildPost, scheduleOnChecker,
 *   signScheduledPost, fetch; store? (tests), now? (tests), timers? (false = none)
 */
function mountAutomations(app, deps) {
  const store = deps.store || (MONGO_URI ? mongoStore() : memoryStore())
  const enabled = deps.enabled ?? ENABLED
  const now = deps.now || (() => Date.now())
  const mw = deps.limiter ? [deps.limiter] : []
  const taskDeps = { fetch: (...a) => fetch(...a), ...deps }

  const isTester = (user) => BETA.has(user) || (deps.betaUsers || []).includes(user)
  // A tester without Pro can skip the Pro check for their own account (the
  // button on the page's "Pro feature" notice), so the beta can be tried
  // without paying. Kept in the account's automation-state, read by the routes
  // and by the post watcher alike; only accounts in the beta can set it.
  const proSkipped = async (user) => isTester(user) && !!(await store.getState(user).catch(() => null))?.skipPro
  const hasPro = async (user) => (await deps.isPro(user)) || proSkipped(user)

  // Signed in, in the beta, the store open. `pro: false` lets a tester without
  // Pro through (to set the skip).
  async function gate(req, res, { pro = true } = {}) {
    if (!enabled) { res.status(503).json({ error: 'Automations are not available on this server', errorCode: 'unavailable' }); return null }
    const user = String((await deps.resolveUser(req, res)) || '').toLowerCase()
    if (!user || !USER_RE.test(user)) { res.status(401).json({ error: 'Sign in first', errorCode: 'sign_in' }); return null }
    if (!isTester(user)) { res.status(403).json({ error: 'Automations are in a closed beta', errorCode: 'not_in_beta' }); return null }
    if (!(await store.ready)) { res.status(503).json({ error: 'Automations are not available right now', errorCode: 'unavailable' }); return null }
    if (pro && !(await hasPro(user))) { res.status(403).json({ error: 'Automations are a 3Speak Pro feature', errorCode: 'pro_required', canSkip: true }); return null }
    return user
  }
  const fail = (res, e) => {
    if (!e.status) console.warn('[automations]', e.message)
    res.status(e.status || 500).json(e.status ? { error: e.message, errorCode: e.code } : { error: 'Something went wrong' })
  }
  const own = async (user, id) => {
    if (!ID_RE.test(id)) return null
    const w = await store.getWorkflow(`${ENV}|${user}|${id}`)
    return w && w.user === user ? w : null
  }
  const badDefinition = (res, v) => res.status(400).json({ error: 'This workflow cannot be saved', errorCode: v.error, stepId: v.stepId || null, property: v.property || null })

  app.get('/api/automations', ...mw, async (req, res) => {
    const user = await gate(req, res); if (!user) return
    try {
      const [workflows, grant, pro] = await Promise.all([store.listWorkflows({ user }), deps.hasPostingGrant(user).catch(() => false), deps.isPro(user)])
      res.json({
        catalog: catalog.publicCatalog(), workflows: workflows.map(publicWorkflow), grant, intervalMin: INTERVAL_MIN, maxWorkflows: MAX_WORKFLOWS,
        // Here without Pro: the tester skipped the check (the page says so).
        proSkipped: !pro,
      })
    } catch (e) { fail(res, e) }
  })

  // A tester skips the Pro check for their account, or takes it back (DELETE).
  async function setSkip(req, res, on) {
    const user = await gate(req, res, { pro: false }); if (!user) return
    try {
      const st = (await store.getState(user)) || { _id: `${ENV}|${user}`, env: ENV, user, seen: [] }
      await store.putState({ ...st, skipPro: on, skipProAt: on ? new Date(now()).toISOString() : null })
      console.log(`[automations] @${user} ${on ? 'skipped' : 'restored'} the Pro check (tester)`)
      res.json({ ok: true, proSkipped: on })
    } catch (e) { fail(res, e) }
  }
  app.post('/api/automations/skip-pro', ...mw, (req, res) => setSkip(req, res, true))
  app.delete('/api/automations/skip-pro', ...mw, (req, res) => setSkip(req, res, false))

  async function save(req, res, prev) {
    const user = prev.user
    const body = req.body || {}
    const name = String(body.name ?? prev.name ?? '').trim().slice(0, catalog.LIMITS.name)
    if (!name) return res.status(400).json({ error: 'Give the workflow a name', errorCode: 'no_name' })
    const v = catalog.validateDefinition(body.definition ?? prev.definition)
    if (v.error) return badDefinition(res, v)
    const on = body.enabled === undefined ? !!prev.enabled : body.enabled === true
    if (on && !(await deps.hasPostingGrant(user))) return res.status(403).json({ error: 'Allow 3Speak to publish for you first', errorCode: 'no_grant' })
    const at = new Date(now()).toISOString()
    const doc = {
      ...prev, name, definition: v.definition, enabled: on,
      // Switching on is the line: only posts after it start runs.
      enabledAt: on ? (prev.enabled ? prev.enabledAt : at) : null,
      problem: on && !prev.enabled ? null : prev.problem || null,
      updatedAt: at,
    }
    await store.putWorkflow(doc)
    res.json({ workflow: publicWorkflow(doc) })
  }

  app.post('/api/automations', ...mw, async (req, res) => {
    const user = await gate(req, res); if (!user) return
    try {
      if ((await store.listWorkflows({ user })).length >= MAX_WORKFLOWS) return res.status(409).json({ error: `At most ${MAX_WORKFLOWS} workflows`, errorCode: 'over_limit' })
      const id = newId()
      await save(req, res, { _id: `${ENV}|${user}|${id}`, id, env: ENV, user, enabled: false, createdAt: new Date(now()).toISOString() })
    } catch (e) { fail(res, e) }
  })

  app.put('/api/automations/:id', ...mw, async (req, res) => {
    const user = await gate(req, res); if (!user) return
    try {
      const prev = await own(user, req.params.id)
      if (!prev) return res.status(404).json({ error: 'No such workflow', errorCode: 'not_found' })
      await save(req, res, prev)
    } catch (e) { fail(res, e) }
  })

  app.delete('/api/automations/:id', ...mw, async (req, res) => {
    const user = await gate(req, res); if (!user) return
    try {
      const prev = await own(user, req.params.id)
      if (!prev) return res.status(404).json({ error: 'No such workflow', errorCode: 'not_found' })
      await store.deleteWorkflow(prev._id)
      res.json({ ok: true })
    } catch (e) { fail(res, e) }
  })

  app.get('/api/automations/:id/runs', ...mw, async (req, res) => {
    const user = await gate(req, res); if (!user) return
    try {
      const w = await own(user, req.params.id)
      if (!w) return res.status(404).json({ error: 'No such workflow', errorCode: 'not_found' })
      res.json({ runs: (await store.listRuns(w._id, 20)).map(publicRun) })
    } catch (e) { fail(res, e) }
  })

  // A test run of the definition in the body (the editor's, saved or not) on the
  // creator's newest post of that kind, or on example values when there is none.
  // Nothing is posted: every task only says what it would do.
  app.post('/api/automations/test', ...mw, async (req, res) => {
    const user = await gate(req, res); if (!user) return
    try {
      const v = catalog.validateDefinition(req.body?.definition)
      if (v.error) return badDefinition(res, v)
      const want = v.definition.properties.event
      const posts = await recentPosts(user).catch(() => [])
      let event = null
      for (const p of posts) {
        const c = catalog.classifyPost(p)
        if (c && c.events.includes(want)) { event = { author: p.author, permlink: p.permlink, values: { ...c.values } }; break }
      }
      const sample = !event
      if (sample) {
        const kind = catalog.EVENTS[want].media
        event = { author: user, permlink: 'example', values: { ...SAMPLE, author: user, url: kind === 'audio' ? `https://3speak.tv/audio/${user}/example` : `https://3speak.tv/watch?v=${user}/example` } }
      }
      const out = await execute({ definition: v.definition, event, user, marker: { test: true }, dryRun: true, deps: taskDeps })
      res.json({ sample, post: { author: event.author, permlink: event.permlink, title: event.values.title, url: event.values.url }, status: out.status, error: out.error || null, steps: out.steps })
    } catch (e) { fail(res, e) }
  })

  // ── Watching posts ─────────────────────────────────────────────────────────
  async function recentPosts(user) {
    const [posts, replies] = await Promise.all([
      deps.hiveCall('bridge.get_account_posts', { sort: 'posts', account: user, limit: 10 }),
      deps.hiveCall('bridge.get_account_posts', { sort: 'comments', account: user, limit: 20 }),
    ])
    return [...(posts || []), ...(replies || [])]
      .filter((p) => p && p.author === user)
      .sort((a, b) => (a.created < b.created ? 1 : -1))
  }

  async function checkUser(user, workflows) {
    // A problem shows on the workflow's card until a check passes again.
    const problem = !(await deps.hasPostingGrant(user).catch(() => true)) ? 'no_grant'
      : !(await hasPro(user).catch(() => true)) ? 'pro_required' : null
    for (const w of workflows) if ((w.problem || null) !== problem) await store.putWorkflow({ ...w, problem })
    if (problem) return
    const st = (await store.getState(user)) || { _id: `${ENV}|${user}`, env: ENV, user, seen: [] }
    const seen = new Set(st.seen)
    const t = now()
    let fresh = 0
    for (const post of (await recentPosts(user)).reverse()) {
      const ref = `${post.author}/${post.permlink}`
      const created = Date.parse(`${String(post.created).replace(/Z$/, '')}Z`)
      if (seen.has(ref) || !(created > t - MAX_AGE_MS)) continue
      seen.add(ref)
      fresh += 1
      const c = catalog.classifyPost(post)
      if (!c) continue
      for (const w of workflows) {
        if (!c.events.includes(w.definition.properties.event)) continue
        if (!(created >= Date.parse(w.enabledAt))) continue
        if ((await store.countRunsSince(user, new Date(t - 24 * 3600 * 1000).toISOString())) >= MAX_RUNS_PER_DAY) {
          console.warn(`[automations] @${user} reached ${MAX_RUNS_PER_DAY} runs today, ${ref} skipped`)
          continue
        }
        await store.addRun({
          _id: newId(), env: ENV, user, workflowId: w._id, workflowName: w.name,
          definition: w.definition,
          event: { author: post.author, permlink: post.permlink, created: new Date(created).toISOString(), events: c.events, values: c.values },
          status: 'queued', steps: {}, attempts: 0, nextAt: t, createdAt: new Date(t).toISOString(),
        })
        console.log(`[automations] @${user} ${ref} → "${w.name}"`)
      }
    }
    if (fresh) await store.putState({ ...st, seen: [...seen].slice(-SEEN_MAX) })
  }

  async function runOne(run) {
    const w = await store.getWorkflow(run.workflowId)
    if (!w || !w.enabled) {
      await store.updateRun(run._id, { status: 'cancelled', finishedAt: new Date(now()).toISOString() })
      return
    }
    const attempts = (run.attempts || 0) + 1
    await store.updateRun(run._id, { status: 'running', attempts })
    const out = await execute({
      definition: run.definition, event: run.event, user: run.user,
      marker: { workflow: w.id, run: run._id }, steps: run.steps,
      persist: (steps) => store.updateRun(run._id, { steps }),
      deps: taskDeps,
    })
    const at = new Date(now()).toISOString()
    let status = out.status
    if (status === 'waiting' && attempts >= MAX_ATTEMPTS) status = 'failed'
    await store.updateRun(run._id, {
      status, steps: out.steps, error: out.error || null,
      ...(status === 'waiting' ? { nextAt: now() + RETRY_MS } : { finishedAt: at }),
    })
    if (status !== 'waiting') {
      const fresh = await store.getWorkflow(w._id)
      if (fresh) await store.putWorkflow({ ...fresh, lastRun: { at, status, runId: run._id } })
      await store.pruneRuns(w._id, RUNS_KEPT).catch(() => {})
    }
    console.log(`[automations] @${run.user} "${w.name}" on ${run.event.author}/${run.event.permlink}: ${status}${out.error ? ` (${out.error})` : ''}`)
  }

  let lastPoll = 0
  let busy = false
  async function tick() {
    if (busy || !enabled || !(await store.ready)) return
    busy = true
    try {
      if (now() - lastPoll >= INTERVAL_MIN * 60 * 1000) {
        lastPoll = now()
        const byUser = new Map()
        for (const w of await store.listWorkflows({ enabled: true })) {
          if (!byUser.has(w.user)) byUser.set(w.user, [])
          byUser.get(w.user).push(w)
        }
        for (const [user, list] of byUser) {
          if (!BETA.has(user) && !(deps.betaUsers || []).includes(user)) continue
          await checkUser(user, list).catch((e) => console.warn(`[automations] @${user} check: ${e.message}`))
        }
      }
      for (const run of await store.dueRuns(now(), 10)) {
        await runOne(run).catch((e) => console.warn(`[automations] run ${run._id}: ${e.message}`))
      }
    } catch (e) {
      console.warn('[automations] tick:', e.message)
    } finally {
      busy = false
    }
  }

  if (enabled && deps.timers !== false) {
    setTimeout(tick, 60 * 1000).unref()
    setInterval(tick, 60 * 1000).unref()
    console.log(`[automations] ON (${ENV}), looking every ${INTERVAL_MIN} min`)
  } else if (!enabled) {
    console.log('[automations] OFF (AUTOMATIONS_ENABLED is not true)')
  }

  return { tick, store, execute }
}

module.exports = { mountAutomations, execute, memoryStore, ENV }
