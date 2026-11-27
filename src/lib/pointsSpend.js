/**
 * A request that spends 3Speak Points on the live server (hangouts), for
 * example promoting a video. Mirrors spendPoints() of the hangouts React SDK
 * (packages/sdk-react/src/lib/pointsSpend.ts), which the SDK does not export.
 *
 * With 3Speak Points on Magi the server burns the points first and only then
 * does the thing, so besides "done" or an error it can answer:
 *
 *   428 { code: 'sign', op }   the server may not sign for this account: the
 *                              user's wallet signs `op` (a posting key
 *                              custom_json) and the same request goes again
 *                              with `burnTx`.
 *   202 { pending, spendId }   the burn is not confirmed yet: poll
 *                              GET /points/spends/:id until it is.
 *
 * Servers without the token answer as before (200/201 or an error).
 *
 * Resolves { ok: true, body } or { ok: false, message, code }. It never throws
 * for an HTTP answer; a network error on the first request does throw.
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The txid in what a broadcast resolved: a string (aioha) or { id } (dhive). */
function txidOf(result) {
  if (typeof result === 'string') return result;
  return result?.id || result?.tx_id || result?.trx_id || '';
}

/**
 * A wallet signer from a broadcast function `(ops) => { success, result }`,
 * e.g. `(ops) => broadcastWithAioha(ops, 'posting')`. Resolves the txid.
 */
export function walletSigner(broadcast) {
  if (typeof broadcast !== 'function') return undefined;
  return async (ops) => {
    const res = await broadcast(ops);
    const tx = res?.success ? txidOf(res.result) : '';
    if (!tx) throw new Error(res?.error || 'The wallet did not sign.');
    return tx;
  };
}

/**
 * @param {object} opts
 * @param {string} opts.apiBaseUrl  the live server, for GET /points/spends/:id
 * @param {string} opts.url         the spend route (POST)
 * @param {object} opts.body        its JSON body
 * @param {() => object} opts.headers  e.g. the Bearer session token
 * @param {(ops: any[]) => Promise<string>} [opts.sign]  signs and broadcasts, resolves the txid
 * @param {() => void} [opts.onPending]  the burn waits for Magi
 * @param {number} [opts.timeoutMs]  how long to follow a pending spend (10 minutes)
 * @param {number} [opts.pollMs]     between two looks (3 s)
 */
export async function spendPoints(opts) {
  const headers = () => (typeof opts.headers === 'function' ? opts.headers() : opts.headers) || {};
  const post = (body) => fetch(opts.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers() },
    body: JSON.stringify(body),
  });
  const read = (res) => res.json().catch(() => ({}));
  const text = (v, fallback) => (typeof v === 'string' && v ? v : fallback);

  let res = await post(opts.body);
  let json = await read(res);

  if (res.status === 428 && json?.code === 'sign' && Array.isArray(json.op)) {
    if (!opts.sign) return { ok: false, code: 'sign', message: text(json.message, 'Sign in with a wallet to spend points.') };
    let burnTx;
    try {
      burnTx = await opts.sign([json.op]);
    } catch (err) {
      return { ok: false, code: 'sign', message: text(err?.message, 'The wallet did not sign.') };
    }
    try {
      res = await post({ ...opts.body, burnTx });
    } catch (err) {
      return { ok: false, code: 'network', message: text(err?.message, 'Could not reach the server.') };
    }
    json = await read(res);
  }

  if (res.status === 202 && json?.pending && typeof json.spendId === 'string') {
    opts.onPending?.();
    const deadline = Date.now() + (opts.timeoutMs ?? 10 * 60_000);
    while (Date.now() < deadline) {
      await sleep(opts.pollMs ?? 3000);
      const s = await fetch(`${opts.apiBaseUrl}/points/spends/${encodeURIComponent(json.spendId)}`, { headers: headers() })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      if (!s || s.status === 'sent') continue;
      if (s.status === 'ok') return { ok: true, body: s };
      return { ok: false, code: String(s.status), message: text(s.message, 'The spend did not go through.') };
    }
    return { ok: false, code: 'timeout', message: 'Still not confirmed. Check your points in a few minutes.' };
  }

  if (!res.ok) {
    return {
      ok: false,
      code: typeof json?.code === 'string' ? json.code : undefined,
      message: text(json?.message, `Failed (${res.status})`),
    };
  }
  return { ok: true, body: json || {} };
}
