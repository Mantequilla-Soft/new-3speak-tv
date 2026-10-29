import axios from 'axios';
import { useQuery } from '@tanstack/react-query';
import { CHECKER_URL } from '../utils/config';

// Supporters: tips (any amount) sent from a video's tip button. The
// checker only stores a tip it finds on chain (routes/supports.js), so the
// client just reports "I tipped this video" and retries until the transfer has
// landed in a block.
//
// The report is saved in localStorage BEFORE the transfer is broadcast and only
// removed once the checker gives a final answer. A page reload while the wallet
// is still signing (a Vite reload, the tab closed right after tipping) would
// otherwise lose it: the wallet still broadcasts, but nobody reports it.
// resumePendingSupports() picks them up on the next app start.

// Must match LOOKBACK_MS in the checker's routes/supports.js: older than this,
// the checker can't find the transfer any more, so the report is dropped.
const SUPPORT_WINDOW_MS = 24 * 60 * 60 * 1000;

// Seconds after the transfer at which to ask. A block is 3s; HiveAuth and
// Butter Auth approvals can take a while longer to broadcast.
const RETRY_DELAYS_MS = [3000, 6000, 10000, 20000, 40000];

const PENDING_KEY = '3speak_pending_supports';
const MAX_PENDING = 10;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readPending() {
  try {
    const list = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writePending(list) {
  try {
    if (list.length) localStorage.setItem(PENDING_KEY, JSON.stringify(list.slice(-MAX_PENDING)));
    else localStorage.removeItem(PENDING_KEY);
  } catch { /* storage blocked: the in-page report still runs */ }
}

export function dropPendingSupport(id) {
  if (id) writePending(readPending().filter((p) => p.id !== id));
}

const qualifies = ({ tipper, author, permlink, amount, currency }) =>
  !!(tipper && author && permlink && tipper !== author)
  && Number(amount) > 0 && (currency === 'HBD' || currency === 'HIVE');

/**
 * Save a tip report before its transfer is broadcast. Returns the entry to hand
 * to recordSupport() (null when the tip can't qualify, so there is nothing to report).
 */
export function queueSupport({ tipper, author, permlink, amount, currency, memo }) {
  const entry = { tipper, author, permlink, amount: Number(amount), currency, memo: memo || '' };
  if (!qualifies(entry)) return null;
  entry.id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  entry.createdAt = Date.now();
  writePending([...readPending(), entry]);
  return entry;
}

const inFlight = new Set();

/**
 * Report a queued tip, retrying until the checker gives a final answer, then
 * forget it. Fire and forget: never throws. A report still unanswered after the
 * retries stays queued for the next app start (until it falls out of the window).
 */
export async function recordSupport(entry) {
  if (!entry || !qualifies(entry) || inFlight.has(entry.id)) return null;
  inFlight.add(entry.id);
  try {
    for (const delay of RETRY_DELAYS_MS) {
      await sleep(delay);
      if (Date.now() - (entry.createdAt || 0) > SUPPORT_WINDOW_MS) break;
      try {
        const res = await axios.post(`${CHECKER_URL}/supports/record`,
          {
            tipper: entry.tipper, author: entry.author, permlink: entry.permlink,
            amount: entry.amount, currency: entry.currency, memo: entry.memo || '',
          },
          { validateStatus: (s) => s === 200 || s === 202 });
        // 200 = recorded, below the line or already counted: all final.
        if (res.status === 200) {
          dropPendingSupport(entry.id);
          return res.data;
        }
      } catch (err) {
        const status = err?.response?.status;
        // 400 / 404 won't change on retry. A 429, a 5xx (a Hive node blip) or no
        // answer at all might, so those keep the report.
        if (status === 400 || status === 404) {
          dropPendingSupport(entry.id);
          return null;
        }
        if (status === 429) return null;
      }
    }
    if (Date.now() - (entry.createdAt || 0) > SUPPORT_WINDOW_MS) dropPendingSupport(entry.id);
    return null;
  } finally {
    inFlight.delete(entry.id);
  }
}

/**
 * On app start: report every queued tip still inside the checker's window, and
 * drop the stale ones. Runs whoever is logged in now, the checker checks the
 * transfer on chain either way.
 */
export function resumePendingSupports() {
  const now = Date.now();
  const list = readPending();
  const live = list.filter((p) => p && p.id && now - (p.createdAt || 0) <= SUPPORT_WINDOW_MS);
  if (live.length !== list.length) writePending(live);
  live.forEach((p) => { recordSupport(p); });
}

// `includeHidden`: the creator's own Received tab also lists tips they hid.
export async function fetchSupports(author, page = 1, limit = 20, { includeHidden = false } = {}) {
  const params = { page, limit, ...(includeHidden ? { includeHidden: 1 } : {}) };
  const { data } = await axios.get(`${CHECKER_URL}/supports/${encodeURIComponent(author)}`, { params });
  return data;
}

// Tips this account SENT (the "Given" list), same item shape as fetchSupports.
export async function fetchSupportsGiven(tipper, page = 1, limit = 20) {
  const { data } = await axios.get(`${CHECKER_URL}/supports/by/${encodeURIComponent(tipper)}`, { params: { page, limit } });
  return data;
}

export async function fetchSupporters(author, limit = 12) {
  const { data } = await axios.get(`${CHECKER_URL}/supports/${encodeURIComponent(author)}/supporters`, { params: { limit } });
  return data;
}

// The top supporters shown in the profile's badge row. One query for the badge
// row and the tab header, so they share the cache.
export const SUPPORTERS_SHOWN = 6;
export function useSupporters(username) {
  return useQuery({
    queryKey: ['supporters', username],
    queryFn: () => fetchSupporters(username, SUPPORTERS_SHOWN),
    enabled: !!username,
    staleTime: 2 * 60 * 1000,
    // Every profile visit asks again: a tip reported from another tab, or by a
    // resumed report (resumePendingSupports) has no query client to invalidate.
    refetchOnMount: 'always',
    retry: false,
  });
}

// The other direction: creators this account has supported, biggest total first.
export async function fetchSupported(tipper, limit = 12) {
  const { data } = await axios.get(`${CHECKER_URL}/supports/by/${encodeURIComponent(tipper)}/supported`, { params: { limit } });
  return data;
}

export function useSupported(username) {
  return useQuery({
    queryKey: ['supported', username],
    queryFn: () => fetchSupported(username, SUPPORTERS_SHOWN),
    enabled: !!username,
    staleTime: 2 * 60 * 1000,
    refetchOnMount: 'always', // same reason as useSupporters()
    retry: false,
  });
}

// Where a tipped item lives on 3Speak: shorts link by their asset id, audio
// posts have their own page.
export function supportItemLink(item) {
  if (item.kind === 'audio') return `/audio/${item.author}/${item.permlink}`;
  if (item.kind === 'short' || item.video?.short) {
    return `/shorts?v=${item.author}/${item.video?.asset_permlink || item.permlink}`;
  }
  return `/@${item.author}/${item.permlink}`;
}

// HBD with Hive's 3 decimals. A tiny HIVE tip can be worth less than 0.001 HBD:
// that reads "<0.001 HBD", never "0.000 HBD".
export function formatHbd(n) {
  const v = Number(n || 0);
  if (v > 0 && v < 0.001) return '<0.001 HBD';
  return `${v.toFixed(3)} HBD`;
}

// Short form for chips and sub-tab totals: "0.001 HBD", "0.5 HBD", "4.48 HBD",
// "12.3 HBD", "150 HBD", "1.2k HBD". Never "0 HBD" for a real (tiny) tip.
export function formatHbdCompact(n) {
  const v = Number(n || 0);
  if (v <= 0) return '0 HBD';
  if (v < 0.001) return '<0.001 HBD';
  // 999.6 rounds to 1000 at 0 decimals, so it already reads as "1k".
  if (v >= 999.5) return `${(Math.round(v / 100) / 10).toString()}k HBD`;
  const decimals = v >= 100 ? 0 : v >= 10 ? 1 : v >= 1 ? 2 : 3;
  return `${parseFloat(v.toFixed(decimals))} HBD`;
}

// Lightning tips are kept in sats (the checker never converts them to HBD):
// "1,000 sats" in full, "1k sats" in the short form.
export function formatSats(n) {
  return `${Math.round(Number(n || 0)).toLocaleString()} sats`;
}

export function formatSatsCompact(n) {
  const v = Math.round(Number(n || 0));
  if (v >= 999500) return `${parseFloat((v / 1e6).toFixed(1))}M sats`;
  if (v >= 1000) return `${parseFloat((v / 1000).toFixed(1))}k sats`;
  return `${v} sats`;
}

// A total that can hold both: "4.48 HBD", "1k sats" or "4.48 HBD + 1k sats".
export function formatSupportTotal(hbd, sats, { compact = true } = {}) {
  const h = Number(hbd || 0);
  const s = Number(sats || 0);
  const fh = compact ? formatHbdCompact : formatHbd;
  const fs = compact ? formatSatsCompact : formatSats;
  if (s > 0 && h > 0) return `${fh(h)} + ${fs(s)}`;
  if (s > 0) return fs(s);
  return fh(h);
}
