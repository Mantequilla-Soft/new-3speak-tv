#!/usr/bin/env node
/**
 * Self-test for the translation editor: `node server/i18n-editor.test.cjs`.
 * No framework. Runs the validation cases through BOTH copies of the rules
 * (server/i18n-rules.cjs and src/i18n/rules.js) so they cannot drift apart, then
 * exercises the router in-process on a throwaway port with a temp data dir
 * (no .env is read, no GitHub token is used).
 */
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const { pathToFileURL } = require('url')

let passed = 0
let failed = 0
function check (name, fn) {
  try { fn(); passed++ } catch (e) { failed++; console.error(`✗ ${name}\n  ${e.message}`) }
}

const en = {
  'watch.title': 'Watch',
  'watch.sent': 'Sent {{amount}} to @{{user}}',
  'watch.terms': 'Read our <termsLink>terms</termsLink>',
  'watch.br': 'Line one<br/>line two',
  'comments.count_one': '{{count}} comment',
  'comments.count_other': '{{count}} comments',
  'common.plain': 'Hello'
}

const cases = [
  // [description, lang, key, value, expectOk]
  ['plain ok', 'es', 'watch.title', 'Ver', true],
  ['unknown key', 'es', 'watch.nope', 'x', false],
  ['proto key', 'es', '__proto__.x', 'x', false],
  ['constructor segment', 'es', 'watch.constructor', 'x', false],
  ['placeholders kept', 'es', 'watch.sent', 'Enviaste {{amount}} a @{{user}}', true],
  ['placeholder lost', 'es', 'watch.sent', 'Enviaste {{amount}}', false],
  ['placeholder renamed', 'es', 'watch.sent', 'Enviaste {{monto}} a @{{user}}', false],
  ['placeholder with format ok', 'es', 'watch.sent', 'Enviaste {{amount, number}} a @{{user}}', true],
  ['tag kept', 'es', 'watch.terms', 'Lee nuestros <termsLink>términos</termsLink>', true],
  ['tag dropped', 'es', 'watch.terms', 'Lee nuestros términos', false],
  ['tag added', 'es', 'watch.title', '<b>Ver</b>', false],
  ['tag with attribute', 'es', 'watch.terms', 'Lee <termsLink href="x">términos</termsLink>', false],
  ['self-closing br ok', 'es', 'watch.br', 'Línea uno<br/>línea dos', true],
  ['script tag', 'es', 'watch.title', '<script>alert(1)</script>', false],
  ['script tag with space', 'es', 'watch.title', '< script>alert(1)', false],
  ['javascript url', 'es', 'watch.title', 'javascript:alert(1)', false],
  ['event handler', 'es', 'watch.title', 'x onerror=alert(1)', false],
  ['img with handler', 'es', 'watch.title', '<img src=x onerror=alert(1)>', false],
  ['nested $t', 'es', 'watch.title', '$t(common.plain)', false],
  ['newline ok', 'es', 'watch.title', 'Ver\nahora', true],
  ['tab rejected', 'es', 'watch.title', 'Ver\tahora', false],
  ['null byte rejected', 'es', 'watch.title', 'Ver\u0000', false],
  ['empty rejected', 'es', 'watch.title', '   ', false],
  ['too long', 'es', 'watch.title', 'x'.repeat(2001), false],
  ['max length ok', 'es', 'watch.title', 'x'.repeat(2000), true],
  ['non-string', 'es', 'watch.title', 42, false],
  ['less-than sign ok', 'es', 'watch.title', 'Ver < 5 min', true],
  ['plural one ok (count dropped)', 'es', 'comments.count_one', 'un comentario', true],
  ['plural may drop count (as check.mjs)', 'es', 'comments.count_other', 'comentarios', true],
  ['plural keeps other placeholders', 'es', 'comments.count_other', '{{count}} {{x}}', false],
  ['plural other ok', 'es', 'comments.count_other', '{{count}} comentarios', true],
  ['polish few ok', 'pl', 'comments.count_few', '{{count}} komentarze', true],
  ['spanish few rejected', 'es', 'comments.count_few', '{{count}} x', false],
  ['japanese one rejected', 'ja', 'comments.count_one', '{{count}} 件', false],
  ['zero always allowed', 'ja', 'comments.count_zero', 'なし', true],
  ['plural of non-plural', 'es', 'watch.title_one', 'x', false],
  ['unknown lang one/other', 'qqq', 'comments.count_one', 'x', true],
  ['unknown lang few rejected', 'qqq', 'comments.count_few', 'x', false]
]

