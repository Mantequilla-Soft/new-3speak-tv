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
 * viewer's clip gives the clipper 10%; a viewer posting their clip of someone's
 * stream gives the host 50%, since it is the host's show.
 */
import { HIVE_MAX_BENEFICIARIES } from '../utils/beneficiaries';

export const CLIPPER_SHARE_PERCENT = 10;
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
