/**
 * Community translation editor backend: /api/i18n/*.
 *
 * Translators (Hive accounts listed in TRANSLATORS) edit interface strings in the
 * app at /translate. Their edits are stored here as an OVERLAY on top of the
 * bundled src/locales/<lang>/*.json files, served live to every visitor through
 * GET /api/i18n/overlay/:lang, and (when GITHUB_TRANSLATIONS_TOKEN is set)
 * mirrored into ONE pull request so the bundled files catch up in review.
 *
 *   GET  /api/i18n/me               { user, translator }   (never the allowlist)
 *   GET  /api/i18n/overlay/:lang    flat { "watch.title": "…" }, public, ETag
 *   GET  /api/i18n/languages        community-added languages, public
 *   GET  /api/i18n/source           flat English source the server validates against
 *   PUT  /api/i18n/strings/:lang    { changes: { key: value | null } }   translator
 *   POST /api/i18n/languages        { code, native, english, dir? }       translator
 *   GET  /api/i18n/proofread/:lang  { marks: { key: { by, at, hash } } }  translator
 *   PUT  /api/i18n/proofread/:lang  { marks: { key: { checked, hash } } } translator
 *
 * Proofreading: most strings were machine-translated, so translators tick each
 * one they have checked. A mark stores proofHash() of the exact text they saw;
 * the CLIENT compares it with the text it shows now, so a mark goes stale on its
 * own when the text changes (a new bundled file, another edit). Saving a string
 * marks it (a human wrote it); resetting it removes the mark. Marks never go into
 * the GitHub pull request.
 *
 * Security model (see also the report in the PR):
 *   - Identity is PROVEN only: ButrAuth cookie, SIWH wallet-session cookie, or a
 *     HiveSigner bearer verified with hivesigner.com (resolveProvenViewer in
 *     index.cjs). The legacy public app key + claimed username never reaches here.
 *   - Every write re-checks the username against TRANSLATORS. Empty ⇒ disabled.
 *   - Cookies are the credential, so writes need an allowed Origin AND
 *     Content-Type: application/json (a cross-site form cannot send either).
 *   - Every value is validated against the English source with the same rules as
 *     scripts/i18n/check.mjs plus markup checks; a batch is all-or-nothing.
 *   - Per-user write budget, IP budget, body/batch caps, append-only audit log.
 *
 * Storage: MongoDB only when I18N_STORE=mongo AND I18N_MONGODB_URI (or
 * MONGODB_URI) is set AND the `mongodb` driver is installed; otherwise JSON
 * files in I18N_DATA_DIR. (Opt-in since 2026-10-05: the driver was installed for
 * the batch importer, and switching silently would hide every saved edit.)
 * (default server/data/i18n, gitignored). Both keep the same record kinds:
 * i18n_strings, i18n_history (append-only), i18n_languages, i18n_proofread
 * (files: proofread/<lang>.json, { key: { by, at, hash } }).
 */

const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const crypto = require('crypto')
const express = require('express')
const cookieParser = require('cookie-parser')
const rateLimit = require('express-rate-limit')
const rules = require('./i18n-rules.cjs')

const { LANG_CODE_RE, flatten, pluralCategories, validateBatch, validateKey, validateLanguageName, proofHash, PLURAL_SUFFIX } = rules

const HIVE_USER_RE = /^[a-z][a-z0-9.-]{2,15}$/
const MAX_BATCH = 200
const MAX_PROOF_BATCH = 500
const PROOF_HASH_RE = /^[0-9a-f]{16,64}$/
// Ticking is one write per click (batched ~600ms in the client), so it gets its
// own, larger budget instead of eating the string-save budget.
const PROOF_WRITE_LIMIT = 300
const BODY_LIMIT = '256kb'
const USER_WRITE_LIMIT = 60
const USER_WRITE_WINDOW_MS = 10 * 60 * 1000
const SOURCE_RECHECK_MS = 60 * 1000
const MAX_COMMUNITY_LANGUAGES = 50
const SYNC_DEBOUNCE_MS = 2 * 60 * 1000
const SYNC_RETRY_MS = 10 * 60 * 1000
const GITHUB_API = 'https://api.github.com' // the token is never sent anywhere else

const log = (...a) => console.log('[i18n]', ...a)
const warn = (...a) => console.warn('[i18n]', ...a)
const has = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k)

function parseTranslators (raw) {
  return new Set(String(raw || '').split(',').map((s) => s.trim().toLowerCase().replace(/^@/, ''))
    .filter((s) => HIVE_USER_RE.test(s)))
}

// ---- English source + bundled language list (read from the checkout) ---------

