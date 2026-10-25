// Starts server/index.cjs (or the og sidecar) as a child process for the API tests:
// `node -r preload.cjs <script>` on a free port, with an EMPTY environment apart from
// PATH, a throwaway HOME and the test values chosen here. Nothing is copied from
// process.env, and the preload keeps server/.env and the network out (see preload.cjs).
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serviceKey, SERVICE_ACCOUNT } from './hive.js'

const HELPERS = path.dirname(fileURLToPath(import.meta.url))
export const REPO = path.resolve(HELPERS, '../../..')
export const PRELOAD = path.join(HELPERS, 'preload.cjs')
const API_SCRIPT = path.join(REPO, 'server/index.cjs')
const OG_SCRIPT = path.join(REPO, 'server/og-server.cjs')

const running = new Set()
process.once('exit', () => { for (const c of running) c.kill('SIGKILL') })

const secret = () => crypto.randomBytes(24).toString('hex')

export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

// Every service the server could call points at a reserved .invalid name, so even a
// gap in the preload could not reach a real 3Speak service.
const UNREACHABLE = {
  MANTEAUTH_URL: 'https://butrauth.test.invalid',
  INCUBATION_URL: 'http://incubation.test.invalid',
  CHECKER_URL: 'https://checker.test.invalid',
  CHECKER_INTERNAL_URL: 'http://checker-internal.test.invalid',
  EMBED_API_BASE: 'https://embed.test.invalid',
  SNAPIE_CHAT_URL: 'https://snapie.test.invalid',
  PLAYLISTS_UPSTREAM_URL: 'https://playlists.test.invalid/api',
  STT_HTTP_URL: '',
}

// A fully configured API: every secret set (to fresh random values), so each route
// reaches its auth checks instead of a "not configured" answer.
export function configuredEnv() {
  return {
    ...UNREACHABLE,
    THREESPEAK_POSTING_WIF: serviceKey.toString(),
    THREESPEAK_HIVE_ACCOUNT: SERVICE_ACCOUNT,
    MANTEAUTH_CLIENT_ID: 'threespeak',
    MANTEAUTH_CLIENT_SECRET: secret(),
    SESSION_SIGNING_SECRET: secret(),
    EMBED_API_KEY: secret(),
    WATCH_TOKEN_SECRET: secret(),
    EDITOR_TOKEN_SECRET: secret(),
    STT_SIGNING_SECRET: secret(),
    OPENPODS_ANNOUNCE_SECRET: secret(),
    GATE_URL: 'https://gate.test.invalid',
    GATE_INTERNAL_API_KEY: secret(),
  }
}

// Nothing configured at all: the "not configured" refusals.
export function bareEnv() {
  return { ...UNREACHABLE }
}

function makeTempDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `3speak-api-test-${name}-`))
}

function readJsonLines(file) {
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
}

async function startChild({ script, name, env, fixtures, portVar, healthPath, extraEnv }) {
  const dir = makeTempDir(name)
  const fixturesFile = path.join(dir, 'fixtures.json')
  const netLog = path.join(dir, 'net.log')
  const broadcastLog = path.join(dir, 'broadcasts.log')
  fs.writeFileSync(fixturesFile, JSON.stringify(fixtures || {}))
  fs.mkdirSync(path.join(dir, 'home'))

  for (let attempt = 1; ; attempt++) {
    const port = await freePort()
    const childEnv = {
      PATH: process.env.PATH,
      HOME: path.join(dir, 'home'),
      TEST_FIXTURES: fixturesFile,
      TEST_NET_LOG: netLog,
      TEST_BROADCAST_LOG: broadcastLog,
      ...extraEnv(dir),
      ...env,
      [portVar]: String(port),
    }
    const child = spawn(process.execPath, ['-r', PRELOAD, script], {
      cwd: REPO,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    running.add(child)
    let output = ''
    child.stdout.on('data', (d) => { output += d })
    child.stderr.on('data', (d) => { output += d })
    const exited = new Promise((resolve) => child.once('exit', (code, signal) => {
      running.delete(child)
      resolve({ code, signal })
    }))

    const url = `http://127.0.0.1:${port}`
    const ready = await waitReady(url + healthPath, exited)
    if (ready === true) {
      return makeHandle({ child, exited, url, port, env: childEnv, dir, fixturesFile, netLog, broadcastLog, getOutput: () => output })
    }
    child.kill('SIGKILL')
    await exited
    if (attempt < 3 && /EADDRINUSE/.test(output)) continue
    fs.rmSync(dir, { recursive: true, force: true })
    throw new Error(`${name} did not start (${ready}). Output:\n${output}`)
  }
}

async function waitReady(healthUrl, exited, timeoutMs = 15000) {
  let gone = null
  exited.then((r) => { gone = r })
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (gone) return `exited with ${gone.code ?? gone.signal}`
    try {
      const r = await fetch(healthUrl)
      if (r.ok) return true
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 100))
  }
  return 'timed out'
}

