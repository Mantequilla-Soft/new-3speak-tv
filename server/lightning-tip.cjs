// ⚡ Lightning tips: a Lightning invoice that pays a creator's Hive account.
//
// v4v.app gives every Hive account a Lightning address (<account>@v4v.app). Paid
// sats are credited to that account at v4v.app and converted to HIVE when they
// cover v4v.app's fee (about 55 sats a conversion); smaller tips stay as sats there.
// The creator needs nothing set up and the viewer needs no Hive account, only a
// Lightning wallet.
//
// The page can't run the LNURL-pay steps itself: v4v.app only allows browser calls
// from origins it knows, and 3speak.tv is not one. So the page asks here, and this
// does both steps server-side: read the address's limits, then ask its callback
// for an invoice of that amount with the viewer's message as the LNURL comment.
//
// v4v.app hands out an invoice for ANY name, existing or not, and sats paid to a
// name that is not a Hive account are not ours to get back. So the account is
// checked on Hive first, and the invoice amount is checked against the one asked
// for before it goes to the page.
//
// Paid or not: v4v.app's invoices carry no LNURL verify URL, but the moment one is
// paid, @v4vapp credits the account with a `v4vapp_transfer` custom_json whose
// `parent_id` is the invoice's payment hash (base64). While any invoice from here
// is waiting, one poller reads @v4vapp's latest custom_jsons and marks the matching
// hashes paid; the page asks /api/lightning/status/<hash>.

const USER_RE = /^[a-z][a-z0-9.-]{2,15}$/
const LNURLP_BASE = 'https://v4v.app/.well-known/lnurlp/'
const MIN_SATS = 1
const MAX_SATS = 1000000
const MAX_COMMENT = 1000
const REQUEST_TIMEOUT_MS = 10000
const ACCOUNT_CACHE_TTL_MS = 60 * 60 * 1000
const ACCOUNT_CACHE_MAX = 5000
const V4V_ACCOUNT = 'v4vapp'
const PENDING_TTL_MS = 30 * 60 * 1000
const PAID_TTL_MS = 60 * 60 * 1000
const POLL_MS = 3000
const POLL_BATCH = 100
const CUSTOM_JSON_FILTER = 2 ** 18 // operation filter bit of custom_json
const HASH_RE = /^[0-9a-f]{64}$/

// Hive names only ever come into existence, so a "yes" can be kept a while.
const knownAccounts = new Map()

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// Amount of a BOLT11 invoice in millisats, from its human-readable part
// (lnbc<amount><multiplier>1...). null when the invoice names no amount.
function bolt11Msats(pr) {
  const m = /^ln(?:bc|tb|bcrt)(\d+)([munp]?)1/.exec(String(pr).toLowerCase())
  if (!m) return null
  const n = BigInt(m[1])
  // 1 BTC = 1e11 msat; the multiplier divides it.
  const perUnit = { '': 100000000000n, m: 100000000n, u: 100000n, n: 100n, p: 1n }[m[2]]
  const msats = m[2] === 'p' ? n / 10n : n * perUnit
  return Number(msats)
}

const BECH32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'

// Payment hash (hex) of a BOLT11 invoice: tagged field `p` of its data part, which
// sits between the 35-bit timestamp and the 520-bit signature + checksum.
function bolt11PaymentHash(pr) {
  const str = String(pr).toLowerCase()
  const sep = str.lastIndexOf('1')
  if (sep < 1) return null
  const words = []
  for (const c of str.slice(sep + 1)) {
    const v = BECH32.indexOf(c)
    if (v < 0) return null
    words.push(v)
  }
  const end = words.length - 6 - 104
  for (let i = 7; i + 3 <= end;) {
    const tag = words[i]
    const len = words[i + 1] * 32 + words[i + 2]
    const data = words.slice(i + 3, i + 3 + len)
    i += 3 + len
    if (tag !== 1 || len !== 52) continue
    let acc = 0, bits = 0
    const bytes = []
    for (const w of data) {
      acc = (acc << 5) | w
      bits += 5
      if (bits >= 8) {
        bits -= 8
        bytes.push((acc >> bits) & 0xff)
      }
    }
    return Buffer.from(bytes.slice(0, 32)).toString('hex')
  }
  return null
}

// Lightning credits in a page of @v4vapp's account history (custom_json only):
// [{ idx, hash }], hash = the paid invoice's payment hash in hex.
function v4vCredits(rows) {
  const out = []
  for (const [idx, row] of rows || []) {
    const op = row?.op?.[1]
    if (op?.id !== 'v4vapp_transfer' || !op.required_auths?.includes(V4V_ACCOUNT)) continue
    let body
    try { body = JSON.parse(op.json) } catch { continue }
    if (body?.from_account !== V4V_ACCOUNT || !body.parent_id) continue
    out.push({ idx, hash: Buffer.from(String(body.parent_id), 'base64').toString('hex') })
  }
  return out
}

