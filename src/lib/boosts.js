import axios from 'axios';
import { useQuery } from '@tanstack/react-query';
import { CHECKER_URL } from '../utils/config';
import { requestLightningInvoice, hasWebln } from './lightningTip';

/**
 * 🚀 Boosts on 3Speak's own videos, shorts and audio: a tip with a message
 * (a "boostagram") that shows on the post's boost wall, plus optional streamed
 * sats while someone listens.
 *
 * A boost is sent by the tip window (TipModal with `boost`) like any tip: a HIVE
 * or HBD transfer signed in the viewer's wallet, or a Lightning invoice to the
 * creator. What makes it a boost is the memo (Lightning: the comment):
 *     "<message> https://3speak.tv/watch?v=<author>/<permlink> #boost"
 * The checker reads that format (utils/boosts.js there): it verifies the transfer
 * on Hive (or v4v.app's credit for Lightning) and lists it on the wall at
 * GET /boosts/:author/:permlink.
 *
 * Streaming: every minute of listening sends a few sats to the creator, only when
 * the listener turned it on, picked the amount and a monthly cap, and only through
 * a Lightning wallet in the browser (WebLN), which can pay without a prompt each
 * time when the listener gave 3Speak a budget there. Hive transfers are never sent
 * this way: Hive wallets ask every time, and nothing here signs one for the user.
 * Streamed payments carry `#stream` and are added up per listener and day on the
 * wall.
 */

export const BOOST_TAG = '#boost';
export const STREAM_TAG = '#stream';
export const BOOST_MESSAGE_MAX = 250;

/** The memo (or Lightning comment) of a boost: message, link, tag. */
export function boostMemo(message, link) {
  const typed = String(message || '').trim().slice(0, BOOST_MESSAGE_MAX);
  const withLink = link && !typed.includes(link) ? [typed, link].filter(Boolean).join(' ') : typed;
  return [withLink, BOOST_TAG].filter(Boolean).join(' ');
}

export const streamComment = (link) => [link, STREAM_TAG].filter(Boolean).join(' ');

export async function fetchBoostWall(author, permlink, limit = 30) {
  const { data } = await axios.get(`${CHECKER_URL}/boosts/${encodeURIComponent(author)}/${encodeURIComponent(permlink)}`, { params: { limit } });
  return data;
}

export const boostWallKey = (author, permlink) => ['boosts', author, permlink];

export function useBoostWall(author, permlink, enabled = true) {
  return useQuery({
    queryKey: boostWallKey(author, permlink),
    queryFn: () => fetchBoostWall(author, permlink),
    enabled: !!(enabled && author && permlink),
    staleTime: 60 * 1000,
    retry: false,
  });
}

/* ---------- Streaming sats ---------- */

export const STREAM_RATES = [5, 10, 21, 50];
export const STREAM_CAPS = [500, 1000, 5000, 10000];
const SETTINGS_KEY = '3speak_stream_sats';
const TALLY_KEY = '3speak_stream_sats_month';
export const DEFAULT_STREAM = { enabled: false, satsPerMinute: 10, monthlyCap: 1000 };

const monthOf = (now = Date.now()) => new Date(now).toISOString().slice(0, 7);

function readJson(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}
function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked: this tab only */ }
}

export function readStreamSettings() {
  const s = readJson(SETTINGS_KEY) || {};
  const rate = Number(s.satsPerMinute);
  const cap = Number(s.monthlyCap);
  return {
    enabled: s.enabled === true,
    satsPerMinute: Number.isInteger(rate) && rate >= 1 && rate <= 1000 ? rate : DEFAULT_STREAM.satsPerMinute,
    monthlyCap: Number.isInteger(cap) && cap >= 1 && cap <= 1000000 ? cap : DEFAULT_STREAM.monthlyCap,
  };
}

export const saveStreamSettings = (s) => writeJson(SETTINGS_KEY, s);

/** Sats streamed so far this calendar month (UTC). */
export function streamedThisMonth(now = Date.now()) {
  const t = readJson(TALLY_KEY);
  return t && t.month === monthOf(now) ? Number(t.sats) || 0 : 0;
}

export function addStreamed(sats, now = Date.now()) {
  writeJson(TALLY_KEY, { month: monthOf(now), sats: streamedThisMonth(now) + sats });
}

/**
 * What the next minute pays: the rate, or what is left under the cap, or 0
 * (off, or the cap is reached).
 */
export function nextStreamPayment(settings, spent) {
  if (!settings?.enabled) return 0;
  const left = settings.monthlyCap - spent;
  if (left <= 0) return 0;
  return Math.min(settings.satsPerMinute, left);
}

/** Streaming needs a browser Lightning wallet; without one the option is hidden. */
export const canStreamSats = () => hasWebln();

/**
 * Pay one minute: an invoice to the creator (same route as a Lightning tip, no
 * paid-poller since WebLN says when it is paid) and WebLN pays it.
 */
export async function payStreamMinute({ to, sats, link }) {
  const inv = await requestLightningInvoice({ to, sats, comment: streamComment(link), watch: false });
  await window.webln.enable();
  await window.webln.sendPayment(inv.pr);
  return inv.sats;
}
