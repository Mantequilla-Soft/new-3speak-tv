/**
 * Highlight clips that become Shorts (H13), on the stream's own hangouts server.
 *
 *   POST /rooms/:room/dvr/clip      a viewer (or the host) clips the last 30 s;
 *                                   signed in, they are credited as the clipper
 *   GET  /rooms/:room/highlights    the host: chat and boost moments + every clip;
 *                                   anyone else signed in: their own clips
 *   DELETE /clips/:id               the host or the clipper drops a clip
 *
 * A clip is posted as a 3Speak Short through the normal Shorts upload, with a
 * locked beneficiary for the other side (clipShareFor): the host posting a
 * viewer's clip gives the clipper 30%; a viewer posting their clip of someone's
 * stream gives the host 50%, since it is the host's show.
 */
import { HIVE_MAX_BENEFICIARIES } from '../utils/beneficiaries';

export const CLIPPER_SHARE_PERCENT = 30;
export const HOST_SHARE_PERCENT = 50;

const lc = (s) => String(s || '').trim().toLowerCase();
const base = (api) => String(api || '').replace(/\/+$/, '');
const auth = (token) => (token ? { Authorization: `Bearer ${token}` } : {});

/**
 * The locked share the Short gives the other party, or null.
 * { account, percent, role: 'clipper' | 'host' }
 */
export function clipShareFor({ poster, host, clipper }) {
  const p = lc(poster); const h = lc(host); const c = lc(clipper);
  if (!p) return null;
  if (p === h && c && c !== h) return { account: c, percent: CLIPPER_SHARE_PERCENT, role: 'clipper' };
  if (p !== h && h) return { account: h, percent: HOST_SHARE_PERCENT, role: 'host' };
  return null;
}

/**
 * Publish-time: put the clip's share into the beneficiary map (Hive weights,
 * 1/100 %), at least its percent, when a slot is free. Mutates and returns it.
 */
export function applyClipShare(beneMap, streamClip, poster) {
  const share = streamClip?.share;
  if (!share?.account || lc(share.account) === lc(poster)) return beneMap;
  const weight = Math.round(Number(share.percent) * 100);
  if (!(weight > 0 && weight <= 10000)) return beneMap;
  if (!beneMap.has(share.account) && beneMap.size >= HIVE_MAX_BENEFICIARIES) return beneMap;
  beneMap.set(share.account, Math.max(beneMap.get(share.account) || 0, weight));
  return beneMap;
}

/** What the Short's json_metadata records about where the clip came from. */
export function streamClipMetadata(streamClip) {
  if (!streamClip?.room) return null;
  return {
    room: String(streamClip.room),
    host: streamClip.host ? lc(streamClip.host) : null,
    clipper: streamClip.clipper ? lc(streamClip.clipper) : null,
    ...(Number.isFinite(streamClip.offsetSec) ? { offset: streamClip.offsetSec } : {}),
  };
}

export const clipFileUrl = (api, path) => `${base(api)}${path}`;

/** Clip the last 30 s. { path, clip? } (clip is the kept record when there is one). */
export async function makeClip(api, room, token) {
  const res = await fetch(`${base(api)}/rooms/${encodeURIComponent(room)}/dvr/clip`, { method: 'POST', headers: auth(token) });
  if (!res.ok) throw Object.assign(new Error(`clip: ${res.status}`), { status: res.status });
  return res.json();
}

/** { host, isHost, liveAt, moments, clips } or null when not signed in. */
export async function fetchStreamHighlights(api, room, token) {
  if (!api || !room || !token) return null;
  const res = await fetch(`${base(api)}/rooms/${encodeURIComponent(room)}/highlights`, { headers: auth(token) });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`highlights: ${res.status}`);
  const d = await res.json();
  return {
    host: d.host || null,
    isHost: d.isHost === true,
    liveAt: d.liveAt || null,
    moments: Array.isArray(d.moments) ? d.moments : [],
    clips: Array.isArray(d.clips) ? d.clips : [],
  };
}

/**
 * The URL to post as a Short: the 9:16 copy cut with the host's phone crop
 * (POST /clips/:id/vertical) when the stream had one, else the clip itself. A
 * failed vertical cut falls back to the landscape clip.
 */
