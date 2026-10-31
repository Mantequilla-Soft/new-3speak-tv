// A creator's year on Hive, for the recap (page/Recap.jsx), from ONE pass over
// their own account history. All public data:
//   fans         who voted on and replied to their content most
//   followed     who they started following (and still follow)
//
// Hive lists every vote on an account's content and every reply to it in that
// account's own history, next to the account's own posts and follows, so the
// operation filter (vote, comment, custom_json) gets all three at once.
// Watch logs can't say "who watched": they keep no viewer identity (GDPR), so
// engagement stands in for an audience.

import axios from 'axios';
import { getHiveUrl } from '../utils/hiveNode';
import { CHECKER_URL } from '../utils/config';

// ── HafSQL first ────────────────────────────────────────────────────────────
// The checker answers fans and income for the whole window from HafSQL (one
// request, exact). The browser scans below are the fallback when it can't.
// One request per account and window, shared by both readers.
const sqlYear = new Map(); // `${user}:${days}` -> Promise<data | null>
function fetchSqlYear(user, days) {
  const key = `${user}:${days}`;
  if (!sqlYear.has(key)) {
    sqlYear.set(key, axios
      .get(`${CHECKER_URL}/creator-stats/hive-year`, { params: { username: user, days }, timeout: 45000 })
      .then(({ data }) => (data?.success ? data : null))
      .catch(() => null)
      .then((data) => {
        if (!data) sqlYear.delete(key); // try again next time
        return data;
      }));
  }
  return sqlYear.get(key);
}

// condenser_api operation filter bits: vote = 0, comment = 1, custom_json = 18.
const OP_FILTER = (1 << 0) | (1 << 1) | (1 << 18);
const PAGE = 1000;
// Every slide but the watch-time ones covers the full 12 months, so the
// history scans keep going back until the window's start. 40 pages of 1000
// covers a year for all but the very busiest accounts (a few seconds a page,
// on the loading screen); past that the slide says it is partial.
const MAX_PAGES = 40;
// A reply says more than a vote.
const COMMENT_WEIGHT = 3;
// Service accounts that vote or reply on everything: not fans.
const SERVICE_ACCOUNTS = new Set([
  'hivebuzz', 'pizzabot', 'lolzbot', 'hiq.smartbot', 'beerlover', 'peak.snaps',
  'ecency', 'threespeak', 'spk.beneficiary', 'hive.helps', 'tipu', 'wine.bot',
]);

// Accounts left out of EVERY account list in the recap (fans, follows,
// supporters, creators watched), at the team's request.
export const RECAP_EXCLUDED = new Set(['kgakakillerg', 'bpcvoter1']);
export const notExcluded = (name) => !RECAP_EXCLUDED.has(String(name || '').toLowerCase());

async function rpc(method, params) {
  const { data } = await axios.post(getHiveUrl(), { jsonrpc: '2.0', id: 1, method, params }, { timeout: 20000 });
  if (data?.error) throw new Error(data.error.message || method);
  return data?.result;
}

// A follow op's payload: ["follow", { follower, following, what: ["blog"] }].
function readFollow(op) {
  if (op.id !== 'follow') return null;
  try {
    const json = JSON.parse(op.json);
    const body = Array.isArray(json) && json[0] === 'follow' ? json[1] : null;
    if (!body || !body.following) return null;
    return { follower: body.follower, following: body.following, on: (body.what || []).includes('blog') };
  } catch {
    return null;
  }
}

/**
 * {
 *   fans: [{ account, votes, comments }],
 *   followed: [names, newest first], followedCount,
 * }
 */
export async function fetchHiveYear(user, { days = 365, fanLimit = 5 } = {}) {
  const sql = await fetchSqlYear(user, days);
  if (sql) {
    // Followed accounts come from the checker's follows route (also HafSQL);
    // `followed: null` tells the page this reader did not scan for them.
    const fans = sql.fans.filter((f) => !SERVICE_ACCOUNTS.has(f.account) && notExcluded(f.account)).slice(0, fanLimit);
    return { fans, followed: null, followedCount: 0, source: 'hafsql' };
  }
  return scanHiveYear(user, { days, fanLimit });
}