function makeHandle({ child, exited, url, port, env, dir, fixturesFile, netLog, broadcastLog, getOutput }) {
  let n = 0
  return {
    url,
    port,
    env,
    // Sends one request. Each request comes from its own client IP (X-Forwarded-For,
    // which the server trusts one hop of) so the per-IP rate limits never couple
    // unrelated tests; pass `ip` to pick one, or `ip: null` for a direct call.
    async request(pathname, { method = 'GET', headers = {}, json, body, cookies, ip } = {}) {
      const h = { ...headers }
      if (ip === undefined) { n++; ip = `10.0.${(n >> 8) & 255}.${n & 255}` }
      if (ip) h['X-Forwarded-For'] = ip
      if (cookies) h.Cookie = Object.entries(cookies).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ')
      if (json !== undefined) {
        h['Content-Type'] = 'application/json'
        body = JSON.stringify(json)
      }
      const res = await fetch(url + pathname, { method, headers: h, body, redirect: 'manual' })
      const text = await res.text()
      let data = text
      if ((res.headers.get('content-type') || '').includes('json')) {
        try { data = JSON.parse(text) } catch { /* leave as text */ }
      }
      return { status: res.status, headers: res.headers, body: data, text, cookies: res.headers.getSetCookie() }
    },
    // A request with the path sent exactly as given (fetch would normalise dot segments).
    rawRequest(rawPath, { method = 'GET', headers = {} } = {}) {
      return new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port, path: rawPath, method, headers }, (res) => {
          let text = ''
          res.on('data', (d) => { text += d })
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }))
        })
        req.on('error', reject)
        req.end()
      })
    },
    setFixtures(fixtures) {
      fs.writeFileSync(fixturesFile, JSON.stringify(fixtures))
    },
    // Transactions the server "broadcast" (only ever written to a file).
    broadcasts: () => readJsonLines(broadcastLog),
    // Every network attempt the server made: fetch, Hive calls, sockets, DNS.
    netLog: () => readJsonLines(netLog),
    clearNetLog: () => fs.rmSync(netLog, { force: true }),
    output: getOutput,
    async stop() {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM')
        const t = setTimeout(() => child.kill('SIGKILL'), 3000)
        await exited
        clearTimeout(t)
      }
      fs.rmSync(dir, { recursive: true, force: true })
    },
  }
}

export function startApi({ env = configuredEnv(), fixtures } = {}) {
  return startChild({
    script: API_SCRIPT,
    name: 'api',
    env,
    fixtures,
    portVar: 'SERVER_PORT',
    healthPath: '/api/health',
    // The translation editor's file store and the share images, kept out of
    // server/data; no weekly share-image sync.
    extraEnv: (dir) => ({ I18N_DATA_DIR: path.join(dir, 'i18n'), OG_CARD_DIR: path.join(dir, 'og-cards'), OG_CARD_SYNC: 'off' }),
  })
}

export function startOg({ env = {}, fixtures } = {}) {
  return startChild({
    script: OG_SCRIPT,
    name: 'og',
    env: {
      CHECKER_URL: 'https://checker.test.invalid',
      TRANSLATE_API_URL: 'https://translate.test.invalid',
      ...env,
    },
    fixtures,
    portVar: 'OG_PORT',
    healthPath: '/og-health',
    extraEnv: (dir) => ({ OG_VIDEO_CACHE_DIR: path.join(dir, 'og-video'), OG_CARD_DIR: path.join(dir, 'og-cards') }),
  })
}