export async function shortUrlFor(api, clip, token) {
  const plain = clipFileUrl(api, clip.path);
  if (!clip?.vertical?.available || !clip.id || !token) return plain;
  if (clip.vertical.path) return clipFileUrl(api, clip.vertical.path);
  try {
    const res = await fetch(`${base(api)}/clips/${encodeURIComponent(clip.id)}/vertical`, { method: 'POST', headers: auth(token) });
    if (!res.ok) return plain;
    const d = await res.json();
    return d?.clip?.vertical?.path ? clipFileUrl(api, d.clip.vertical.path) : plain;
  } catch {
    return plain;
  }
}

export async function deleteClip(api, id, token) {
  const res = await fetch(`${base(api)}/clips/${encodeURIComponent(id)}`, { method: 'DELETE', headers: auth(token) });
  if (!res.ok) throw new Error(`delete clip: ${res.status}`);
  return true;
}

/** The clip MP4 as a File for the Shorts upload. */
export async function fetchClipFile(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`clip file: ${res.status}`);
  const blob = await res.blob();
  return new File([blob], 'stream-clip.mp4', { type: blob.type || 'video/mp4' });
}

/** Save a clip file to the device (the clip host sends CORS, so a blob fetch works). */
export async function downloadClip(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`clip: ${res.status}`);
  const objUrl = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = objUrl;
  a.download = `3speak-clip-${Date.now()}.mp4`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objUrl), 15000);
}

/**
 * Moments that have no automatic clip of their own, as ranges on the stream's
 * replay (the watch page opens the Shorts editor on `short=S-E`). A moment's
 * offset is the END of its 20 s window; chat reacts after the fact, so the
 * range reaches 25 s further back.
 */
export function momentRanges(moments, clips) {
  const clipped = new Set((clips || []).filter((c) => c.source === 'auto' && Number.isFinite(c.offsetSec)).map((c) => c.offsetSec));
  return (moments || [])
    .filter((m) => Number.isFinite(m.offsetSec) && !clipped.has(m.offsetSec))
    .map((m) => ({ start: Math.max(0, m.offsetSec - 45), end: Math.max(15, m.offsetSec + 5), reasons: m.reasons || [], moment: m }));
}

/** "4:07" / "1:05:09" */
export function clipClock(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** A clip has its MP4 (older servers send no status: ready). */
export const isReadyClip = (c) => !!c && (c.status == null || c.status === 'ready') && !!c.path;

/**
 * The clips a user made and every clip of their own streams, from one hangouts
 * server: { clips, keepHours } (each clip tagged with the server's base URL as api), or null
 * when not signed in there.
 */
export async function fetchMyClips(api, token) {
  if (!api || !token) return null;
  const res = await fetch(`${base(api)}/clips/mine`, { headers: auth(token) });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`my clips: ${res.status}`);
  const d = await res.json();
  return {
    clips: (Array.isArray(d.clips) ? d.clips : []).map((c) => ({ ...c, api: base(api) })),
    keepHours: Number(d.keepHours) || 48,
  };
}

/**
 * The end screen's summary of a stream's clips: who clipped how many, the
 * automatic ones, and how many are still being cut.
 * -> { total, byUser: [{ user, count }], auto, guests, pending, ready }
 */
export function clipSummary(clips) {
  const list = Array.isArray(clips) ? clips : [];
  const counts = new Map();
  let auto = 0; let guests = 0; let pending = 0; let ready = 0;
  for (const c of list) {
    if (c.status === 'unavailable') continue;
    if (c.status === 'pending') pending += 1; else ready += 1;
    if (c.source === 'auto') auto += 1;
    else if (c.clipper) counts.set(c.clipper, (counts.get(c.clipper) || 0) + 1);
    else guests += 1;
  }
  const byUser = [...counts.entries()].map(([user, count]) => ({ user, count })).sort((a, b) => b.count - a.count || a.user.localeCompare(b.user));
  return { total: pending + ready, byUser, auto, guests, pending, ready };
}

// "Post selected as Shorts": the clips still to post, one Shorts upload after
// the other. Kept in this browser only.
const QUEUE_KEY = '3s-clip-post-queue';
export function readClipQueue() {
  try {
    const q = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
    return Array.isArray(q) ? q.filter((c) => c && c.id && c.api && c.path) : [];
  } catch { return []; }
}
export function writeClipQueue(list) {
  try {
    if (list && list.length) localStorage.setItem(QUEUE_KEY, JSON.stringify(list.slice(0, 40)));
    else localStorage.removeItem(QUEUE_KEY);
  } catch { /* storage off */ }
}
