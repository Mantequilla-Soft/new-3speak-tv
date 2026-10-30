// Data for the Hive galaxy (page/Galaxy.jsx): an account's ring (who it
// follows, who follows it, or both), and the accounts that ring follows which
// the account does not yet, ranked by how many ring members lead there
// ("friends of friends" = creators worth discovering).
//
// The follow graph comes from the checker's /galaxy routes, which read
// HafSQL's follow table: the centre's lists and every sampled ring member's
// whole follow list in a few queries. If the checker can't answer, plain Hive
// RPC does the same scan: one read per sampled ring member (first page only),
// a few at a time so a public node isn't hammered. Then bulk profiles + 3Speak
// counts for the candidates so the page can filter them.

import axios from 'axios';
import { getHiveUrl } from '../utils/hiveNode';
import { CHECKER_URL } from '../utils/config';
import { louvain, seedOf } from './galaxyLayout';

const PAGE = 1000; // get_following / get_followers maximum
const MAX_LIST = 5000; // centre lists: 5 pages covers nearly everyone, bounded for the giants
const CONCURRENCY = 5;
const MAX_CANDIDATES = 200; // ranked suggestions kept for the filters to choose from
const BULK = 100; // bridge.get_profiles and checker /users/counts take 100 names
const LIST_TTL_MS = 10 * 60 * 1000;

// How many ring members get their own follows read. More = truer counts, slower.
// Kept in step with the checker's routes/galaxy.js.
export const SCAN_DEPTHS = { orbit: 120, starsystem: 250, nebula: 1000, deepspace: 5000 };
export const DEFAULT_DEPTH = 'orbit';
// The RPC fallback reads one account per call: past this it would take minutes.
const RPC_MAX_SAMPLE = 250;
export const MODES = ['following', 'followers', 'mutuals'];

const pause = (ms) => new Promise((r) => { setTimeout(r, ms); });

// Public nodes answer a burst of reads (a deep scan) with 429s; back off and
// try again rather than letting a skipped account quietly skew the counts.
async function rpc(method, params, attempt = 0) {
  let data;
  try {
    ({ data } = await axios.post(getHiveUrl(), { jsonrpc: '2.0', id: 1, method, params }, { timeout: 15000 }));
  } catch (err) {
    const status = err.response?.status;
    if (attempt < 3 && (!status || status === 429 || status >= 500)) {
      await pause(700 * 2 ** attempt);
      return rpc(method, params, attempt + 1);
    }
    throw err;
  }
  if (data?.error) {
    const err = new Error(data.error.message || method);
    err.rpc = data.error;
    throw err;
  }
  return data?.result;
}

// Accounts that are not people: PeakD-style badge accounts follow their holders.
// EXCLUDED never appear in any scan: not in a ring, not scanned, not suggested.
const EXCLUDED = new Set(['dtube', 'kgakakillerg', 'bpcvoter1']);
const skip = (name) => !name || name.startsWith('badge-') || EXCLUDED.has(name);

// Lists are shared between modes, depths and the viewer's own list, so a
// second look (another mode, a deeper scan) mostly hits this.
const listCache = new Map(); // key -> { at, promise }

function cached(key, load) {
  const hit = listCache.get(key);
  if (hit && Date.now() - hit.at < LIST_TTL_MS) return hit.promise;
  const promise = load().catch((err) => { listCache.delete(key); throw err; });
  listCache.set(key, { at: Date.now(), promise });
  return promise;
}

// Pages through get_following / get_followers. `start` is inclusive, so every
// page after the first repeats the previous page's last row.
function readList(method, field, account, max) {
  return cached(`${method}:${account}:${max}`, async () => {
    const out = [];
    let start = '';
    for (;;) {
      const rows = (await rpc(method, [account, start, 'blog', PAGE])) || [];
      const fresh = start ? rows.slice(1) : rows;
      fresh.forEach((r) => out.push(r[field]));
      if (rows.length < PAGE || out.length >= max) break;
      start = rows[rows.length - 1][field];
    }
    return out.slice(0, max).filter((n) => !skip(n));
  });
}

const rpcFollowing = (account, max = MAX_LIST) => readList('condenser_api.get_following', 'following', account, max);
const rpcFollowers = (account, max = MAX_LIST) => readList('condenser_api.get_followers', 'follower', account, max);

