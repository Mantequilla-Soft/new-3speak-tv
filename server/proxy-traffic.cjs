// ── ▶️ Residential proxy traffic (DataImpulse) ───────────────────────────────
// YouTube downloads go out through a prepaid residential proxy (YTDLP_PROXY). Its
// traffic runs out, and when it does every proxied download fails with a proxy
// error. So the remaining traffic is read from the provider's stats endpoint
// (same login as the proxy) and:
//   - from 1 GB left downwards, every 100 MB step posts to Discord
//     (PROXY_TRAFFIC_WEBHOOK, else YT_IMPORT_ALERT_WEBHOOK), once per step;
//   - at PROXY_TRAFFIC_PAUSE_MB (100) left, proxied downloads pause: new ones are
//     refused, batch items wait in the queue. A top-up resumes them by itself.
// The last step alerted is kept on disk, so a restart does not repeat it. A
// failed read never pauses anything (fail open): the stats endpoint being down
// says nothing about the traffic.

const fs = require('fs')
const path = require('path')

const MB = 1000 * 1000
const ALERT_FROM = Number(process.env.PROXY_TRAFFIC_ALERT_FROM_MB || 1000) * MB
const ALERT_STEP = Number(process.env.PROXY_TRAFFIC_ALERT_STEP_MB || 100) * MB
const PAUSE_AT = Number(process.env.PROXY_TRAFFIC_PAUSE_MB || 100) * MB
const CHECK_MS = Number(process.env.PROXY_TRAFFIC_CHECK_MIN || 15) * 60 * 1000
const CHECK_PAUSED_MS = 5 * 60 * 1000
const STATE_FILE = process.env.PROXY_TRAFFIC_STATE || path.join(__dirname, 'data', 'proxy-traffic.json')
const WEBHOOK = process.env.PROXY_TRAFFIC_WEBHOOK || process.env.YT_IMPORT_ALERT_WEBHOOK || ''
const ENV_LABEL = process.env.YT_IMPORT_ENV_LABEL || 'preview'

const RED = 0xe53935
const ORANGE = 0xfb8c00
const GREEN = 0x43a047

const fmt = (bytes) => (bytes >= 1000 * MB ? `${(bytes / (1000 * MB)).toFixed(2)} GB` : `${Math.round(bytes / MB)} MB`)

/** The provider's stats URL and login for a proxy URL, or null when it is not DataImpulse. */
function statsTarget(proxyUrl) {
  const m = /^[a-z0-9]+:\/\/([^:@/]+):([^@/]+)@([^:/]+)/i.exec(proxyUrl || '')
  if (!m || !/dataimpulse\.com$/i.test(m[3])) return null
  return {
    url: process.env.PROXY_STATS_URL || `https://${m[3]}:777/api/stats`,
    auth: `Basic ${Buffer.from(`${decodeURIComponent(m[1])}:${decodeURIComponent(m[2])}`).toString('base64')}`,
  }
}

function createProxyTraffic(proxyUrl) {
  const target = statsTarget(proxyUrl)
  // step = the lowest 100 MB step already alerted (Infinity = none yet).
  const state = { left: null, total: null, used: null, checkedAt: 0, paused: false, step: Infinity }
  try {
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    state.paused = saved.paused === true
    state.step = Number.isFinite(saved.step) ? saved.step : Infinity
  } catch { /* first run */ }
  const save = () => {
    try {
      fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
      const tmp = `${STATE_FILE}.tmp`
      fs.writeFileSync(tmp, JSON.stringify({ paused: state.paused, step: Number.isFinite(state.step) ? state.step : null }))
      fs.renameSync(tmp, STATE_FILE)
    } catch (e) { console.warn(`[proxy-traffic] could not save state: ${e.message}`) }
  }

  function notify(title, color, description) {
    if (!WEBHOOK) return
    fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: '3Speak Importer',
        embeds: [{
          title, color, description,
          timestamp: new Date().toISOString(),
          footer: { text: `3Speak importer (${ENV_LABEL}) · DataImpulse` },
          fields: [
            { name: 'Left', value: fmt(state.left), inline: true },
            { name: 'Used', value: `${fmt(state.used)} of ${fmt(state.total)}`, inline: true },
          ],
        }],
      }),
      signal: AbortSignal.timeout(8000),
    }).then((r) => { if (!r.ok) console.warn(`[proxy-traffic] Discord HTTP ${r.status}`) })
      .catch((e) => console.warn(`[proxy-traffic] Discord failed: ${e.message}`))
  }

  function apply(left) {
    const wasPaused = state.paused
    if (left <= PAUSE_AT) {
      state.paused = true
      if (!wasPaused) {
        state.step = 0
        notify('YouTube imports PAUSED: proxy traffic almost gone', RED,
          `Under ${fmt(PAUSE_AT)} left. New YouTube downloads are refused and batch items wait until the traffic is topped up on dataimpulse.com. They resume by themselves.`)
      }
    } else {
      state.paused = false
      if (wasPaused) {
        notify('YouTube imports resumed: proxy traffic topped up', GREEN, 'Downloads through the proxy are running again.')
      }
      if (left > ALERT_FROM) {
        state.step = Infinity
      } else {
        // 1000…901 MB left = step 1000, 900…801 = step 900, …: one alert per step
        // on the way down.
        const step = Math.floor((left - 1) / ALERT_STEP) * ALERT_STEP + ALERT_STEP
        if (step < state.step) {
          state.step = step
          notify(`Proxy traffic low: ${fmt(left)} left`, ORANGE,
            `YouTube imports pause at ${fmt(PAUSE_AT)}. Top up on dataimpulse.com.`)
        } else if (wasPaused) {
          state.step = step
        }
      }
    }
    if (state.paused !== wasPaused || state.step !== state.lastSavedStep) {
      state.lastSavedStep = state.step
      save()
    }
  }

  let inflight = null
  async function check() {
    if (!target) return state
    if (inflight) return inflight
    inflight = (async () => {
      try {
        const r = await fetch(target.url, { headers: { Authorization: target.auth }, signal: AbortSignal.timeout(10000) })
        const j = await r.json().catch(() => null)
        if (!r.ok || j?.status !== 'ok' || !Number.isFinite(j.traffic_left)) throw new Error(`HTTP ${r.status}`)
        state.left = j.traffic_left
        state.total = j.total_traffic
        state.used = j.traffic_used
        state.checkedAt = Date.now()
        apply(state.left)
      } catch (e) {
        console.warn(`[proxy-traffic] stats read failed: ${e.message}`)
      } finally {
        inflight = null
      }
      return state
    })()
    return inflight
  }

  /** Re-read when the last reading is older than `maxAgeMs`; returns whether proxied downloads are paused. */
  async function pausedNow(maxAgeMs = 60 * 1000) {
    if (!target) return false
    if (Date.now() - state.checkedAt > maxAgeMs) await check()
    return state.paused
  }

  if (target) {
    const loop = () => setTimeout(() => check().finally(loop), state.paused ? CHECK_PAUSED_MS : CHECK_MS).unref()
    setTimeout(() => check().finally(loop), 5 * 1000).unref()
  }

  return {
    enabled: !!target,
    check,
    pausedNow,
    /** Last reading, without a network call. */
    get paused() { return !!target && state.paused },
    snapshot: () => ({ left: state.left, total: state.total, checkedAt: state.checkedAt, paused: !!target && state.paused }),
  }
}

module.exports = { createProxyTraffic, statsTarget }