async function main () {
  const cjs = require('./i18n-rules.cjs')
  const esm = await import(pathToFileURL(path.join(__dirname, '../src/i18n/rules.js')).href)

  for (const [impl, R] of [['cjs', cjs], ['esm', esm]]) {
    for (const [desc, lang, key, value, ok] of cases) {
      check(`${impl}: ${desc}`, () => {
        const err = R.validateEntry(key, value, en, R.pluralCategories(lang))
        assert.strictEqual(err === null, ok, `expected ${ok ? 'ok' : 'error'}, got ${err === null ? 'ok' : err}`)
      })
    }
    check(`${impl}: batch is all-or-nothing`, () => {
      const r = R.validateBatch({ 'watch.title': 'Ver', 'watch.sent': 'nope' }, en, ['one', 'other'], {})
      assert.ok(r.errors['watch.sent'])
      assert.ok(!r.errors['watch.title'])
    })
    check(`${impl}: null deletes only existing keys`, () => {
      const r = R.validateBatch({ 'watch.title': null, 'watch.sent': null }, en, ['one', 'other'], { 'watch.title': 'Ver' })
      assert.deepStrictEqual(r.deletes, ['watch.title'])
      assert.deepStrictEqual(Object.keys(r.errors), [])
    })
    check(`${impl}: language names`, () => {
      assert.strictEqual(R.validateLanguageName('Nederlands'), null)
      assert.ok(R.validateLanguageName('<b>x</b>'))
      assert.ok(R.validateLanguageName('x'.repeat(41)))
      assert.ok(R.validateLanguageName(''))
      assert.ok(R.validateLanguageName("it's\\"))
    })
    check(`${impl}: validateKey`, () => {
      assert.strictEqual(R.validateKey('watch.title', en, ['one', 'other']), null)
      assert.strictEqual(R.validateKey('comments.count_few', en, ['one', 'few', 'many', 'other']), null)
      assert.ok(R.validateKey('comments.count_few', en, ['one', 'other']))
      assert.ok(R.validateKey('watch.nope', en, ['one', 'other']))
      assert.ok(R.validateKey('__proto__.x', en, ['one', 'other']))
    })
    check(`${impl}: lang code regex`, () => {
      for (const c of ['es', 'pt-BR', 'fil']) assert.ok(R.LANG_CODE_RE.test(c), c)
      for (const c of ['EN', 'pt-br', 'e', 'abcd', '../x', 'es_ES']) assert.ok(!R.LANG_CODE_RE.test(c), c)
    })
  }

  // proofHash: both copies agree with each other AND with a reference 64-bit
  // FNV-1a (BigInt over Buffer's UTF-8), including multi-byte and astral text.
  const fnvRef = (str) => {
    let h = 0xcbf29ce484222325n
    for (const b of Buffer.from(str, 'utf8')) { h ^= BigInt(b); h = (h * 0x100000001b3n) & 0xffffffffffffffffn }
    return h.toString(16).padStart(16, '0')
  }
  const hashInputs = ['', 'a', 'foobar', 'Watch', 'Ver ahora', 'Ünïcödé ß', '日本語のテキスト', '中文', '한국어', 'Русский',
    '😀🎉 emoji', '👩‍👩‍👧 family', 'line\nbreak', '{{count}} comments', '<termsLink>x</termsLink>', 'x'.repeat(2000), ' trailing ']
  check('proofHash: known FNV-1a vectors', () => {
    assert.strictEqual(cjs.proofHash(''), 'cbf29ce484222325')
    assert.strictEqual(cjs.proofHash('a'), 'af63dc4c8601ec8c')
    assert.strictEqual(cjs.proofHash('foobar'), '85944171f73967e8')
  })
  check('proofHash: cjs === esm === reference, 16 lowercase hex', () => {
    for (const s of hashInputs) {
      const h = cjs.proofHash(s)
      assert.ok(/^[0-9a-f]{16}$/.test(h), s)
      assert.strictEqual(esm.proofHash(s), h, s)
      assert.strictEqual(fnvRef(s), h, s)
    }
    assert.notStrictEqual(cjs.proofHash('Ver'), cjs.proofHash('Ver '))
  })

  // ---- PR helpers ----
  const { nestLike, addLanguageLine, parseTranslators } = require('./i18n-editor.cjs')
  check('nestLike keeps English order and plural forms', () => {
    const enObj = { b: 'B', a: { y: 'Y', x: 'X' }, n_one: '1', n_other: 'n' }
    const flat = Object.assign(Object.create(null), { 'a.x': 'x', b: 'b', n_few: 'f', n_other: 'o', stale: 's' })
    const out = nestLike(enObj, flat)
    assert.strictEqual(JSON.stringify(out), JSON.stringify({ b: 'b', a: { x: 'x' }, n_few: 'f', n_other: 'o' }))
  })
  check('addLanguageLine matches the file style and escapes quotes', () => {
    const src = "export const LANGUAGES = [\n  { code: 'en', native: 'English', english: 'English' },\n];\n\nexport const X = 1;\n"
    const out = addLanguageLine(src, { code: 'ar', native: "عربي'", english: 'Arabic', dir: 'rtl' })
    assert.ok(out.includes("  { code: 'ar', native: 'عربي\\'', english: 'Arabic', dir: 'rtl' },\n];"), out)
    assert.strictEqual(addLanguageLine(out, { code: 'ar', native: 'x', english: 'y' }), out)
  })
  check('parseTranslators', () => {
    assert.deepStrictEqual([...parseTranslators(' Alice ,@bob,, bad name,x')], ['alice', 'bob'])
  })
  check('real English source parses and languages.js is readable', () => {
    const dir = path.join(__dirname, '../src/locales/en')
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json'))) JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
  })

  await routerTests()
  await proofreadTests(cjs.proofHash)
  await githubTests()

  console.log(`\n${failed ? '✗' : '✓'} ${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

// ---- Router, in-process ----------------------------------------------------------
async function routerTests () {
  const express = require('express')
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-test-'))
  process.env.I18N_DATA_DIR = dataDir
  process.env.TRANSLATORS = 'alice'
  delete process.env.GITHUB_TRANSLATIONS_TOKEN
  delete process.env.I18N_MONGODB_URI
  delete process.env.MONGODB_URI
  const ORIGIN = 'https://3speak.tv'
  // The test "session" is a header; the real app uses resolveProvenViewer.
  const resolveUser = async (req) => req.get('x-test-user') || null
  const { createI18nRouter } = require('./i18n-editor.cjs')
  const app = express()
  app.use('/api/i18n', createI18nRouter({ resolveUser, allowedOrigins: [ORIGIN] }))
  const server = http.createServer(app)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}/api/i18n`
  await new Promise((r) => setTimeout(r, 100)) // store init

  const call = async (method, p, { user, origin = ORIGIN, body, type = 'application/json', headers = {} } = {}) => {
    const h = { ...headers }
    if (user) h['x-test-user'] = user
    if (origin) h.origin = origin
    if (body !== undefined) h['content-type'] = type
    const r = await fetch(base + p, { method, headers: h, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) })
    let data = null
    try { data = await r.json() } catch { /* 304 */ }
    return { status: r.status, data, headers: r.headers }
  }

  const results = []
  const t = (name, cond) => results.push([name, cond])
  try {
    let r = await call('GET', '/me', { user: 'alice' })
    t('/me translator', r.status === 200 && r.data.user === 'alice' && r.data.translator === true)
    r = await call('GET', '/me', { user: 'mallory' })
    t('/me non-translator', r.data.translator === false && !('translators' in r.data))
    r = await call('GET', '/me')
    t('/me anonymous', r.data.user === null && r.data.translator === false)

    r = await call('PUT', '/strings/es', { body: { changes: { 'common.actions.upload': 'Subir' } } })
    t('write without user → 401', r.status === 401)
    r = await call('PUT', '/strings/es', { user: 'mallory', body: { changes: { 'common.actions.upload': 'Subir' } } })
    t('write by non-translator → 403', r.status === 403)
    r = await call('PUT', '/strings/es', { user: 'alice', origin: 'https://evil.example', body: { changes: { x: 'y' } } })
    t('foreign origin → 403', r.status === 403)
    r = await call('PUT', '/strings/es', { user: 'alice', origin: null, body: { changes: { x: 'y' } } })
    t('missing origin → 403', r.status === 403)
    r = await call('PUT', '/strings/es', { user: 'alice', type: 'text/plain', body: { changes: { x: 'y' } } })
    t('text/plain → 415', r.status === 415)
    r = await call('PUT', '/strings/es', { user: 'alice', type: 'application/x-www-form-urlencoded', body: 'changes=x' })
    t('form post → 415', r.status === 415)

    const src = (await call('GET', '/source')).data
    const key = Object.keys(src).find((k) => !/\{\{|</.test(src[k]) && !/_(zero|one|two|few|many|other)$/.test(k))
    const keyWithVar = Object.keys(src).find((k) => /\{\{\w+\}\}/.test(src[k]) && !/_(zero|one|two|few|many|other)$/.test(k))
    t('source loaded', !!key && !!keyWithVar)

    r = await call('PUT', '/strings/es', { user: 'alice', body: { changes: { [key]: 'Hola', [keyWithVar]: 'sin variables' } } })
    t('bad batch → 400 with per-key errors, nothing applied', r.status === 400 && r.data.errors[keyWithVar] && !r.data.errors[key])
    r = await call('GET', '/overlay/es')
    t('overlay still empty after rejected batch', r.status === 200 && Object.keys(r.data).length === 0)

    r = await call('PUT', '/strings/es', { user: 'alice', body: { changes: { [key]: 'Hola' } } })
    t('good save', r.status === 200 && r.data.saved === 1)
    r = await call('GET', '/overlay/es')
    const etag = r.headers.get('etag')
    t('overlay has value + caching headers', r.data[key] === 'Hola' && !!etag && /max-age=60/.test(r.headers.get('cache-control')))
    // Raw http, not fetch: fetch turns a manual If-None-Match into Cache-Control:
    // no-cache, which (correctly) disables the 304. A browser revalidating its own
    // cache does not.
    const status304 = await new Promise((resolve, reject) => {
      http.get(`${base}/overlay/es`, { headers: { 'if-none-match': etag } }, (res) => { res.resume(); resolve(res.statusCode) }).on('error', reject)
    })
    t('overlay 304 on matching ETag', status304 === 304)
    r = await call('GET', '/overlay/..%2Fetc')
    t('bad lang → 400', r.status === 400)
    r = await call('PUT', '/strings/en', { user: 'alice', body: { changes: { [key]: 'x' } } })
    t('editing English refused', r.status === 400)
    r = await call('PUT', '/strings/xx', { user: 'alice', body: { changes: { [key]: 'x' } } })
    t('unknown language → 404', r.status === 404)

    const many = {}
    for (let i = 0; i < 201; i++) many[`${key}${i}`] = 'x'
    r = await call('PUT', '/strings/es', { user: 'alice', body: { changes: many } })
    t('201 changes → 400', r.status === 400)
    r = await call('PUT', '/strings/es', { user: 'alice', body: { changes: { [key]: 'x'.repeat(300 * 1024) } } })
    t('body > 256kb → 413', r.status === 413)

    r = await call('PUT', '/strings/es', { user: 'alice', body: { changes: { [key]: null } } })
    t('reset removes override', r.status === 200 && r.data.removed === 1)
    r = await call('GET', '/overlay/es')
    t('overlay empty after reset', Object.keys(r.data).length === 0)

    r = await call('POST', '/languages', { user: 'alice', body: { code: 'es', native: 'Español', english: 'Spanish' } })
    t('bundled language refused', r.status === 400 && r.data.errors.code)
    r = await call('POST', '/languages', { user: 'alice', body: { code: 'nl', native: '<b>NL</b>', english: 'Dutch', dir: 'up' } })
    t('bad language fields refused', r.status === 400 && r.data.errors.native && r.data.errors.dir)
    r = await call('POST', '/languages', { user: 'alice', body: { code: 'qx', native: 'Testish', english: 'Test', dir: 'rtl' } })
    t('language added', r.status === 201 && r.data.language.dir === 'rtl')
    r = await call('POST', '/languages', { user: 'alice', body: { code: 'qx', native: 'Testish', english: 'Test' } })
    t('duplicate language refused', r.status === 400)
    r = await call('GET', '/languages')
    t('languages lists it', Array.isArray(r.data) && r.data.some((l) => l.code === 'qx') && !('addedBy' in r.data[0]))
    r = await call('PUT', '/strings/qx', { user: 'alice', body: { changes: { [key]: 'Qx' } } })
    t('community language editable', r.status === 200 && r.data.saved === 1)

    const hist = fs.readFileSync(path.join(dataDir, 'i18n_history.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    t('history is appended', hist.length === 4 && hist.every((h) => h.by === 'alice'))

    // Rate limit: 60 writes / 10 min per user (11 used above that reached the budget).
    let last
    for (let i = 0; i < 60; i++) last = await call('PUT', '/strings/es', { user: 'alice', body: { changes: { [key]: `v${i}` } } })
    t('per-user write budget → 429', last.status === 429)
  } finally {
    server.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
  for (const [name, ok] of results) check(`router: ${name}`, () => assert.ok(ok))
}

// ---- Proofreading, on its own router (fresh rate-limit budgets and data dir) ----
async function proofreadTests (proofHash) {
  const express = require('express')
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-proof-test-'))
  process.env.I18N_DATA_DIR = dataDir
  process.env.TRANSLATORS = 'alice'
  const ORIGIN = 'https://3speak.tv'
  const resolveUser = async (req) => req.get('x-test-user') || null
  const { createI18nRouter } = require('./i18n-editor.cjs')
  const app = express()
  app.use('/api/i18n', createI18nRouter({ resolveUser, allowedOrigins: [ORIGIN] }))
  const server = http.createServer(app)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}/api/i18n`
  await new Promise((r) => setTimeout(r, 100))
  const call = async (method, p, { user, origin = ORIGIN, body, type = 'application/json' } = {}) => {
    const h = {}
    if (user) h['x-test-user'] = user
    if (origin) h.origin = origin
    if (body !== undefined) h['content-type'] = type
    const r = await fetch(base + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) })
    let data = null
    try { data = await r.json() } catch { /* empty */ }
    return { status: r.status, data, headers: r.headers }
  }
  const results = []
  const t = (name, cond) => results.push([name, cond])
  const H = 'abcdef0123456789'
  try {
    const src = (await call('GET', '/source')).data
    const key = Object.keys(src).find((k) => !/\{\{|</.test(src[k]) && !/_(zero|one|two|few|many|other)$/.test(k))
    const key2 = Object.keys(src).find((k) => k !== key && !/\{\{|</.test(src[k]) && !/_(zero|one|two|few|many|other)$/.test(k))
    const pluralBase = Object.keys(src).find((k) => k.endsWith('_other')).replace(/_other$/, '')

    // Auth / CSRF
    let r = await call('GET', '/proofread/es')
    t('GET without user → 401', r.status === 401)
    r = await call('GET', '/proofread/es', { user: 'mallory' })
    t('GET by non-translator → 403', r.status === 403)
    r = await call('GET', '/proofread/es', { user: 'alice' })
    t('GET empty marks, no-store', r.status === 200 && JSON.stringify(r.data) === '{"marks":{}}' && /no-store/.test(r.headers.get('cache-control')))
    const one = { marks: { [key]: { checked: true, hash: H } } }
    r = await call('PUT', '/proofread/es', { body: one })
    t('PUT without user → 401', r.status === 401)
    r = await call('PUT', '/proofread/es', { user: 'mallory', body: one })
    t('PUT by non-translator → 403', r.status === 403)
    r = await call('PUT', '/proofread/es', { user: 'alice', origin: 'https://evil.example', body: one })
    t('PUT foreign origin → 403', r.status === 403)
    r = await call('PUT', '/proofread/es', { user: 'alice', origin: null, body: one })
    t('PUT missing origin → 403', r.status === 403)
    r = await call('PUT', '/proofread/es', { user: 'alice', type: 'text/plain', body: one })
    t('PUT text/plain → 415', r.status === 415)

    // Languages
    r = await call('PUT', '/proofread/en', { user: 'alice', body: one })
    t('PUT en → 400', r.status === 400)
    r = await call('GET', '/proofread/en', { user: 'alice' })
    t('GET en → 400', r.status === 400)
    r = await call('PUT', '/proofread/xx', { user: 'alice', body: one })
    t('PUT unknown language → 404', r.status === 404)
    r = await call('PUT', '/proofread/..%2Fx', { user: 'alice', body: one })
    t('PUT bad code → 400', r.status === 400)

    // Validation, atomic batch
    r = await call('PUT', '/proofread/es', { user: 'alice', body: { marks: { [key]: { checked: true, hash: H }, 'watch.nope_nope': { checked: true, hash: H }, [key2]: { checked: true, hash: 'XYZ' } } } })
    t('bad key + bad hash → 400 per-key, good key not flagged', r.status === 400 && r.data.errors['watch.nope_nope'] && r.data.errors[key2] && !r.data.errors[key])
    r = await call('GET', '/proofread/es', { user: 'alice' })
    t('nothing applied after rejected batch', Object.keys(r.data.marks).length === 0)
    r = await call('PUT', '/proofread/es', { user: 'alice', body: { marks: { [key]: { checked: true, hash: 'abc' } } } })
    t('short hash → 400', r.status === 400)
    r = await call('PUT', '/proofread/es', { user: 'alice', body: { marks: { [key]: { checked: 'yes', hash: H } } } })
    t('non-boolean checked → 400', r.status === 400)
    r = await call('PUT', '/proofread/es', { user: 'alice', body: { marks: { '__proto__.x': { checked: true, hash: H } } } })
    t('proto key → 400', r.status === 400)
    r = await call('PUT', '/proofread/es', { user: 'alice', body: { marks: { [`${pluralBase}_few`]: { checked: true, hash: H } } } })
    t('plural form the language lacks → 400', r.status === 400)
    r = await call('PUT', '/proofread/pl', { user: 'alice', body: { marks: { [`${pluralBase}_few`]: { checked: true, hash: H } } } })
    t('Polish few form accepted', r.status === 200 && r.data.marked === 1)
    const many = {}
    for (let i = 0; i < 501; i++) many[`${key}${i}`] = { checked: true, hash: H }
    r = await call('PUT', '/proofread/es', { user: 'alice', body: { marks: many } })
    t('501 marks → 400', r.status === 400)

    // Mark, GET, unmark
    r = await call('PUT', '/proofread/es', { user: 'alice', body: { marks: { [key]: { checked: true, hash: H }, [key2]: { checked: true, hash: H } } } })
    t('good batch marked', r.status === 200 && r.data.marked === 2 && r.data.marks[key].by === 'alice' && r.data.marks[key].hash === H)
    r = await call('PUT', '/proofread/es', { user: 'alice', body: { marks: { [key]: { checked: true, hash: H } } } })
    t('re-tick same hash is a no-op', r.status === 200 && r.data.marked === 0)
    r = await call('GET', '/proofread/es', { user: 'alice' })
    t('GET returns marks', r.data.marks[key] && r.data.marks[key].hash === H && r.data.marks[key].by === 'alice' && !Number.isNaN(Date.parse(r.data.marks[key].at)))
    r = await call('PUT', '/proofread/es', { user: 'alice', body: { marks: { [key2]: { checked: false } } } })
    t('untick removes', r.status === 200 && r.data.unmarked === 1)
    r = await call('GET', '/proofread/es', { user: 'alice' })
    t('GET after untick', r.data.marks[key] && !r.data.marks[key2])
    t('marks file written per language', fs.existsSync(path.join(dataDir, 'proofread', 'es.json')))

    // Auto-mark on save, removal on reset
    r = await call('PUT', '/strings/de', { user: 'alice', body: { changes: { [key]: 'Hallo Welt' } } })
    t('save returns auto-mark', r.status === 200 && r.data.marks[key] && r.data.marks[key].hash === proofHash('Hallo Welt'))
    r = await call('GET', '/proofread/de', { user: 'alice' })
    t('auto-mark stored with hash of saved value', r.data.marks[key] && r.data.marks[key].hash === proofHash('Hallo Welt') && r.data.marks[key].by === 'alice')
    r = await call('PUT', '/strings/de', { user: 'alice', body: { changes: { [key]: null } } })
    t('reset reports unmarked', r.status === 200 && r.data.unmarked.includes(key))
    r = await call('GET', '/proofread/de', { user: 'alice' })
    t('reset removes the mark', !r.data.marks[key])

    // Community language: proofread allowed, auto-mark works
    r = await call('POST', '/languages', { user: 'alice', body: { code: 'qz', native: 'Qz', english: 'Qz' } })
    t('community language added', r.status === 201)
    r = await call('PUT', '/strings/qz', { user: 'alice', body: { changes: { [key]: 'Qz text' } } })
    t('community save auto-marks', r.status === 200 && r.data.marks[key] && r.data.marks[key].hash === proofHash('Qz text'))
    r = await call('PUT', '/proofread/qz', { user: 'alice', body: { marks: { [key2]: { checked: true, hash: H } } } })
    t('community proofread PUT accepted', r.status === 200 && r.data.marked === 1)
    r = await call('GET', '/proofread/qz', { user: 'alice' })
    t('community GET has both marks', r.data.marks[key] && r.data.marks[key2])

    // Audit
    const hist = fs.readFileSync(path.join(dataDir, 'i18n_history.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    const proofHist = hist.filter((h) => h.type === 'proofread')
    t('proofread audit entries (mark/unmark, not auto-marks)', proofHist.length === 5 &&
      proofHist.some((h) => h.lang === 'es' && h.key === key2 && h.old === H && h.new === null && h.by === 'alice'))

    // Overlay / sync data untouched by marks
    r = await call('GET', '/overlay/es')
    t('marks do not leak into the overlay', r.status === 200 && Object.keys(r.data).length === 0)
  } finally {
    server.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
  for (const [name, ok] of results) check(`proofread: ${name}`, () => assert.ok(ok))
}

// ---- GitHub sync against a fake API (global fetch stubbed) -------------------------
async function githubTests () {
  const { createGithubSync } = require('./i18n-editor.cjs')
  const files = {
    'src/locales/en/watch.json': JSON.stringify({ title: 'Watch', sub: { a: 'A', b: 'B' }, n_one: 'one', n_other: '{{count}}' }),
    'src/locales/es/watch.json': JSON.stringify({ sub: { b: 'Bes' }, title: 'Old', stale: 'gone' }, null, 2) + '\n',
    'src/i18n/languages.js': "export const LANGUAGES = [\n  { code: 'en', native: 'English', english: 'English' },\n  { code: 'es', native: 'Español', english: 'Spanish' },\n];\n"
  }
  const refs = { 'heads/develop': 'base1' }
  const blobs = {}
  const calls = []
  const realFetch = global.fetch
  let n = 0
  global.fetch = async (url, init = {}) => {
    const u = new URL(url)
    const method = init.method || 'GET'
    const body = init.body ? JSON.parse(init.body) : null
    calls.push({ host: u.host, method, path: u.pathname, auth: init.headers.Authorization, redirect: init.redirect })
    const json = (status, data) => ({ ok: status < 300, status, json: async () => data })
    const p = u.pathname.replace('/repos/o/r', '')
    if (method === 'GET' && p.startsWith('/git/ref/')) {
      const sha = refs[p.slice('/git/ref/'.length)]
      return sha ? json(200, { object: { sha } }) : json(404, { message: 'Not Found' })
    }
    if (method === 'GET' && p.startsWith('/git/commits/')) return json(200, { tree: { sha: 'tree-' + p.split('/').pop() }, parents: [] })
    if (method === 'GET' && p.startsWith('/contents/')) {
      const f = decodeURIComponent(p.slice('/contents/'.length))
      return files[f] ? json(200, { type: 'file', content: Buffer.from(files[f]).toString('base64') }) : json(404, {})
    }
    if (method === 'POST' && p === '/git/blobs') { const sha = 'blob' + (++n); blobs[sha] = body.content; return json(201, { sha }) }
    if (method === 'POST' && p === '/git/trees') return json(201, { sha: 'newtree', tree: body.tree })
    if (method === 'POST' && p === '/git/commits') return json(201, { sha: 'c1', message: body.message, author: body.author })
    if (method === 'POST' && p === '/git/refs') { refs[body.ref.replace('refs/', '')] = body.sha; return json(201, {}) }
    if (method === 'GET' && p === '/pulls') return json(200, [])
    if (method === 'POST' && p === '/pulls') return json(201, { number: 7, body: body.body })
    return json(500, { message: 'unexpected ' + method + ' ' + p })
  }
  process.env.GITHUB_TRANSLATIONS_TOKEN = 'test-token'
  process.env.GITHUB_TRANSLATIONS_REPO = 'o/r'
  delete process.env.GITHUB_TRANSLATIONS_BASE
  delete process.env.GITHUB_TRANSLATIONS_BRANCH
  const strings = [
    { lang: 'es', key: 'watch.title', value: 'Ver', updatedBy: 'alice' },
    { lang: 'es', key: 'watch.sub.a', value: 'Aes', updatedBy: 'bob' },
    { lang: 'pl', key: 'watch.n_few', value: '{{count}} kilka', updatedBy: 'alice' },
    { lang: 'nl', key: 'watch.title', value: 'Kijk', updatedBy: 'carol' }
  ]
  const languages = [{ code: 'nl', native: 'Nederlands', english: 'Dutch', dir: 'ltr' }, { code: 'qq', native: 'Q', english: 'Q', dir: 'ltr' }]
  try {
    const gs = createGithubSync({ snapshot: () => ({ strings, languages }) })
    await gs.syncNow()
    const commit = calls.find((c) => c.method === 'POST' && c.path.endsWith('/git/commits'))
    check('github: only api.github.com, bearer token, no redirects', () => {
      assert.ok(calls.every((c) => c.host === 'api.github.com' && c.auth === 'Bearer test-token' && c.redirect === 'error'))
    })
    check('github: one commit, ref created, PR opened', () => {
      assert.ok(commit)
      assert.strictEqual(refs['heads/community-translations'], 'c1')
      assert.ok(calls.some((c) => c.method === 'POST' && c.path.endsWith('/pulls')))
    })
    const out = Object.values(blobs)
    const es = out.find((c) => c.includes('"Ver"'))
    check('github: es file rebuilt in English order, overlay applied, stale key dropped', () => {
      assert.strictEqual(es, JSON.stringify({ title: 'Ver', sub: { a: 'Aes', b: 'Bes' } }, null, 2) + '\n')
    })
    check('github: pl plural form kept', () => assert.ok(out.some((c) => c.includes('"n_few": "{{count}} kilka"'))))
    check('github: languages.js gets nl (has strings) but not qq (no strings)', () => {
      const lj = out.find((c) => c.includes('export const LANGUAGES'))
      assert.ok(lj.includes("  { code: 'nl', native: 'Nederlands', english: 'Dutch' },\n];"), lj)
      assert.ok(!lj.includes("'qq'"))
    })
  } finally {
    global.fetch = realFetch
    delete process.env.GITHUB_TRANSLATIONS_TOKEN
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