// Fallback: page through the account's own history in the browser.
async function scanHiveYear(user, { days = 365, fanLimit = 5 } = {}) {
  const cutoff = Date.now() - days * 86400000;
  const fans = new Map();
  const follows = []; // { at, account, on }

  const bump = (account, key) => {
    if (!account || account === user || SERVICE_ACCOUNTS.has(account) || !notExcluded(account)) return;
    if (!fans.has(account)) fans.set(account, { account, votes: 0, comments: 0 });
    fans.get(account)[key] += 1;
  };

  let start = -1;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const rows = (await rpc('condenser_api.get_account_history', [user, start, PAGE, OP_FILTER, 0])) || [];
    if (!rows.length) break;
    for (const [, entry] of rows) {
      const at = Date.parse(`${entry.timestamp}Z`);
      if (at < cutoff) continue;
      const [type, op] = entry.op;
      if (type === 'vote') {
        if (op.author === user) bump(op.voter, 'votes');
      } else if (type === 'comment') {
        if (op.parent_author === user) bump(op.author, 'comments');
      } else if (type === 'custom_json') {
        const f = readFollow(op);
        if (f && f.follower === user && f.following !== user) follows.push({ at, account: f.following, on: f.on });
      }
    }
    const firstIndex = rows[0][0];
    if (firstIndex === 0 || Date.parse(`${rows[0][1].timestamp}Z`) < cutoff) break;
    start = firstIndex - 1;
  }

  const score = (f) => f.votes + f.comments * COMMENT_WEIGHT;
  const topFans = [...fans.values()]
    .sort((a, b) => score(b) - score(a) || a.account.localeCompare(b.account))
    .slice(0, fanLimit);

  // Last word per account wins: followed then unfollowed in the year = not counted.
  const last = new Map();
  follows.sort((a, b) => a.at - b.at).forEach((f) => last.set(f.account, f));
  const followed = [...last.values()].filter((f) => f.on).sort((a, b) => b.at - a.at).map((f) => f.account);

  return {
    fans: topFans,
    followed,
    followedCount: followed.length,
  };
}

/**
 * Accounts that started following `user`, newest first, from Hive's
 * notifications: follows are not in the followed account's own history, and
 * notifications only reach back about 90 days, so `since` says from when.
 * { accounts: [names], since: Date | null }
 */
export async function fetchNewFollowers(user, { days = 365, maxPages = 30 } = {}) {
  const cutoff = Date.now() - days * 86400000;
  const seen = new Set();
  const accounts = [];
  let since = null;
  let lastId = null;
  for (let page = 0; page < maxPages; page += 1) {
    const params = { account: user, limit: 100 };
    if (lastId) params.last_id = lastId;
    const rows = (await rpc('bridge.account_notifications', params)) || [];
    if (!rows.length) break;
    let done = false;
    for (const n of rows) {
      const at = Date.parse(`${n.date}Z`);
      if (at < cutoff) { done = true; break; }
      since = new Date(at);
      if (n.type !== 'follow') continue;
      const name = (String(n.url || '').match(/^@([a-z0-9.-]+)/) || String(n.msg || '').match(/^@([a-z0-9.-]+)/) || [])[1];
      if (name && name !== user && !seen.has(name) && !SERVICE_ACCOUNTS.has(name) && notExcluded(name)) {
        seen.add(name);
        accounts.push(name);
      }
    }
    if (done || rows.length < 100) break;
    lastId = rows[rows.length - 1].id;
  }
  return { accounts, since };
}

// A post's picture: its metadata image, else a 3Speak video/stream thumbnail
// (streams leave `image` empty and keep it in video.info.sourceMap), else the
// first image in the body.
function postImage(p) {
  const meta = p.json_metadata || {};
  const first = Array.isArray(meta.image) ? meta.image.find(Boolean) : null;
  if (first) return first;
  const info = meta.video?.info || {};
  const mapped = (info.sourceMap || []).find((x) => x?.type === 'thumbnail' && x.url);
  if (mapped) return mapped.url;
  if (info.thumbnail) return info.thumbnail;
  const inBody = String(p.body || '').match(/https?:\/\/\S+?\.(?:png|jpe?g|webp|gif)/i);
  return inBody ? inBody[0] : null;
}

/**
 * Where `user` posted in the window, from their own post list (every top-level
 * post, newest first, so a whole year is a few pages even for busy accounts).
 * { communities: [{ name, title, posts, items: [{ title, image, author, permlink }] }], total }
 * `items` = its posts there (up to 100), newest first, for the side panel.
 */