function createSourceReader (rootDir) {
  const enDir = path.join(rootDir, 'src/locales/en')
  const langFile = path.join(rootDir, 'src/i18n/languages.js')
  let checkedAt = 0
  let signature = ''
  let english = Object.create(null)
  let areas = []
  let bundled = new Set()

  function refresh () {
    const now = Date.now()
    if (now - checkedAt < SOURCE_RECHECK_MS && signature) return
    checkedAt = now
    try {
      const files = fs.readdirSync(enDir).filter((f) => f.endsWith('.json')).sort()
      const sig = files.map((f) => `${f}:${fs.statSync(path.join(enDir, f)).mtimeMs}`).join('|') +
        `|languages.js:${fs.statSync(langFile).mtimeMs}`
      if (sig === signature) return
      const next = Object.create(null)
      for (const f of files) {
        const area = f.replace(/\.json$/, '')
        const data = JSON.parse(fs.readFileSync(path.join(enDir, f), 'utf8'))
        Object.assign(next, flatten(data, area))
      }
      const langSrc = fs.readFileSync(langFile, 'utf8')
      bundled = new Set([...langSrc.matchAll(/code:\s*'([\w-]+)'/g)].map((m) => m[1]))
      english = next
      areas = files.map((f) => f.replace(/\.json$/, ''))
      signature = sig
      log(`English source loaded: ${Object.keys(english).length} strings in ${areas.length} areas, ${bundled.size} bundled languages`)
    } catch (err) {
      // Keep serving the last good copy; a half-written file mid-deploy is transient.
      warn('could not (re)load the English source:', err.message)
    }
  }

  return {
    english () { refresh(); return english },
    bundledLanguages () { refresh(); return bundled }
  }
}

// ---- Storage --------------------------------------------------------------------

function fileStore (dir) {
  const stringsFile = path.join(dir, 'i18n_strings.json')
  const languagesFile = path.join(dir, 'i18n_languages.json')
  const historyFile = path.join(dir, 'i18n_history.jsonl')
  const proofDir = path.join(dir, 'proofread')
  let strings = []
  let languages = []
  let proofread = new Map() // lang -> { key: { by, at, hash } }

  async function readJson (file, fallback) {
    try { return JSON.parse(await fsp.readFile(file, 'utf8')) } catch (e) {
      if (e.code === 'ENOENT') return fallback
      throw e
    }
  }
  // Write-then-rename so a crash mid-write never leaves a truncated file.
  async function writeJson (file, data) {
    const tmp = `${file}.${process.pid}.tmp`
    await fsp.writeFile(tmp, JSON.stringify(data), { mode: 0o600 })
    await fsp.rename(tmp, file)
  }

  return {
    kind: `file (${dir})`,
    async init () {
      await fsp.mkdir(dir, { recursive: true, mode: 0o700 })
      await fsp.mkdir(proofDir, { recursive: true, mode: 0o700 })
      strings = await readJson(stringsFile, [])
      languages = await readJson(languagesFile, [])
      proofread = new Map()
      for (const f of await fsp.readdir(proofDir)) {
        const lang = f.replace(/\.json$/, '')
        if (f === lang || !LANG_CODE_RE.test(lang)) continue
        const data = await readJson(path.join(proofDir, f), {})
        if (data && typeof data === 'object' && !Array.isArray(data)) proofread.set(lang, data)
      }
    },
    async loadAll () {
      const marks = []
      for (const [lang, m] of proofread) for (const [key, d] of Object.entries(m)) marks.push({ lang, key, ...d })
      return { strings, languages, proofread: marks }
    },
    async applyProofread (lang, sets, deletes, history) {
      const next = { ...(proofread.get(lang) || {}) }
      for (const key of deletes) delete next[key]
      for (const d of sets) next[d.key] = { by: d.by, at: d.at, hash: d.hash }
      await writeJson(path.join(proofDir, `${lang}.json`), next)
      proofread.set(lang, next)
      if (history.length) await fsp.appendFile(historyFile, history.map((h) => JSON.stringify(h)).join('\n') + '\n', { mode: 0o600 })
    },
    async applyBatch (lang, sets, deletes, history) {
      const del = new Set(deletes)
      const byKey = new Map(sets.map((d) => [d.key, d]))
      const next = []
      for (const d of strings) {
        if (d.lang !== lang) { next.push(d); continue }
        if (del.has(d.key)) continue
        if (byKey.has(d.key)) { next.push(byKey.get(d.key)); byKey.delete(d.key) } else next.push(d)
      }
      for (const d of byKey.values()) next.push(d)
      await writeJson(stringsFile, next)
      strings = next
      if (history.length) await fsp.appendFile(historyFile, history.map((h) => JSON.stringify(h)).join('\n') + '\n', { mode: 0o600 })
    },
    async addLanguage (doc, historyEntry) {
      if (languages.some((l) => l.code === doc.code)) throw Object.assign(new Error('exists'), { code: 'EXISTS' })
      const next = [...languages, doc]
      await writeJson(languagesFile, next)
      languages = next
      await fsp.appendFile(historyFile, JSON.stringify(historyEntry) + '\n', { mode: 0o600 })
    }
  }
}

