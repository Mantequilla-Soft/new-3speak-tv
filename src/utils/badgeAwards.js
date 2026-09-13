import axios from 'axios';
import { getHiveUrl } from './hiveNode';
import { CHECKER_URL } from './config';

/**
 * Awarding badges you control.
 *
 * A badge is a Hive account whose FOLLOWING list is the roll of who holds it,
 * so awarding one is a follow made by the badge. Whoever created it is in its
 * posting authority, which is what lets that person award it from their own
 * session without ever logging in as the badge.
 *
 * 🚨 Hive has NO reverse index from an account to the accounts that granted it
 * authority, so "which badges do I control?" cannot simply be asked. Scanning
 * the creator's account history for account_create is the only authoritative
 * route and `condenser_api.get_account_history` with an operation filter times
 * out on the public nodes (tried, 2026-09-10).
 *
 * So the checker keeps the pointer (`badge-creators`), written at creation and
 * chain-verified on both write and read. localStorage is only a same-session
 * cache in front of it: a badge made on a laptop has to be awardable from a
 * phone, which is precisely what a browser-local list cannot do.
 *
 * The record is a hint about where to look, never the thing that grants
 * permission — authority is re-checked against Hive before anything is offered.
 */

const KEY = 'created_badges';
const BADGE_PREFIX = 'badge-';

async function rpc(method, params) {
  const { data } = await axios.post(getHiveUrl(), { jsonrpc: '2.0', method, params, id: 1 });
  if (data?.error) throw new Error(data.error.message || method);
  return data?.result;
}

function readAll() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

/**
 * Note that `creator` made `account`, so it can be offered to them later.
 *
 * Written to the checker FIRST, because that is the copy that survives a
 * different device. The local copy is a cache so the picker is populated even
 * before the server round trip lands.
 */
export async function rememberCreatedBadge(creator, account) {
  if (!creator || !account) return;
  try {
    const all = readAll();
    const mine = new Set(all[creator] || []);
    mine.add(account);
    all[creator] = [...mine];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch { /* private mode: the server copy still has it */ }
  try {
    await axios.post(`${CHECKER_URL}/badges/created`, { creator, account });
  } catch (err) {
    // Not fatal: they can still award it in this browser, and typing the name
    // elsewhere recovers it. Logged because losing this quietly is how a badge
    // becomes un-awardable from every other device.
    console.warn('[badges] could not record the creator server-side:', err?.message);
  }
}

export function rememberedBadges(creator) {
  const all = readAll();
  return Array.isArray(all[creator]) ? all[creator] : [];
}

/** Does `username` actually hold posting authority over `account`, right now? */
export async function canAwardBadge(username, account) {
  const name = String(account || '').trim().toLowerCase();
  if (!username || !name) return false;
  try {
    const [acct] = await rpc('condenser_api.get_accounts', [[name]]) || [];
    if (!acct) return false;
    return (acct.posting?.account_auths || []).some(([who]) => who === username);
  } catch { return false; }
}

/**
 * The badges this user can award, verified on chain.
 *
 * Anything they no longer hold authority over is dropped rather than offered
 * and then failing at broadcast, which is a far worse way to find out.
 */
export async function listAwardableBadges(username) {
  if (!username) return [];
  // The server's list is the real one: it is not tied to this browser, and it
  // re-checks authority against the chain before answering.
  try {
    const { data } = await axios.get(`${CHECKER_URL}/badges/by-creator/${encodeURIComponent(username)}`);
    if (Array.isArray(data?.badges)) return data.badges;
  } catch (err) {
    console.warn('[badges] creator list unavailable, falling back to this browser:', err?.message);
  }

  // Fallback only: whatever this browser happens to remember, still verified on
  // chain so a stale entry cannot be offered.
  const names = rememberedBadges(username).filter((n) => n.startsWith(BADGE_PREFIX));
  if (!names.length) return [];
  let accounts;
  try {
    accounts = await rpc('condenser_api.get_accounts', [names]) || [];
  } catch { return []; }
  return accounts
    .filter((a) => (a.posting?.account_auths || []).some(([who]) => who === username))
    .map((a) => {
      let profile = {};
      try { profile = JSON.parse(a.posting_json_metadata || '{}')?.profile || {}; } catch { /* none */ }
      return {
        account: a.name,
        title: profile.name || a.name,
        image: profile.profile_image || '',
      };
    });
}

/** Who already holds this badge, so it is not awarded twice. */
export async function badgeHolders(badgeAccount) {
  try {
    const rows = await rpc('condenser_api.get_following', [badgeAccount, '', 'blog', 1000]);
    return new Set((rows || []).map((r) => r.following));
  } catch { return new Set(); }
}

/**
 * Tell the checker a community exists, so it appears in 3Speak's own list now
 * rather than at the next scheduled pass over every community on Hive.
 *
 * Chain-verified server-side: it stores what Hive says, never what we send.
 */
export async function indexNewCommunity(name) {
  if (!name) return;
  try {
    await axios.post(`${CHECKER_URL}/community/created`, { name });
  } catch (err) {
    console.warn('[communities] could not index the new community:', err?.message);
  }
}
