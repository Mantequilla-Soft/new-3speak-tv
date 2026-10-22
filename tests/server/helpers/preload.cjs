// Preloaded (node -r) into every server the API tests start. It makes the server
// run offline and harmless:
//   1. dotenv is replaced by a no-op, so a developer's real server/.env is never read;
//   2. the ESM-only ButrAuth and incubation SDKs resolve to fakes (./fakes/*.mjs);
//   3. @hiveio/dhive's Client.call answers from a fixture file instead of a Hive node,
//      and broadcasts are only written to a log file;
//   4. fetch answers from the same fixture file, and every other outbound socket and
//      DNS lookup is refused.
// Anything the fakes do not cover fails like a network outage, never as a real call.
// If any step cannot be installed the process exits before the server is loaded.

const fs = require('fs')
const path = require('path')
const Module = require('module')
const net = require('net')
const dns = require('dns')
const { pathToFileURL } = require('url')

const SERVER_DIR = path.resolve(__dirname, '../../../server')
const FIXTURES = process.env.TEST_FIXTURES || ''
const NET_LOG = process.env.TEST_NET_LOG || ''
const BROADCAST_LOG = process.env.TEST_BROADCAST_LOG || ''

function fail(msg) {
  process.stderr.write(`[test-preload] FATAL: ${msg}\n`)
  process.exit(97)
}

function appendLog(file, entry) {
  if (file) fs.appendFileSync(file, JSON.stringify(entry) + '\n')
}

// Read on every call so a test can change the fixtures of a running server.
function fixtures() {
  if (!FIXTURES) return { accounts: {}, fetch: [] }
  try {
    const f = JSON.parse(fs.readFileSync(FIXTURES, 'utf8'))
    return { accounts: f.accounts || {}, fetch: f.fetch || [] }
  } catch {
    return { accounts: {}, fetch: [] }
  }
}

// 1. dotenv -------------------------------------------------------------------
try {
  const resolved = require.resolve('dotenv', { paths: [SERVER_DIR] })
  const stub = new Module(resolved)
  stub.filename = resolved
  stub.loaded = true
  const noop = () => ({ parsed: {} })
  stub.exports = { config: noop, configDotenv: noop, parse: () => ({}), populate: () => ({}), decrypt: () => '' }
  require.cache[resolved] = stub
} catch (err) {
  fail(`could not stub dotenv: ${err.message}`)
}

// 2. ESM SDKs -----------------------------------------------------------------
if (typeof Module.registerHooks !== 'function') {
  fail(`node ${process.version} has no module.registerHooks (needs 22.15+)`)
}
const FAKE_MODULES = {
  '@mantequilla-soft/butrauth-client': pathToFileURL(path.join(__dirname, 'fakes/butrauth-client.mjs')).href,
  '@mantequilla-soft/incubation-client': pathToFileURL(path.join(__dirname, 'fakes/incubation-client.mjs')).href,
}
Module.registerHooks({
  resolve(specifier, context, nextResolve) {
    if (FAKE_MODULES[specifier]) return { url: FAKE_MODULES[specifier], shortCircuit: true }
    return nextResolve(specifier, context)
  },
})

// 3. Hive node ----------------------------------------------------------------
// Only when the script is the API server (the og sidecar has no dhive).
let dhive = null
try {
  dhive = require(require.resolve('@hiveio/dhive', { paths: [SERVER_DIR] }))
} catch { /* not needed by this script */ }
if (dhive) {
  dhive.Client.prototype.call = async function fakeHiveCall(api, method, params = []) {
    const name = `${api}.${method}`
    appendLog(NET_LOG, { kind: 'hive', method: name })
    if (name === 'condenser_api.get_accounts') {
      const { accounts } = fixtures()
      return (params[0] || []).map((u) => accounts[u]).filter(Boolean)
    }
    if (name === 'condenser_api.get_dynamic_global_properties') {
      return {
        head_block_number: 1000,
        head_block_id: '000003e8' + 'ab'.repeat(16),
        time: new Date().toISOString().slice(0, 19),
      }
    }
    if (name.startsWith('condenser_api.broadcast_transaction')) {
      appendLog(BROADCAST_LOG, params[0])
      return {}
    }
    if (name === 'database_api.find_comments') return { comments: [] }
    const err = new Error(`[test-preload] Hive call not faked: ${name}`)
    err.code = 'ECONNREFUSED'
    throw err
  }
}

// 4. fetch, sockets, DNS ------------------------------------------------------
function subsetMatches(want, got) {
  if (want === null || typeof want !== 'object') return want === got
  if (got === null || typeof got !== 'object') return false
  return Object.keys(want).every((k) => subsetMatches(want[k], got[k]))
}

globalThis.fetch = async function fakeFetch(input, init = {}) {
  const url = typeof input === 'string' ? input : (input && input.url) || String(input)
  const method = String(init.method || (input && input.method) || 'GET').toUpperCase()
  let body = null
  if (typeof init.body === 'string') {
    try { body = JSON.parse(init.body) } catch { body = init.body }
  }
  const hit = fixtures().fetch.find((f) =>
    (f.prefix ? url.startsWith(f.url) : url === f.url) &&
    (!f.method || f.method.toUpperCase() === method) &&
    (f.body === undefined || subsetMatches(f.body, body)))
  appendLog(NET_LOG, { kind: 'fetch', method, url, answered: !!hit })
  if (!hit) throw new TypeError('fetch failed', { cause: new Error(`[test-preload] no fixture for ${method} ${url}`) })
  const isJson = hit.json !== undefined
  return new Response(isJson ? JSON.stringify(hit.json) : (hit.text ?? ''), {
    status: hit.status ?? 200,
    headers: { 'content-type': isJson ? 'application/json' : 'text/plain', ...(hit.headers || {}) },
  })
}

net.Socket.prototype.connect = function blockedConnect(...args) {
  const target = args[0] && typeof args[0] === 'object' ? (args[0].host || args[0].path || '') + ':' + (args[0].port || '') : String(args[0])
  appendLog(NET_LOG, { kind: 'socket', target })
  const err = new Error(`[test-preload] outbound connection blocked: ${target}`)
  err.code = 'ECONNREFUSED'
  process.nextTick(() => this.destroy(err))
  return this
}

// Binding a listener resolves its own address through dns.lookup, so loopback names
// and IP literals still resolve; nothing else does.
const realLookup = dns.lookup
const localName = (h) => h === 'localhost' || net.isIP(String(h)) !== 0
function blockedLookup(hostname, options, cb) {
  if (localName(hostname)) return realLookup(hostname, options, cb)
  const callback = typeof options === 'function' ? options : cb
  appendLog(NET_LOG, { kind: 'dns', hostname })
  const err = new Error(`[test-preload] DNS blocked: ${hostname}`)
  err.code = 'ENOTFOUND'
  process.nextTick(() => callback(err))
}
dns.lookup = blockedLookup
dns.promises.lookup = async (hostname) => {
  appendLog(NET_LOG, { kind: 'dns', hostname })
  const err = new Error(`[test-preload] DNS blocked: ${hostname}`)
  err.code = 'ENOTFOUND'
  throw err
}
for (const fn of ['resolve', 'resolve4', 'resolve6', 'resolveAny']) {
  dns.promises[fn] = dns.promises.lookup
}

process.stderr.write('[test-preload] active: dotenv stubbed, SDKs faked, network blocked\n')