function mongoStore (uri, dbName) {
  // Optional dependency: only required when a Mongo URI is configured.
  const { MongoClient } = require('mongodb')
  const client = new MongoClient(uri, { maxPoolSize: 5, serverSelectionTimeoutMS: 8000 })
  let col
  return {
    kind: 'mongodb',
    shared: true, // other processes may write the same collections
    async init () {
      await client.connect()
      const db = dbName ? client.db(dbName) : client.db()
      col = {
        strings: db.collection('i18n_strings'),
        history: db.collection('i18n_history'),
        languages: db.collection('i18n_languages'),
        proofread: db.collection('i18n_proofread')
      }
      await col.strings.createIndex({ lang: 1, key: 1 }, { unique: true })
      await col.languages.createIndex({ code: 1 }, { unique: true })
      await col.proofread.createIndex({ lang: 1, key: 1 }, { unique: true })
      await col.history.createIndex({ lang: 1, key: 1, at: -1 })
    },
    async loadAll () {
      const [strings, languages, proofread] = await Promise.all([
        col.strings.find({}, { projection: { _id: 0 } }).toArray(),
        col.languages.find({}, { projection: { _id: 0 } }).toArray(),
        col.proofread.find({}, { projection: { _id: 0 } }).toArray()
      ])
      return { strings, languages, proofread }
    },
    async applyProofread (lang, sets, deletes, history) {
      const ops = [
        ...deletes.map((key) => ({ deleteOne: { filter: { lang, key } } })),
        ...sets.map((d) => ({ updateOne: { filter: { lang, key: d.key }, update: { $set: { lang, key: d.key, by: d.by, at: d.at, hash: d.hash } }, upsert: true } }))
      ]
      if (ops.length) await col.proofread.bulkWrite(ops, { ordered: true })
      if (history.length) await col.history.insertMany(history.map((h) => ({ ...h })))
    },
    async applyBatch (lang, sets, deletes, history) {
      const ops = [
        ...sets.map((d) => ({ updateOne: { filter: { lang, key: d.key }, update: { $set: d }, upsert: true } })),
        ...deletes.map((key) => ({ deleteOne: { filter: { lang, key } } }))
      ]
      if (ops.length) await col.strings.bulkWrite(ops, { ordered: true })
      if (history.length) await col.history.insertMany(history.map((h) => ({ ...h })))
    },
    async addLanguage (doc, historyEntry) {
      try {
        await col.languages.insertOne({ ...doc })
      } catch (e) {
        if (e && e.code === 11000) throw Object.assign(new Error('exists'), { code: 'EXISTS' })
        throw e
      }
      await col.history.insertOne({ ...historyEntry })
    }
  }
}

function createStore () {
  const uri = process.env.I18N_MONGODB_URI || process.env.MONGODB_URI
  if (uri && process.env.I18N_STORE === 'mongo') {
    try {
      require.resolve('mongodb')
      return mongoStore(uri, process.env.I18N_DATABASE_NAME || process.env.DATABASE_NAME || '')
    } catch {
      warn('a Mongo URI is set but the `mongodb` driver is not installed in server/; using the file store')
    }
  }
  return fileStore(process.env.I18N_DATA_DIR || path.join(__dirname, 'data', 'i18n'))
}

// ---- GitHub pull-request sync ----------------------------------------------------

// Rebuild nesting in ENGLISH order (same as scripts/i18n/translate.mjs nestLike),
// so a language file diffs line-for-line against en.
function nestLike (enObj, flat, prefix = '') {
  const out = {}
  for (const [k, v] of Object.entries(enObj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object') {
      const child = nestLike(v, flat, key)
      if (Object.keys(child).length) out[k] = child
    } else if (PLURAL_SUFFIX.test(k)) {
      if (!k.endsWith('_other')) continue
      const base = k.replace(PLURAL_SUFFIX, '')
      for (const c of ['zero', 'one', 'two', 'few', 'many', 'other']) {
        const fk = `${prefix ? `${prefix}.` : ''}${base}_${c}`
        if (has(flat, fk)) out[`${base}_${c}`] = flat[fk]
      }
    } else if (has(flat, key)) out[k] = flat[key]
  }
  return out
}

const jsQuote = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

/** Insert one language line before the closing `];` of LANGUAGES, in the file's style. */
function addLanguageLine (src, lang) {
  if (new RegExp(`code:\\s*'${lang.code}'`).test(src)) return src
  const start = src.indexOf('export const LANGUAGES')
  const close = start >= 0 ? src.indexOf('\n];', start) : -1
  if (close < 0) throw new Error('could not find the LANGUAGES array in languages.js')
  const line = `  { code: ${jsQuote(lang.code)}, native: ${jsQuote(lang.native)}, english: ${jsQuote(lang.english)}` +
    `${lang.dir === 'rtl' ? ", dir: 'rtl'" : ''} },`
  return `${src.slice(0, close)}\n${line}${src.slice(close)}`
}