// Both lists of one account from the checker (HafSQL), A->Z, capped at MAX_LIST.
const checkerLists = (account) => cached(`checker:${account}`, async () => {
  const { data } = await axios.get(`${CHECKER_URL}/galaxy/lists`, { params: { account }, timeout: 15000 });
  if (!data?.success) throw new Error('galaxy/lists');
  return data;
});

export const fetchFollowing = (account, max = MAX_LIST) => checkerLists(account)
  .then((l) => l.following.slice(0, max))
  .catch(() => rpcFollowing(account, max));
export const fetchFollowers = (account, max = MAX_LIST) => checkerLists(account)
  .then((l) => l.followers.slice(0, max))
  .catch(() => rpcFollowers(account, max));

// Seeded shuffle, so the same account maps to the same galaxy every visit.
function shuffled(list, seedText) {
  let s = 0;
  for (const ch of seedText) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const chunks = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

// bridge.get_profiles asserts on the whole batch if ONE name has no account
// (a follow can point at a name nobody registered), naming the culprits. Drop
// them and ask again; they come back as `missing`.
async function fetchProfiles(names) {
  const profiles = {};
  const missing = new Set();
  await Promise.all(chunks(names, BULK).map(async (batch) => {
    let todo = batch;
    for (let attempt = 0; attempt < 3 && todo.length; attempt += 1) {
      try {
        const rows = (await rpc('bridge.get_profiles', { accounts: todo })) || [];
        rows.forEach((p) => { profiles[p.name] = p; });
        return;
      } catch (err) {
        const bad = String(err.rpc?.data?.extension?.assertion_expression || '').match(/"([a-z0-9.-]+)": "account does not exist"/g);
        if (!bad) throw err;
        bad.forEach((m) => missing.add(m.split('"')[1]));
        todo = todo.filter((n) => !missing.has(n));
      }
    }
  }));
  return { profiles, missing };
}

async function fetchCreatorCounts(names) {
  const out = {};
  await Promise.all(chunks(names, BULK).map(async (batch) => {
    const { data } = await axios.post(`${CHECKER_URL}/users/counts`, { usernames: batch }, { timeout: 15000 });
    Object.assign(out, data?.counts || {});
  }));
  return out;
}

/**
 * {
 *   center, mode,
 *   following, followers: [names] (the centre's own lists; followersKnown is
 *     false when the followers read failed, so nothing can be called mutual),
 *   ring: [names] (the inner shell for this mode),
 *   sampled: [names] (ring members whose follows were read),
 *   leads: { sampledName: [candidate names it follows] },
 *   ringLinks: { sampledName: [ring members it follows] },
 *   suggestions: [{ name, count, via, rep, active, followers, displayName, videos, shorts }],
 *   defaultMinCount, enriched: { profiles, creators }, truncated: { following, followers },
 * }
 * Enrichment fields are null when that lookup failed; the page then disables
 * the filters that need them instead of filtering everything out.
 * onProgress(done, total) reports the second-degree reads (RPC fallback only;
 * the checker scan is one request).
 */
// The scan from the checker (HafSQL), or null so the RPC scan takes over.
async function checkerScan(center, mode, depth) {
  try {
    const { data } = await axios.get(`${CHECKER_URL}/galaxy/scan`, { params: { center, mode, depth }, timeout: 90000 });
    if (!data?.success) return null;
    return {
      following: data.following,
      followerList: data.followers,
      sample: data.sampled,
      candidates: data.candidates,
      ringLinks: data.ringLinks || {},
      // An older checker sends neither: the map ring and profiles are then
      // worked out here as for an RPC scan.
      mapRing: data.mapRing || null,
      profiled: Array.isArray(data.mapRing),
    };
  } catch {
    return null;
  }
}

async function rpcScan(center, mode, depth, onProgress) {
  const [following, followerList] = await Promise.all([
    rpcFollowing(center),
    // Only needed for mutual marks in "following" mode, so a node hiccup here
    // must not cost the whole galaxy.
    rpcFollowers(center).catch((err) => { if (mode === 'following') return null; throw err; }),
  ]);
  const followSet = new Set(following);
  const followerSet = new Set(followerList || []);
  const ring = mode === 'followers' ? (followerList || [])
    : mode === 'mutuals' ? following.filter((n) => followerSet.has(n))
      : following;

  const sample = shuffled(ring, `${center}:${mode}`).slice(0, Math.min(SCAN_DEPTHS[depth] || SCAN_DEPTHS[DEFAULT_DEPTH], RPC_MAX_SAMPLE));
  const via = new Map(); // name -> [ring members that follow it]
  const ringSet = new Set(ring);
  const ringLinks = {}; // sampled member -> [ring members it follows]

  let done = 0;
  onProgress?.(0, sample.length);
  const queue = [...sample];
  const worker = async () => {
    while (queue.length) {
      const acct = queue.shift();
      try {
        // One page is plenty for a second-degree read.
        const theirs = await rpcFollowing(acct, PAGE);
        theirs.forEach((name) => {
          if (ringSet.has(name) && name !== acct) (ringLinks[acct] ||= []).push(name);
          if (name === center || followSet.has(name)) return;
          if (!via.has(name)) via.set(name, []);
          via.get(name).push(acct);
        });
      } catch {
        // One unreadable account just contributes nothing.
      }
      done += 1;
      onProgress?.(done, sample.length);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const candidates = [...via.entries()]
    .map(([name, list]) => ({ name, via: list }))
    .sort((a, b) => b.via.length - a.via.length || a.name.localeCompare(b.name))
    .slice(0, MAX_CANDIDATES);
  return { following, followerList, sample, candidates, ringLinks };
}

export async function buildGalaxy(center, { mode = 'following', depth = DEFAULT_DEPTH, onProgress } = {}) {
  const {
    following, followerList, sample, candidates, ringLinks, mapRing = null, profiled = false,
  } = await checkerScan(center, mode, depth) || await rpcScan(center, mode, depth, onProgress);
  const followers = followerList || [];
  const followerSet = new Set(followers);
  const ring = mode === 'followers' ? followers
    : mode === 'mutuals' ? following.filter((n) => followerSet.has(n))
      : following;

  // The checker's candidates come with their profile fields (from HafSQL)
  // and a full `count`; `via` may be cut down to the accounts on the map.
  let suggestions = candidates.map((c) => ({
    name: c.name,
    count: c.count ?? c.via.length,
    via: c.via,
    ...(profiled && {
      rep: c.rep ?? null, active: c.active ?? null, followers: c.followers ?? null, displayName: c.displayName || '',
    }),
  }));

  const names = suggestions.map((s) => s.name);
  const [profRes, countRes] = await Promise.allSettled([
    profiled ? null : fetchProfiles(names),
    fetchCreatorCounts(names),
  ]);
  const prof = profRes.status === 'fulfilled' ? profRes.value : null;
  const counts = countRes.status === 'fulfilled' ? countRes.value : null;

  if (prof) suggestions = suggestions.filter((s) => !prof.missing.has(s.name));
  suggestions = suggestions.map((s) => {
    const c = counts?.[s.name];
    const p = prof?.profiles[s.name];
    return {
      ...s,
      ...(!profiled && {
        rep: p ? Number(p.reputation) || 0 : null,
        active: p?.active ? Date.parse(`${p.active}Z`) : null,
        followers: p?.stats?.followers ?? null,
        displayName: p?.metadata?.profile?.name || '',
      }),
      videos: counts ? (c?.videos || 0) : null,
      shorts: counts ? (c?.shorts || 0) : null,
    };
  });

  const leads = {};
  suggestions.forEach((s) => s.via.forEach((v) => { (leads[v] ||= []).push(s.name); }));

  // Two or more ring members lead there; on a small ring, one will do.
  const strong = suggestions.filter((s) => s.count >= 2).length;

  return {
    center,
    mode,
    at: Date.now(), // "active N days ago" counts from when this was read
    following,
    followers,
    followersKnown: !!followerList,
    ring,
    sampled: sample,
    leads,
    ringLinks,
    mapRing,
    suggestions,
    defaultMinCount: strong >= 12 ? 2 : 1,
    enriched: { profiles: profiled || !!prof, creators: !!counts },
    truncated: { following: following.length >= MAX_LIST, followers: followers.length >= MAX_LIST },
  };
}

// Links of one picked star: who it follows and who follows it. Followers are
// capped lower than the centre's: for a selection the overlap with the map is
// what matters, and the scan data fills in the scanned followers anyway.
const LINK_FOLLOWERS_MAX = 3000;
export async function fetchLinks(account) {
  const [following, followers] = await Promise.all([
    fetchFollowing(account),
    fetchFollowers(account, LINK_FOLLOWERS_MAX).catch(() => []),
  ]);
  return { following, followers };
}

// Circles: groups of accounts the same people follow, found by community
// detection (Louvain) on the scan's graph. Ring members count as much as
// suggestions: a circle can be mostly accounts the centre already follows.
// Each is named after its most-followed member. Computed over every
// candidate, not just the filtered ones, so filtering never regroups the sky.
const MIN_CIRCLE = 3;
const MAX_CIRCLES = 10;

// The scan as a graph. Nodes: the ring members on the map that carry a link
// (every scanned one, plus the others a scanned one follows), then every
// suggestion. Edges join a scanned member to each node it follows. `index`
// maps a name to its node, `group` is the Louvain grouping. Shared by the
// circles list and the 3D layout (which pulls each group into one patch), so
// both always agree. Unlinked ring members stay out: they would only be
// pushed around, and the scene spreads them evenly instead.
const graphs = new WeakMap();
export function scanGraph(data) {
  if (graphs.has(data)) return graphs.get(data);
  const ringLinks = data.ringLinks || {};
  const scanned = new Set(data.sampled);
  const linked = new Set();
  Object.values(ringLinks).forEach((list) => list.forEach((n) => linked.add(n)));
  const ringNodes = ringOnMap(data).filter((n) => scanned.has(n) || linked.has(n));
  const nodes = [...ringNodes, ...data.suggestions.map((s) => s.name)];
  const index = new Map(nodes.map((n, i) => [n, i]));
  const edges = [];
  data.suggestions.forEach((s) => s.via.forEach((v) => {
    if (index.has(v)) edges.push([index.get(v), index.get(s.name)]);
  }));
  data.sampled.forEach((v) => (ringLinks[v] || []).forEach((n) => {
    if (index.has(n)) edges.push([index.get(v), index.get(n)]);
  }));
  const n = nodes.length;
  const seed = seedOf(`${data.center}:${data.mode}`);
  const graph = { n, nodes, ringCount: ringNodes.length, index, edges, seed, group: louvain(n, edges, { seed }) };
  graphs.set(data, graph);
  return graph;
}

// [{ id, lead, ring: [names], suggestions: [names] }], biggest first. Members
// in each list are most-followed (by scanned accounts) first.
export function findCircles(data) {
  const { nodes, ringCount, edges, group } = scanGraph(data);
  const inDeg = new Array(nodes.length).fill(0);
  edges.forEach(([, b]) => { inDeg[b] += 1; });
  const byGroup = new Map();
  nodes.forEach((name, i) => {
    const g = group[i];
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(i);
  });
  return [...byGroup.values()]
    .filter((members) => members.length >= MIN_CIRCLE)
    .sort((a, b) => b.length - a.length)
    .slice(0, MAX_CIRCLES)
    .map((members, i) => {
      const ranked = [...members].sort((a, b) => inDeg[b] - inDeg[a] || a - b);
      return {
        id: `c${i}`,
        lead: nodes[ranked[0]],
        ring: ranked.filter((k) => k < ringCount).map((k) => nodes[k]),
        suggestions: ranked.filter((k) => k >= ringCount).map((k) => nodes[k]),
      };
    });
}

// The ring members the map draws: every scanned one (they carry the links),
// then the rest up to `max`, so a huge ring stays a readable cloud.
export const MAX_RING_STARS = 700;
export function ringOnMap(data, max = MAX_RING_STARS) {
  // A checker scan already picked them: the best-linked members of the ring.
  if (data.mapRing) return data.mapRing.slice(0, max);
  const scanned = new Set(data.sampled);
  const rest = data.ring.filter((n) => !scanned.has(n));
  return [...data.sampled, ...rest.slice(0, Math.max(0, max - data.sampled.length))];
}
