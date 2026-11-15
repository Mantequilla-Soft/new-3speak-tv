// A stream's boost tally for surfaces outside the 3Speak stream pages (the OBS
// chat dock). The hangouts server (0.26.23+) keeps it per stream and serves it
// at GET /rooms/:name/boost/summary:
//   { goal: { title, targetHbd, progressHbd, reached, reachedAt? } | null,
//     count, totalHbd, top: [{ account, displayName?, hbd, count }] }
// An older server has no such route (404): then the boost ledger is summed, as
// the dock did before, and there is no goal or top list.

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** The summary route's body in the shape the dock reads, or null if it is not one. */
export function normalizeBoostSummary(body) {
  if (!body || typeof body !== 'object') return null;
  const g = body.goal && typeof body.goal === 'object' ? body.goal : null;
  const target = g ? num(g.targetHbd) : 0;
  return {
    source: 'summary',
    count: Math.max(0, Math.round(num(body.count))),
    total: num(body.totalHbd),
    goal: g && target > 0
      ? {
        title: typeof g.title === 'string' ? g.title : '',
        target,
        progress: num(g.progressHbd),
        reached: g.reached === true || num(g.progressHbd) >= target,
      }
      : null,
    top: Array.isArray(body.top)
      ? body.top
        .filter((s) => s && typeof s.account === 'string' && s.account)
        .map((s) => ({ account: s.account, displayName: s.displayName || undefined, hbd: num(s.hbd), count: num(s.count) }))
      : [],
  };
}

/** The old way: the ledger's non-rejected rows, summed in USD. */
export function summarizeLedger(rows) {
  if (!Array.isArray(rows)) return null;
  const ok = rows.filter((x) => x && x.status !== 'rejected');
  return {
    source: 'ledger',
    count: ok.length,
    total: ok.reduce((sum, x) => sum + num(x.usdAmount), 0),
    goal: null,
    top: [],
  };
}

/**
 * Fetch the tally: the summary route first, the ledger when that 404s (an older
 * server). Resolves null when neither answered usefully (a blip: keep the last
 * numbers). `legacy` true skips straight to the ledger, for a caller that has
 * already seen the 404 and need not ask again every poll.
 */
export async function fetchBoostTotals(api, room, { legacy = false, fetchImpl = fetch } = {}) {
  const enc = encodeURIComponent(room);
  if (!legacy) {
    const r = await fetchImpl(`${api}/rooms/${enc}/boost/summary`, { cache: 'no-store' });
    if (r.ok) return normalizeBoostSummary(await r.json());
    if (r.status !== 404) return null;
  }
  const b = await fetchImpl(`${api}/boosts/ledger?room=${enc}`, { cache: 'no-store' });
  if (!b.ok) return null;
  return summarizeLedger(await b.json());
}
