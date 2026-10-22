// Picking the session's Hive RPC node: every candidate is probed for hived AND
// hivemind, the first healthy one is pinned in sessionStorage, unhealthy pins are
// corrected (src/utils/hiveNode.js).
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'

const NODES = ['https://api.hive.blog', 'https://api.deathwing.me', 'https://api.openhive.network', 'https://techcoderx.com']

// health[url] = { hived, hivemind } ; missing = network error
let health
const calls = []
const fakeFetch = vi.fn(async (url, opts) => {
  const body = JSON.parse(opts.body)
  calls.push({ url, opts, body })
  const h = health[url]
  if (!h) throw new TypeError('fetch failed')
  if (h.status && h.status !== 200) return { ok: false, json: async () => ({}) }
  if (body.method === 'condenser_api.get_dynamic_global_properties') {
    return { ok: true, json: async () => (h.hived ? { result: { head_block_number: 1 } } : { error: { message: 'x' } }) }
  }
  return { ok: true, json: async () => (h.hivemind ? { result: [{ name: 'hive-1' }] } : { error: { message: 'Unable to parse endpoint data.' } }) }
})

async function load() {
  vi.resetModules()
  vi.stubGlobal('fetch', fakeFetch)
  return import('../../../src/utils/hiveNode.js')
}

const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  sessionStorage.clear()
  calls.length = 0
  fakeFetch.mockClear()
  health = {}
})

describe('ensureHealthyNode', () => {
  it('starts on the first configured candidate before any probe answers', async () => {
    health = {}
    const mod = await load()
    expect(mod.getHiveUrl()).toBe(NODES[0])
  })

  it('probes every candidate with a POSTed JSON-RPC call for both layers', async () => {
    NODES.forEach((n) => { health[n] = { hived: true, hivemind: true } })
    const mod = await load()
    await mod.ensureHealthyNode()
    expect(new Set(calls.map((c) => c.url))).toEqual(new Set(NODES))
    const c = calls[0]
    expect(c.opts.method).toBe('POST')
    expect(c.opts.headers['Content-Type']).toBe('application/json')
    expect(c.body.jsonrpc).toBe('2.0')
    expect(new Set(calls.map((x) => x.body.method))).toEqual(
      new Set(['condenser_api.get_dynamic_global_properties', 'bridge.list_communities']),
    )
  })

  it('pins a healthy node and remembers it for the session', async () => {
    health[NODES[1]] = { hived: true, hivemind: true }
    const mod = await load()
    expect(await mod.ensureHealthyNode()).toBe(NODES[1])
    expect(mod.getHiveUrl()).toBe(NODES[1])
    expect(sessionStorage.getItem('hive-rpc-node-v2')).toBe(NODES[1])
  })

  it('never pins a node that serves hived but not hivemind', async () => {
    health[NODES[0]] = { hived: true, hivemind: false }
    health[NODES[3]] = { hived: true, hivemind: true }
    const mod = await load()
    expect(await mod.ensureHealthyNode()).toBe(NODES[3])
  })

  it('treats an HTTP error or an error body as unhealthy', async () => {
    health[NODES[0]] = { status: 502 }
    health[NODES[1]] = { hived: false, hivemind: true }
    health[NODES[2]] = { hived: true, hivemind: true }
    const mod = await load()
    expect(await mod.ensureHealthyNode()).toBe(NODES[2])
  })

  it('falls back to the first candidate when nothing answers', async () => {
    const mod = await load()
    expect(await mod.ensureHealthyNode()).toBe(NODES[0])
  })

  it('is idempotent: one probe round per load', async () => {
    health[NODES[0]] = { hived: true, hivemind: true }
    const mod = await load()
    const a = mod.ensureHealthyNode()
    expect(mod.ensureHealthyNode()).toBe(a)
    await a
    await flush()
    expect(calls.length).toBe(NODES.length * 2)
  })

  it('reuses a node pinned earlier in the session', async () => {
    sessionStorage.setItem('hive-rpc-node-v2', NODES[2])
    NODES.forEach((n) => { health[n] = { hived: true, hivemind: true } })
    const mod = await load()
    expect(mod.getHiveUrl()).toBe(NODES[2])
    expect(await mod.ensureHealthyNode()).toBe(NODES[2])
  })

  it('moves off a pinned node that turns out unhealthy', async () => {
    sessionStorage.setItem('hive-rpc-node-v2', NODES[0])
    health[NODES[1]] = { hived: true, hivemind: true }
    const mod = await load()
    await mod.ensureHealthyNode()
    for (let i = 0; i < 5; i++) await flush()
    expect(mod.getHiveUrl()).toBe(NODES[1])
    expect(sessionStorage.getItem('hive-rpc-node-v2')).toBe(NODES[1])
  })
})

describe('hiveClient', () => {
  it('is one stable proxy over a dhive client', async () => {
    const mod = await load()
    expect(mod.getHiveClient()).toBe(mod.hiveClient)
    expect(typeof mod.hiveClient.call).toBe('function')
    expect(mod.hiveClient.database).toBeTruthy()
  })
})
