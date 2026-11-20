// 🎙️ Blog to podcast: client for /api/narrate (server/narration.cjs).
//
// Like the automations, the server only answers for a login it can PROVE
// (ButrAuth session, wallet session cookie, HiveSigner token); a lapsed wallet
// session cookie gets one re-mint and a retry.

import { getCurrentProvider, Providers } from '../hive-api/aioha';

const API = import.meta.env.VITE_THREESPEAK_API || '/api';

function headers(type) {
  const h = type ? { 'Content-Type': type } : {};
  if (getCurrentProvider() === Providers.HiveSigner) {
    const tok = localStorage.getItem('hivesignerToken');
    if (tok) h.Authorization = `Bearer ${tok}`;
  }
  return h;
}

async function send(path, { method = 'GET', body, type } = {}) {
  const go = () => fetch(`${API}/narrate${path}`, {
    method,
    headers: headers(type || (body !== undefined ? 'application/json' : null)),
    credentials: 'include',
    body: body === undefined ? undefined : type ? body : JSON.stringify(body),
  });
  let res = await go();
  if (res.status === 401) {
    try {
      const { establishWalletSession } = await import('../hive-api/aioha');
      if (await establishWalletSession()) res = await go();
    } catch { /* keep the 401 */ }
  }
  return res;
}

async function call(path, opts) {
  const res = await send(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.code = data?.errorCode || null;
    err.allowance = data?.allowance || null;
    throw err;
  }
  return data;
}

export const getNarrationOptions = () => call('/options');
export const getMyPosts = (after) => call(`/posts${after ? `?after=${encodeURIComponent(after)}` : ''}`);
export const getScript = (author, permlink) => call('/script', { method: 'POST', body: { author, permlink } });
export const getScriptFromText = (body) => call('/script-text', { method: 'POST', body: { body } });
export const startNarration = (job) => call('/jobs', { method: 'POST', body: job });
export const getNarration = (id) => call(`/jobs/${encodeURIComponent(id)}`);
export const uploadNarrationMusic = (file) => call('/music', { method: 'POST', body: file, type: file.type || 'application/octet-stream' });

/** The finished MP3 as a Blob (the audio uploader publishes it). */
export async function getNarrationAudio(id) {
  const res = await send(`/jobs/${encodeURIComponent(id)}/audio`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
}

/** A music bed to listen to (focus mood or library song) as an object URL. */
export async function musicPreviewUrl(kind, id) {
  const res = await send(`/music/${encodeURIComponent(kind)}/${encodeURIComponent(id)}.mp3`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return URL.createObjectURL(await res.blob());
}

/** Seconds as "m:ss". */
export function clock(secs) {
  const s = Math.max(0, Math.round(Number(secs) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The "Listen" line added to the original post once the audio is out. */
export function listenLine(audioUrl, label) {
  return `\n\n---\n🎧 [${label}](${audioUrl})`;
}

/** The audio post's description: the start of the post, the link back, the synthetic-voice label. */
export function narrationDescription({ excerpt, postUrl, voiceName, labels }) {
  return [
    excerpt,
    postUrl ? `${labels.writtenPost} ${postUrl}` : '',
    labels.readBy(voiceName),
  ].filter(Boolean).join('\n\n');
}