export async function fetchCommunityPosts(user, { days = 365, maxPages = 40, limit = 5 } = {}) {
  const cutoff = Date.now() - days * 86400000;
  const byCommunity = new Map();
  let last = null;
  for (let page = 0; page < maxPages; page += 1) {
    const params = { sort: 'posts', account: user, limit: 20, observer: '' };
    if (last) { params.start_author = last.author; params.start_permlink = last.permlink; }
    const rows = (await rpc('bridge.get_account_posts', params)) || [];
    const fresh = last ? rows.slice(1) : rows; // start_* is inclusive
    let done = !fresh.length;
    for (const p of fresh) {
      if (Date.parse(`${p.created}Z`) < cutoff) { done = true; break; }
      if (!p.community) continue;
      if (!byCommunity.has(p.community)) {
        byCommunity.set(p.community, { name: p.community, title: p.community_title || p.community, posts: 0, items: [] });
      }
      const c = byCommunity.get(p.community);
      c.posts += 1;
      if (c.items.length < 100) {
        c.items.push({ title: p.title, image: postImage(p), author: p.author, permlink: p.permlink });
      }
    }
    if (done || rows.length < 20) break;
    last = rows[rows.length - 1];
  }
  const communities = [...byCommunity.values()].sort((a, b) => b.posts - a.posts);
  const top = communities.slice(0, limit);
  // Each community's own picture address (profile_image): the recap tries our
  // image cache first, and needs the original when Hive's proxy refuses it.
  try {
    const accounts = (await rpc('condenser_api.get_accounts', [top.map((c) => c.name)])) || [];
    const imageOf = Object.fromEntries(accounts.map((a) => {
      let profile = {};
      try { profile = JSON.parse(a.posting_json_metadata || a.json_metadata || '{}').profile || {}; } catch { /* no profile */ }
      return [a.name, profile.profile_image || null];
    }));
    top.forEach((c) => { c.image = imageOf[c.name] || null; });
  } catch {
    // Pictures then come from the image cache alone.
  }
  return { communities: top, total: communities.length };
}

// condenser_api operation filter for income: transfer (2), author_reward (51),
// curation_reward (52). 2^51 + 2^52 + 2^2 is still an exact JS number.
const INCOME_FILTER = 2 ** 2 + 2 ** 51 + 2 ** 52;
// How the checker's ad payout job labels its transfers (services/adPayouts.js).
const AD_MEMO = '3Speak ad revenue share';
const amountOf = (s) => {
  const [n, asset] = String(s || '').split(' ');
  return [parseFloat(n) || 0, asset];
};

/**
 * What `user` earned on Hive in the window, from their own history:
 * author rewards (HBD + HIVE + HP), curation rewards (HP) and 3Speak ad
 * revenue (transfers with the payout memo). HP is converted from VESTS at
 * today's rate; `hivePrice` (HBD per HIVE, the chain's median feed) turns it
 * all into one HBD figure. { author, curation, ads, hivePrice, complete }.
 * `complete` is false when the scan stopped before the window's start.
 */
export async function fetchIncomeYear(user, { days = 365, maxPages = MAX_PAGES } = {}) {
  const sql = await fetchSqlYear(user, days);
  if (sql) {
    const [props, median] = await Promise.all([
      rpc('condenser_api.get_dynamic_global_properties', []),
      rpc('condenser_api.get_current_median_history_price', []),
    ]);
    const hpPerVest = amountOf(props.total_vesting_fund_hive)[0] / (amountOf(props.total_vesting_shares)[0] || 1);
    const hivePrice = amountOf(median.base)[0] / (amountOf(median.quote)[0] || 1);
    const a = sql.author;
    const payments = sql.ads.map((t) => ({
      kind: (String(t.memo).match(/\(([^)]+)\)/) || [])[1] || 'creator',
      period: (String(t.memo).match(/ - (\S+)\s*$/) || [])[1] || null,
      hbd: t.symbol === 'HBD' ? t.amount : 0,
      hive: t.symbol === 'HIVE' ? t.amount : 0,
    }));
    return {
      author: { hbd: a.hbd, hive: a.hive, hp: a.vests * hpPerVest, count: a.count },
      authorByPost: Object.fromEntries(Object.entries(a.byPost).map(([k, v]) => [k, { hbd: v.hbd, hive: v.hive, hp: v.vests * hpPerVest }])),
      curation: { hp: 0, count: 0 },
      ads: {
        hbd: payments.reduce((n, x) => n + x.hbd, 0),
        hive: payments.reduce((n, x) => n + x.hive, 0),
        count: payments.length,
        payments,
      },
      hivePrice,
      complete: true,
      source: 'hafsql',
    };
  }
  return scanIncomeYear(user, { days, maxPages });
}