function createGithubSync ({ snapshot }) {
  const token = process.env.GITHUB_TRANSLATIONS_TOKEN || ''
  const repo = process.env.GITHUB_TRANSLATIONS_REPO || 'Mantequilla-Soft/new-3speak-tv'
  const base = process.env.GITHUB_TRANSLATIONS_BASE || 'develop'
  const branch = process.env.GITHUB_TRANSLATIONS_BRANCH || 'community-translations'
  const refOk = (b) => /^[\w][\w./-]{0,99}$/.test(b) && !b.includes('..') && !b.endsWith('/') && !b.endsWith('.lock')
  if (!token) return { enabled: false, schedule () {} }
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !refOk(base) || !refOk(branch) || base === branch) {
    warn('GitHub sync disabled: GITHUB_TRANSLATIONS_REPO / _BASE / _BRANCH is malformed')
    return { enabled: false, schedule () {} }
  }
  const owner = repo.split('/')[0]

  async function gh (method, pathname, body, { allow404 = false } = {}) {
    const res = await fetch(GITHUB_API + pathname, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': '3speak-translations',
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      // Never follow a redirect: the Authorization header must not travel.
      redirect: 'error',
      signal: AbortSignal.timeout(20000)
    })
    if (allow404 && res.status === 404) return null
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const err = new Error(`GitHub ${method} ${pathname.split('?')[0]} → ${res.status} ${data && data.message ? data.message : ''}`.trim())
      err.status = res.status
      throw err
    }
    return data
  }

  const enc = (p) => p.split('/').map(encodeURIComponent).join('/')
  async function getFile (filePath, ref) {
    const data = await gh('GET', `/repos/${repo}/contents/${enc(filePath)}?ref=${ref}`, null, { allow404: true })
    if (!data) return null
    if (data.type !== 'file' || typeof data.content !== 'string') throw new Error(`${filePath} is not a file`)
    return Buffer.from(data.content, 'base64').toString('utf8')
  }

  async function sync () {
    const { strings, languages } = snapshot()
    const byLang = new Map()
    for (const d of strings) {
      if (!byLang.has(d.lang)) byLang.set(d.lang, [])
      byLang.get(d.lang).push(d)
    }
    if (!byLang.size) { log('GitHub sync: overlay is empty, nothing to propose'); return }

    const baseSha = (await gh('GET', `/repos/${repo}/git/ref/heads/${base}`)).object.sha
    const baseTree = (await gh('GET', `/repos/${repo}/git/commits/${baseSha}`)).tree.sha

    const enCache = new Map()
    const files = []
    const stats = []
    const contributors = new Set()
    let total = 0
    for (const [lang, docs] of [...byLang.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const areas = new Map()
      for (const d of docs) {
        const area = d.key.split('.')[0]
        if (!areas.has(area)) areas.set(area, [])
        areas.get(area).push(d)
      }
      let count = 0
      for (const [area, entries] of [...areas.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        if (!enCache.has(area)) {
          const raw = await getFile(`src/locales/en/${area}.json`, baseSha)
          enCache.set(area, raw ? JSON.parse(raw) : null)
        }
        const enObj = enCache.get(area)
        if (!enObj) continue // area no longer exists on the base branch
        const enFlat = flatten(enObj)
        const filePath = `src/locales/${lang}/${area}.json`
        const raw = await getFile(filePath, baseSha)
        const flat = flatten(raw ? JSON.parse(raw) : {}, '', Object.create(null))
        for (const d of entries) {
          const rel = d.key.slice(area.length + 1)
          const plural = rel.match(PLURAL_SUFFIX)
          // Only keys English on the base branch still has; nestLike drops the rest.
          if (!has(enFlat, rel) && !(plural && has(enFlat, rel.replace(PLURAL_SUFFIX, '_other')))) continue
          flat[rel] = d.value
          count++
          if (d.updatedBy) contributors.add(d.updatedBy)
        }
        const content = `${JSON.stringify(nestLike(enObj, flat), null, 2)}\n`
        if (content !== raw) files.push({ path: filePath, content })
      }
      if (count) { stats.push({ lang, count }); total += count }
    }

    // Community-added languages need their line in languages.js, but only once
    // they have a folder, or check.mjs fails ("listed but folder missing").
    const synced = new Set(stats.map((s) => s.lang))
    const newLangs = languages.filter((l) => synced.has(l.code))
    if (newLangs.length) {
      const src = await getFile('src/i18n/languages.js', baseSha)
      if (src) {
        let next = src
        for (const l of newLangs) next = addLanguageLine(next, l)
        if (next !== src) files.push({ path: 'src/i18n/languages.js', content: next })
      }
    }

    if (!files.length) { log('GitHub sync: base branch already has every overlay string'); return }

    const tree = []
    for (const f of files) {
      const blob = await gh('POST', `/repos/${repo}/git/blobs`, { content: f.content, encoding: 'utf-8' })
      tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha })
    }
    const newTree = (await gh('POST', `/repos/${repo}/git/trees`, { base_tree: baseTree, tree })).sha

    const existing = await gh('GET', `/repos/${repo}/git/ref/heads/${branch}`, null, { allow404: true })
    let upToDate = false
    if (existing && existing.object && existing.object.sha) {
      const head = await gh('GET', `/repos/${repo}/git/commits/${existing.object.sha}`)
      upToDate = head.tree.sha === newTree && head.parents.length === 1 && head.parents[0].sha === baseSha
    }
    const langList = stats.map((s) => s.lang).join(', ')
    if (!upToDate) {
      const who = { name: '3Speak Translations', email: 'translations@3speak.tv', date: new Date().toISOString() }
      const commit = await gh('POST', `/repos/${repo}/git/commits`, {
        message: `i18n: community translations (${total} strings, ${langList})`,
        tree: newTree,
        parents: [baseSha],
        author: who,
        committer: who
      })
      // Rebuilt from the CURRENT base every time: the overlay is the source of
      // truth, so the branch never drifts from base or conflicts with it.
      if (existing) await gh('PATCH', `/repos/${repo}/git/refs/heads/${branch}`, { sha: commit.sha, force: true })
      else await gh('POST', `/repos/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: commit.sha })
    }

    const body = [
      'Translations edited by the community in the 3Speak app (`/translate`). This branch is rebuilt automatically from the live overlay after each round of edits, so please do not push to it by hand.',
      '',
      '| Language | Strings |',
      '| --- | --- |',
      ...stats.map((s) => `| ${s.lang} | ${s.count} |`),
      '',
      newLangs.length ? `New languages: ${newLangs.map((l) => `${l.code} (${l.english})`).join(', ')}\n` : '',
      // Backticks, not @: a GitHub @mention would ping an unrelated GitHub user.
      `Contributors (Hive accounts): ${[...contributors].sort().map((u) => `\`${u}\``).join(', ') || 'n/a'}`,
      '',
      'Run `npm run i18n:check` before merging.'
    ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n')

    const open = await gh('GET', `/repos/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}&base=${encodeURIComponent(base)}`)
    if (Array.isArray(open) && open.length) {
      await gh('PATCH', `/repos/${repo}/pulls/${open[0].number}`, { body })
      log(`GitHub sync: ${upToDate ? 'branch already current' : 'branch rebuilt'}, PR #${open[0].number} updated (${total} strings, ${files.length} files)`)
    } else {
      const pr = await gh('POST', `/repos/${repo}/pulls`, { title: 'Community translations', head: branch, base, body })
      log(`GitHub sync: opened PR #${pr.number} (${total} strings, ${files.length} files)`)
    }
  }

  let timer = null
  let running = false
  let again = false
  function schedule (delay = SYNC_DEBOUNCE_MS) {
    if (running) { again = true; return }
    clearTimeout(timer)
    timer = setTimeout(run, delay)
  }
  async function run () {
    timer = null
    running = true
    again = false
    let failed = false
    try {
      await sync()
    } catch (err) {
      failed = true
      warn('GitHub sync failed (will retry):', err.message)
    } finally {
      running = false
    }
    if (again) schedule()
    else if (failed && !timer) schedule(SYNC_RETRY_MS)
  }
  log(`GitHub PR sync enabled: ${repo} ${branch} → ${base}`)
  return { enabled: true, schedule, syncNow: sync }
}