function mountLightningTip(app, { client, limiter }) {
  const pending = new Map() // hash → time the invoice was made
  const paid = new Map()    // hash → time it was seen paid
  let lastSeen = -1         // highest @v4vapp history index already read
  let timer = null

  function prune() {
    const now = Date.now()
    for (const [h, at] of pending) if (now - at > PENDING_TTL_MS) pending.delete(h)
    for (const [h, at] of paid) if (now - at > PAID_TTL_MS) paid.delete(h)
  }

  async function pollOnce() {
    const rows = await client.call('condenser_api', 'get_account_history',
      [V4V_ACCOUNT, -1, POLL_BATCH, CUSTOM_JSON_FILTER, 0])
    for (const { idx, hash } of v4vCredits(rows)) {
      if (idx <= lastSeen) continue
      lastSeen = idx
      if (pending.has(hash)) {
        pending.delete(hash)
        paid.set(hash, Date.now())
      }
    }
  }

  // Runs only while something is waiting, so an idle site costs no Hive calls.
  function ensurePolling() {
    if (timer) return
    const tick = async () => {
      prune()
      if (!pending.size) { timer = null; return }
      try { await pollOnce() } catch (err) {
        console.warn('[lightning-tip] v4vapp history poll failed:', err.message)
      }
      timer = setTimeout(tick, POLL_MS)
    }
    timer = setTimeout(tick, 0)
  }

  async function accountExists(name) {
    const hit = knownAccounts.get(name)
    if (hit && Date.now() - hit < ACCOUNT_CACHE_TTL_MS) return true
    const [acct] = await client.database.getAccounts([name])
    if (!acct) return false
    if (knownAccounts.size >= ACCOUNT_CACHE_MAX) knownAccounts.clear()
    knownAccounts.set(name, Date.now())
    return true
  }

  // GET /api/lightning/invoice?to=<account>&sats=<n>&comment=<text>
  // → { pr, sats }
  app.get('/api/lightning/invoice', limiter, async (req, res) => {
    const to = String(req.query.to || '').trim().toLowerCase().replace(/^@/, '')
    const sats = Number(req.query.sats)
    const comment = String(req.query.comment || '').trim()

    if (!USER_RE.test(to)) return res.status(400).json({ error: 'bad_account' })
    if (!Number.isInteger(sats) || sats < MIN_SATS || sats > MAX_SATS) {
      return res.status(400).json({ error: 'bad_amount' })
    }

    try {
      if (!(await accountExists(to))) return res.status(404).json({ error: 'no_account' })

      const pay = await getJson(LNURLP_BASE + encodeURIComponent(to))
      if (pay?.tag !== 'payRequest' || typeof pay.callback !== 'string') {
        throw new Error('not a payRequest')
      }
      const msats = sats * 1000
      if (msats < Number(pay.minSendable) || msats > Number(pay.maxSendable)) {
        return res.status(400).json({
          error: 'amount_out_of_range',
          min: Math.ceil(Number(pay.minSendable) / 1000),
          max: Math.floor(Number(pay.maxSendable) / 1000),
        })
      }

      const cb = new URL(pay.callback)
      if (cb.hostname !== 'v4v.app' && !cb.hostname.endsWith('.v4v.app')) {
        throw new Error(`unexpected callback host ${cb.hostname}`)
      }
      cb.searchParams.set('amount', String(msats))
      const allowed = Math.min(Number(pay.commentAllowed) || 0, MAX_COMMENT)
      if (comment && allowed > 0) cb.searchParams.set('comment', comment.slice(0, allowed))

      const inv = await getJson(cb.toString())
      if (inv?.status === 'ERROR' || typeof inv?.pr !== 'string') {
        throw new Error(inv?.reason || 'no invoice')
      }
      if (bolt11Msats(inv.pr) !== msats) throw new Error('invoice amount mismatch')
      const hash = bolt11PaymentHash(inv.pr)
      if (hash) {
        pending.set(hash, Date.now())
        ensurePolling()
      }

      res.set('Cache-Control', 'no-store')
      res.json({ pr: inv.pr, sats, hash })
    } catch (err) {
      console.warn(`[lightning-tip] invoice for @${to} (${sats} sats) failed:`, err.message)
      res.status(502).json({ error: 'invoice_failed' })
    }
  })

  // GET /api/lightning/status/<hash> → { paid }. Unknown or expired hashes are
  // simply not paid; the page stops asking when the viewer closes the window.
  app.get('/api/lightning/status/:hash', limiter, (req, res) => {
    const hash = String(req.params.hash).toLowerCase()
    if (!HASH_RE.test(hash)) return res.status(400).json({ error: 'bad_hash' })
    res.set('Cache-Control', 'no-store')
    if (paid.has(hash)) return res.json({ paid: true })
    if (pending.has(hash)) ensurePolling()
    res.json({ paid: false })
  })
}

module.exports = { mountLightningTip, bolt11Msats, bolt11PaymentHash, v4vCredits }
