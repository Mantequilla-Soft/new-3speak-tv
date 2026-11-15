/**
 * Premieres (checker routes/premieres.js): a scheduled video its creator listed
 * as a premiere. Before the start the watch address shows a countdown with
 * "Notify me"; at the start everyone plays it from the same second, with a live
 * chat beside it for the video's length plus a short grace; afterwards the chat
 * stays as timecoded "Premiere chat" messages under the video.
 *
 * Reads are public. Writes carry the session vouch the podcast progress already
 * holds (lib/podcastProgress.js sessionVouch), in a POST body. Nothing here is
 * ever posted to Hive.
 */
import { CHECKER_URL } from '../utils/config';
import { sessionVouch } from './podcastProgress';

const API = `${CHECKER_URL}/premieres`;
const enc = encodeURIComponent;
const videoUrl = (owner, permlink) => `${API}/${enc(owner)}/${enc(permlink)}`;

/**
 * The server's clock against ours, from a response's `now`: add it to Date.now()
 * to get the server's time, so a countdown and the shared offset agree for
 * everyone however far off a viewer's own clock is.
 */
export function clockSkew(serverNowIso, sentAt = Date.now(), receivedAt = Date.now()) {
  const server = Date.parse(serverNowIso);
  if (!Number.isFinite(server)) return 0;
  return server - (sentAt + receivedAt) / 2;
}

/** soon / live / ended at `nowMs` (server time), from the premiere's own window. */
export function premiereState(p, nowMs) {
  if (!p) return null;
  const start = Date.parse(p.startAt);
  const until = Date.parse(p.chatUntil);
  if (nowMs < start) return 'soon';
  if (nowMs < until) return 'live';
  return 'ended';
}

/** Seconds into the video everyone is at, or null once past its end (or before the start). */
export function sharedOffset(p, nowMs) {
  if (!p) return null;
  const s = (nowMs - Date.parse(p.startAt)) / 1000;
  if (s < 0) return null;
  if (p.duration > 0 && s >= p.duration) return null;
  return s;
}

async function readJson(res) {
  return res.json().catch(() => ({}));
}

/** { premiere, skew } or { premiere: null } when the post is no premiere. */
export async function fetchPremiere(owner, permlink) {
  const sent = Date.now();
  const res = await fetch(videoUrl(owner, permlink));
  const data = await readJson(res);
  if (res.status === 404) return { premiere: null, skew: clockSkew(data.now, sent) };
  if (!res.ok) throw new Error(`premiere: ${res.status}`);
  return { premiere: data.premiere || null, skew: clockSkew(data.now, sent) };
}

/** Upcoming and live premieres, soonest first; one creator's with `owner`. */
export async function fetchUpcomingPremieres({ owner = null, limit = 12 } = {}) {
  const q = new URLSearchParams({ limit: String(limit) });
  if (owner) q.set('owner', owner);
  const sent = Date.now();
  const res = await fetch(`${API}/upcoming?${q}`);
  if (!res.ok) throw new Error(`upcoming premieres: ${res.status}`);
  const data = await readJson(res);
  return { premieres: Array.isArray(data.premieres) ? data.premieres : [], skew: clockSkew(data.now, sent) };
}

async function vouchedPost(url, user, body) {
  const v = await sessionVouch(user);
  if (!v) throw Object.assign(new Error('not signed in'), { code: 'auth' });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, user, signature: v.signature, timestamp: v.timestamp }),
  });
  const data = await readJson(res);
  if (!res.ok) throw Object.assign(new Error(data.error || `premieres: ${res.status}`), { status: res.status });
  return data;
}

/** The viewer's reminders not over yet: { reminders, due } (due = started). */
export async function fetchMyPremiereReminders(user) {
  if (!user) return { reminders: [], due: [] };
  const v = await sessionVouch(user);
  if (!v) return { reminders: [], due: [] };
  const res = await fetch(`${API}/reminders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user, signature: v.signature, timestamp: v.timestamp }),
  });
  if (!res.ok) throw new Error(`premiere reminders: ${res.status}`);
  const data = await readJson(res);
  return { reminders: data.reminders || [], due: data.due || [] };
}

/** "Notify me" on or off: { reminded, reminders }. */
export function setPremiereReminder(user, owner, permlink, on = true) {
  return vouchedPost(`${videoUrl(owner, permlink)}/remind`, user, { on });
}

/** Chat after a time (ms, the last message's `at`): { messages, removed, open, state }. */
export async function fetchPremiereChat(owner, permlink, after = 0) {
  const res = await fetch(`${videoUrl(owner, permlink)}/chat${after ? `?after=${after}` : ''}`);
  if (!res.ok) throw new Error(`premiere chat: ${res.status}`);
  const data = await readJson(res);
  return {
    messages: data.messages || [], removed: data.removed || [], open: data.open === true, state: data.state || null,
  };
}

export async function sendPremiereChat(user, owner, permlink, text) {
  const data = await vouchedPost(`${videoUrl(owner, permlink)}/chat`, user, { text });
  return data.message;
}

export function removePremiereChat(user, owner, permlink, id) {
  return vouchedPost(`${videoUrl(owner, permlink)}/chat/remove`, user, { id });
}

/** Merge a poll into the list held: new ones appended in order, removed ones dropped. */
export function mergeChat(held, { messages = [], removed = [] }) {
  const gone = new Set(removed);
  const seen = new Set();
  const out = [];
  for (const m of [...held, ...messages]) {
    if (gone.has(m.id) || seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}