// ---- Router ----------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {(req, res) => Promise<string|null>} opts.resolveUser  PROVEN Hive username only
 * @param {string[]} opts.allowedOrigins  Origins allowed to WRITE (the CORS list)
 * @param {string} [opts.rootDir]  Checkout root holding src/locales and src/i18n
 */
function createI18nRouter ({ resolveUser, allowedOrigins, rootDir = path.join(__dirname, '..') }) {
  if (typeof resolveUser !== 'function') throw new Error('createI18nRouter: resolveUser is required')
  const translators = parseTranslators(process.env.TRANSLATORS)
  const origins = new Set((allowedOrigins || []).filter(Boolean))
  const source = createSourceReader(rootDir)
  const store = createStore()

  // In-memory copy of the overlay: lang -> Map(key -> doc). The data set is a few
  // thousand short strings at most, so it lives in RAM and every read is free.
  let ready = false
  let strings = new Map()
  let languages = []
  let proofread = new Map() // lang -> Map(key -> { by, at, hash })
  const overlayCache = new Map() // lang -> { body, etag }

  function loadSnapshot ({ strings: docs, languages: langs, proofread: marks }) {
    const next = new Map()
    for (const d of docs) {
      if (!d || typeof d.lang !== 'string' || typeof d.key !== 'string' || typeof d.value !== 'string') continue
      if (!next.has(d.lang)) next.set(d.lang, new Map())
      next.get(d.lang).set(d.key, { lang: d.lang, key: d.key, value: d.value, updatedBy: d.updatedBy, updatedAt: d.updatedAt })
    }
    strings = next
    languages = (langs || []).filter((l) => l && LANG_CODE_RE.test(l.code))
      .map((l) => ({ code: l.code, native: l.native, english: l.english, dir: l.dir === 'rtl' ? 'rtl' : 'ltr', addedBy: l.addedBy, addedAt: l.addedAt }))
    const nextMarks = new Map()
    for (const d of marks || []) {
      if (!d || typeof d.lang !== 'string' || typeof d.key !== 'string' || typeof d.hash !== 'string') continue
      if (!nextMarks.has(d.lang)) nextMarks.set(d.lang, new Map())
      nextMarks.get(d.lang).set(d.key, { by: d.by, at: d.at, hash: d.hash })
    }
    proofread = nextMarks
    overlayCache.clear()
  }

  // One write (or Mongo refresh) at a time, so a batch is applied whole and the
  // memory copy and the store never interleave.
  let chain = Promise.resolve()
  const serial = (fn) => {
    const p = chain.then(fn)
    chain = p.catch(() => {})
    return p
  }

  const snapshot = () => ({
    strings: [...strings.values()].flatMap((m) => [...m.values()]),
    languages: languages.slice()
  })
  const github = createGithubSync({ snapshot })

  ;(async function init (attempt = 1) {
    try {
      await store.init()
      loadSnapshot(await store.loadAll())
      ready = true
      const n = [...strings.values()].reduce((a, m) => a + m.size, 0)
      log(`store: ${store.kind}; ${n} overlay strings, ${languages.length} community languages; ${translators.size ? `${translators.size} translator(s)` : 'editing DISABLED (TRANSLATORS empty)'}`)
      if (n) github.schedule()
      if (store.shared) {
        // Another process (e.g. the other API instance) may write the same collections.
        setInterval(() => {
          serial(async () => loadSnapshot(await store.loadAll()))
            .catch((e) => warn('overlay refresh failed:', e.message))
        }, 60 * 1000).unref()
      }
    } catch (err) {
      warn(`store init failed (attempt ${attempt}): ${err.message}`)
      setTimeout(() => init(attempt + 1), Math.min(300000, 15000 * attempt)).unref()
    }
  })()

  const communityCodes = () => new Set(languages.map((l) => l.code))
  const isTargetLanguage = (lang) => lang !== 'en' && (source.bundledLanguages().has(lang) || communityCodes().has(lang))

  // Inside serial(): write marks for one language, then mirror them in memory.
  async function writeMarks (lang, sets, deletes, history) {
    if (!sets.length && !deletes.length) return
    await store.applyProofread(lang, sets, deletes, history)
    const m = proofread.get(lang) || new Map()
    for (const k of deletes) m.delete(k)
    for (const d of sets) m.set(d.key, { by: d.by, at: d.at, hash: d.hash })
    if (m.size) proofread.set(lang, m)
    else proofread.delete(lang)
  }
  const markOut = (d) => ({ by: d.by, at: d.at instanceof Date ? d.at.toISOString() : d.at, hash: d.hash })

  function overlayFor (lang) {
    let hit = overlayCache.get(lang)
    if (!hit) {
      const m = strings.get(lang)
      const flat = {}
      if (m) for (const k of [...m.keys()].sort()) flat[k] = m.get(k).value
      const body = JSON.stringify(flat)
      hit = { body, etag: `W/"${crypto.createHash('sha1').update(body).digest('base64url').slice(0, 27)}"` }
      overlayCache.set(lang, hit)
    }
    return hit
  }

  // ---- middleware ----
  const makeBudget = (limit) => {
    const userHits = new Map() // user -> [timestamps]
    return function userBudget (req, res, next) {
      const now = Date.now()
      const list = (userHits.get(req.translator) || []).filter((t) => now - t < USER_WRITE_WINDOW_MS)
      if (list.length >= limit) {
        res.set('Retry-After', String(Math.ceil((USER_WRITE_WINDOW_MS - (now - list[0])) / 1000)))
        return res.status(429).json({ error: 'Too many saves, please wait a few minutes' })
      }
      list.push(now)
      userHits.set(req.translator, list)
      if (userHits.size > 1000) for (const [u, l] of userHits) if (!l.some((t) => now - t < USER_WRITE_WINDOW_MS)) userHits.delete(u)
      next()
    }
  }
  const userBudget = makeBudget(USER_WRITE_LIMIT)
  const proofBudget = makeBudget(PROOF_WRITE_LIMIT)

  // CSRF: the session cookies are the credential, so a write must come from one
  // of our own pages (Origin) and be a JSON request, which a cross-site HTML form
  // cannot produce. Both are required; a missing Origin is refused.
  function csrfGuard (req, res, next) {
    const origin = req.get('origin')
    if (!origin || !origins.has(origin)) return res.status(403).json({ error: 'Origin not allowed' })
    if (!req.is('application/json')) return res.status(415).json({ error: 'Content-Type must be application/json' })
    next()
  }

  async function requireTranslator (req, res, next) {
    try {
      if (!translators.size) return res.status(403).json({ error: 'Translation editing is not enabled' })
      const user = await resolveUser(req, res)
      if (!user) return res.status(401).json({ error: 'Sign in required' })
      const u = String(user).toLowerCase()
      if (!translators.has(u)) return res.status(403).json({ error: 'This account is not a translator' })
      req.translator = u
      next()
    } catch (err) {
      warn('auth check failed:', err.message)
      res.status(500).json({ error: 'Internal error' })
    }
  }

  const requireReady = (req, res, next) => (ready ? next() : res.status(503).set('Cache-Control', 'no-store').json({ error: 'Not ready, try again shortly' }))

  const router = express.Router()
  router.use(cookieParser())
  router.use(rateLimit({
    windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many requests' }
  }))
  const jsonBody = express.json({ limit: BODY_LIMIT, strict: true })
  const writeChain = [csrfGuard, requireReady, requireTranslator, userBudget, jsonBody]
  const proofWriteChain = [csrfGuard, requireReady, requireTranslator, proofBudget, jsonBody]

  router.get('/me', async (req, res) => {
    res.set('Cache-Control', 'no-store')
    let user = null
    try { user = await resolveUser(req, res) } catch { user = null }
    user = user ? String(user).toLowerCase() : null
    res.json({ user, translator: !!(user && translators.has(user)) })
  })

  // Menu hint only: "is this Hive name a translator?" so the app can show the
  // Translate entry before a wallet user has proven their account (that proof is
  // asked for on /translate). Grants nothing: every write still requires a PROVEN
  // identity in TRANSLATORS. Answers one name at a time, never the list.
  router.get('/translator/:user', (req, res) => {
    const u = String(req.params.user || '').toLowerCase()
    res.set('Cache-Control', 'private, max-age=300')
    res.json({ translator: HIVE_USER_RE.test(u) && translators.has(u) })
  })

  router.get('/overlay/:lang', requireReady, (req, res) => {
    const { lang } = req.params
    if (!LANG_CODE_RE.test(lang)) return res.status(400).json({ error: 'Invalid language code' })
    const { body, etag } = overlayFor(lang)
    res.set('Cache-Control', 'public, max-age=60')
    res.set('ETag', etag)
    res.type('json').send(body) // express answers 304 itself when If-None-Match matches
  })

  router.get('/languages', requireReady, (req, res) => {
    res.set('Cache-Control', 'public, max-age=60')
    res.json(languages.map(({ code, native, english, dir }) => ({ code, native, english, dir })))
  })

  // Public: it is the same English text the app bundles anyway.
  router.get('/source', (req, res) => {
    res.set('Cache-Control', 'public, max-age=300')
    res.json(source.english())
  })

  router.put('/strings/:lang', ...writeChain, async (req, res) => {
    const { lang } = req.params
    if (!LANG_CODE_RE.test(lang) || lang === 'en') return res.status(400).json({ error: 'Invalid language' })
    if (!isTargetLanguage(lang)) return res.status(404).json({ error: 'Unknown language' })
    const changes = req.body && req.body.changes
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return res.status(400).json({ error: 'Expected { changes: { key: value | null } }' })
    const keys = Object.keys(changes)
    if (!keys.length) return res.status(400).json({ error: 'No changes' })
    if (keys.length > MAX_BATCH) return res.status(400).json({ error: `At most ${MAX_BATCH} changes per request` })

    const en = source.english()
    if (!Object.keys(en).length) return res.status(503).json({ error: 'English source unavailable' })
    try {
      const result = await serial(async () => {
        const current = strings.get(lang) || new Map()
        const existing = Object.fromEntries([...current.entries()].map(([k, d]) => [k, d.value]))
        const { errors, sets, deletes } = validateBatch(changes, en, pluralCategories(lang), existing)
        if (Object.keys(errors).length) return { errors }

        const at = new Date()
        const by = req.translator
        const setDocs = []
        const history = []
        for (const [key, value] of Object.entries(sets)) {
          const old = has(existing, key) ? existing[key] : null
          if (old === value) continue // unchanged: no write, no audit noise
          setDocs.push({ lang, key, value, updatedBy: by, updatedAt: at })
          history.push({ lang, key, old, new: value, by, at })
        }
        for (const key of deletes) history.push({ lang, key, old: existing[key], new: null, by, at })
        if (!setDocs.length && !deletes.length) return { saved: 0, removed: 0 }

        await store.applyBatch(lang, setDocs, deletes, history)
        const m = strings.get(lang) || new Map()
        for (const d of setDocs) m.set(d.key, d)
        for (const k of deletes) m.delete(k)
        if (m.size) strings.set(lang, m)
        else strings.delete(lang)
        overlayCache.delete(lang)

        // A human wrote these, so they count as proofread; a reset goes back to
        // the bundled (machine) text, so its mark goes. The string save above is
        // the audit record; a failure here must not fail the save.
        const marks = {}
        const proofSets = setDocs.map((d) => ({ key: d.key, by, at, hash: proofHash(d.value) }))
        const had = proofread.get(lang) || new Map()
        const proofDeletes = deletes.filter((k) => had.has(k))
        try {
          await writeMarks(lang, proofSets, proofDeletes, [])
          for (const d of proofSets) marks[d.key] = markOut(d)
        } catch (err) {
          warn(`auto proofread marks failed for lang=${lang}:`, err.message)
        }
        return { saved: setDocs.length, removed: deletes.length, marks, unmarked: deletes }
      })
      if (result.errors) {
        log(`rejected save by @${req.translator}: lang=${lang} keys=${keys.length} errors=${Object.keys(result.errors).length}`)
        return res.status(400).json({ errors: result.errors })
      }
      log(`save by @${req.translator}: lang=${lang} saved=${result.saved} removed=${result.removed}`)
      if (result.saved || result.removed) github.schedule()
      res.json({ ok: true, ...result })
    } catch (err) {
      warn(`save failed for @${req.translator} lang=${lang}:`, err.message)
      res.status(500).json({ error: 'Could not save, please try again' })
    }
  })

  router.post('/languages', ...writeChain, async (req, res) => {
    const b = req.body || {}
    const errors = {}
    const code = typeof b.code === 'string' ? b.code.trim() : ''
    if (!LANG_CODE_RE.test(code)) errors.code = 'Use a 2-3 letter ISO code, optionally with a region (pt-BR)'
    else if (code === 'en' || source.bundledLanguages().has(code)) errors.code = 'This language already exists'
    else if (communityCodes().has(code)) errors.code = 'This language was already added'
    const nativeErr = validateLanguageName(b.native)
    if (nativeErr) errors.native = nativeErr
    const englishErr = validateLanguageName(b.english)
    if (englishErr) errors.english = englishErr
    const dir = b.dir === undefined || b.dir === null || b.dir === '' ? 'ltr' : b.dir
    if (dir !== 'ltr' && dir !== 'rtl') errors.dir = 'Must be ltr or rtl'
    if (Object.keys(errors).length) return res.status(400).json({ errors })
    if (languages.length >= MAX_COMMUNITY_LANGUAGES) return res.status(400).json({ error: 'Too many community languages' })

    const at = new Date()
    const doc = { code, native: b.native.trim(), english: b.english.trim(), dir, addedBy: req.translator, addedAt: at }
    try {
      await serial(async () => {
        if (communityCodes().has(code)) throw Object.assign(new Error('exists'), { code: 'EXISTS' })
        await store.addLanguage(doc, { lang: code, key: '@language', old: null, new: `${doc.native} / ${doc.english} (${dir})`, by: req.translator, at })
        languages = [...languages, doc]
      })
      log(`language added by @${req.translator}: ${code}`)
      res.status(201).json({ language: { code, native: doc.native, english: doc.english, dir } })
    } catch (err) {
      if (err.code === 'EXISTS') return res.status(400).json({ errors: { code: 'This language was already added' } })
      warn(`language add failed for @${req.translator}:`, err.message)
      res.status(500).json({ error: 'Could not add the language, please try again' })
    }
  })

  // ---- proofreading ----
  // 'en' is the source, so there is nothing to proofread; unknown codes are 404.
  function proofLang (req, res) {
    const { lang } = req.params
    if (!LANG_CODE_RE.test(lang)) { res.status(400).json({ error: 'Invalid language' }); return null }
    if (lang === 'en') { res.status(400).json({ error: 'English is the source and is not proofread' }); return null }
    if (!isTargetLanguage(lang)) { res.status(404).json({ error: 'Unknown language' }); return null }
    return lang
  }

  router.get('/proofread/:lang', requireReady, requireTranslator, (req, res) => {
    res.set('Cache-Control', 'no-store')
    const lang = proofLang(req, res)
    if (!lang) return
    const marks = {}
    const m = proofread.get(lang)
    if (m) for (const k of [...m.keys()].sort()) marks[k] = markOut(m.get(k))
    res.json({ marks })
  })

  router.put('/proofread/:lang', ...proofWriteChain, async (req, res) => {
    res.set('Cache-Control', 'no-store')
    const lang = proofLang(req, res)
    if (!lang) return
    const input = req.body && req.body.marks
    if (!input || typeof input !== 'object' || Array.isArray(input)) return res.status(400).json({ error: 'Expected { marks: { key: { checked, hash } } }' })
    const keys = Object.keys(input)
    if (!keys.length) return res.status(400).json({ error: 'No changes' })
    if (keys.length > MAX_PROOF_BATCH) return res.status(400).json({ error: `At most ${MAX_PROOF_BATCH} marks per request` })
    const en = source.english()
    if (!Object.keys(en).length) return res.status(503).json({ error: 'English source unavailable' })

    const categories = pluralCategories(lang)
    const errors = {}
    for (const key of keys) {
      const e = input[key]
      const keyErr = validateKey(key, en, categories)
      if (keyErr) errors[key] = keyErr
      else if (!e || typeof e !== 'object' || Array.isArray(e) || typeof e.checked !== 'boolean') errors[key] = 'Expected { checked: true | false, hash }'
      else if ((e.checked || e.hash !== undefined) && (typeof e.hash !== 'string' || !PROOF_HASH_RE.test(e.hash))) errors[key] = 'Invalid hash'
    }
    if (Object.keys(errors).length) {
      log(`rejected proofread by @${req.translator}: lang=${lang} keys=${keys.length} errors=${Object.keys(errors).length}`)
      return res.status(400).json({ errors })
    }

    try {
      const result = await serial(async () => {
        const current = proofread.get(lang) || new Map()
        const at = new Date()
        const by = req.translator
        const sets = []
        const deletes = []
        const history = []
        for (const key of keys) {
          const { checked, hash } = input[key]
          const old = current.get(key)
          if (checked) {
            if (old && old.hash === hash) continue // already marked for this text
            sets.push({ key, by, at, hash })
            history.push({ type: 'proofread', lang, key, old: old ? old.hash : null, new: hash, by, at })
          } else if (old) {
            deletes.push(key)
            history.push({ type: 'proofread', lang, key, old: old.hash, new: null, by, at })
          }
        }
        await writeMarks(lang, sets, deletes, history)
        const marks = {}
        for (const key of keys) if (input[key].checked) marks[key] = markOut(proofread.get(lang).get(key))
        return { marked: sets.length, unmarked: deletes.length, marks }
      })
      log(`proofread by @${req.translator}: lang=${lang} marked=${result.marked} unmarked=${result.unmarked}`)
      res.json({ ok: true, ...result })
    } catch (err) {
      warn(`proofread failed for @${req.translator} lang=${lang}:`, err.message)
      res.status(500).json({ error: 'Could not save, please try again' })
    }
  })

  // Body-parser errors (too large, bad JSON) as JSON instead of the app-wide 500.
  // eslint-disable-next-line no-unused-vars
  router.use((err, req, res, next) => {
    if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' })
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' })
    warn('request failed:', err && err.message)
    res.status(500).json({ error: 'Internal error' })
  })

  return router
}

module.exports = { createI18nRouter, createGithubSync, nestLike, addLanguageLine, parseTranslators }