// Fallback: page through the account's own history in the browser.
async function scanIncomeYear(user, { days = 365, maxPages = MAX_PAGES } = {}) {
  const cutoff = Date.now() - days * 86400000;
  const author = { hbd: 0, hive: 0, vests: 0, count: 0 };
  const byPost = new Map(); // permlink -> { hbd, hive, vests }: lets the caller split 3Speak from the rest
  const curation = { vests: 0, count: 0 };
  const ads = { hbd: 0, hive: 0, count: 0 };
  // Each ad payment with its memo's kind ("creator", "viewer", "creator+viewer", ...)
  // and period, so the caller can split creator from viewer revenue.
  const adPayments = [];
  let start = -1;
  let complete = false;
  for (let page = 0; page < maxPages; page += 1) {
    const rows = (await rpc('condenser_api.get_account_history', [user, start, PAGE, INCOME_FILTER, 0])) || [];
    if (!rows.length) { complete = true; break; }
    for (const [, entry] of rows) {
      if (Date.parse(`${entry.timestamp}Z`) < cutoff) continue;
      const [type, op] = entry.op;
      if (type === 'author_reward' && op.author === user) {
        author.hbd += amountOf(op.hbd_payout)[0];
        author.hive += amountOf(op.hive_payout)[0];
        author.vests += amountOf(op.vesting_payout)[0];
        author.count += 1;
        const post = byPost.get(op.permlink) || { hbd: 0, hive: 0, vests: 0 };
        post.hbd += amountOf(op.hbd_payout)[0];
        post.hive += amountOf(op.hive_payout)[0];
        post.vests += amountOf(op.vesting_payout)[0];
        byPost.set(op.permlink, post);
      } else if (type === 'curation_reward' && op.curator === user) {
        curation.vests += amountOf(op.reward)[0];
        curation.count += 1;
      } else if (type === 'transfer' && op.to === user && String(op.memo || '').startsWith(AD_MEMO)) {
        const [n, asset] = amountOf(op.amount);
        if (asset === 'HBD') ads.hbd += n; else if (asset === 'HIVE') ads.hive += n;
        ads.count += 1;
        // Memo: "3Speak ad revenue share (<kind>) - <periodKey>"
        const memo = String(op.memo);
        adPayments.push({
          kind: (memo.match(/\(([^)]+)\)/) || [])[1] || 'creator',
          period: (memo.match(/ - (\S+)\s*$/) || [])[1] || null,
          hbd: asset === 'HBD' ? n : 0,
          hive: asset === 'HIVE' ? n : 0,
        });
      }
    }
    const firstIndex = rows[0][0];
    if (firstIndex === 0 || Date.parse(`${rows[0][1].timestamp}Z`) < cutoff) { complete = true; break; }
    start = firstIndex - 1;
  }

  const [props, median] = await Promise.all([
    rpc('condenser_api.get_dynamic_global_properties', []),
    rpc('condenser_api.get_current_median_history_price', []),
  ]);
  const hpPerVest = amountOf(props.total_vesting_fund_hive)[0] / (amountOf(props.total_vesting_shares)[0] || 1);
  const hivePrice = amountOf(median.base)[0] / (amountOf(median.quote)[0] || 1);
  return {
    author: { hbd: author.hbd, hive: author.hive, hp: author.vests * hpPerVest, count: author.count },
    // Per rewarded permlink, HP already converted.
    authorByPost: Object.fromEntries([...byPost].map(([k, v]) => [k, { hbd: v.hbd, hive: v.hive, hp: v.vests * hpPerVest }])),
    curation: { hp: curation.vests * hpPerVest, count: curation.count },
    ads: { hbd: ads.hbd, hive: ads.hive, count: ads.count, payments: adPayments },
    hivePrice,
    complete,
  };
}
