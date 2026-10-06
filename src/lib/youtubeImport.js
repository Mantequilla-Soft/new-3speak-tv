// ▶️ YouTube import: client for /api/yt-import/* (server/youtube-import.cjs).
//
// The server only answers for a login it can PROVE (butrauth session, wallet
// session cookie, HiveSigner token), because it lists and downloads videos of the
// caller's verified channel. Wallet logins whose session cookie has lapsed get a
// 401; re-mint it once and retry, the same recovery lib/incubation.js does.

import { getCurrentProvider, Providers } from '../hive-api/aioha';

const API = import.meta.env.VITE_THREESPEAK_API || '/api';

function headers(json) {
  const h = json ? { 'Content-Type': 'application/json' } : {};
  if (getCurrentProvider() === Providers.HiveSigner) {
    const tok = localStorage.getItem('hivesignerToken');
    if (tok) h.Authorization = `Bearer ${tok}`;
  }
  return h;
}

async function call(path, { method = 'GET', body, raw = false } = {}) {
  const send = () => fetch(`${API}/yt-import${path}`, {
    method,
    headers: headers(body !== undefined),
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let res = await send();
  if (res.status === 401) {
    try {
      const { establishWalletSession } = await import('../hive-api/aioha');
      if (await establishWalletSession()) res = await send();
    } catch { /* keep the 401 */ }
  }
  if (raw && res.ok) return res;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.code = data?.errorCode || null;
    throw err;
  }
  return data;
}

export const getImportStatus = () => call('/status');

export const listChannelVideos = ({ channel, type, pageToken } = {}) => {
  const qs = new URLSearchParams();
  if (channel) qs.set('channel', channel);
  if (type) qs.set('type', type);
  if (pageToken) qs.set('pageToken', pageToken);
  const q = qs.toString();
  return call(`/videos${q ? `?${q}` : ''}`);
};

// A pasted TikTok / Instagram link → { video } if it belongs to one of the user's verified accounts.
export const resolveImportUrl = (url) => call('/resolve', { method: 'POST', body: { url } });

// The newest TikToks (TikTok's creator embed serves 10) of the user's verified handle(s).
export const listTikTokVideos = () => call('/tiktok/videos');

// The newest Instagram video posts (from the profile's 12 newest posts) of the user's verified account(s).
export const listInstagramVideos = () => call('/instagram/videos');

// BitChute / Rumble: a page (25, newest first) of the user's verified channel(s). { videos, hasMore }
export const listPlatformVideos = (platform, page = 0) => call(`/${platform}/videos?page=${page}`);

// YouTube videos go by id; looked-up TikToks / Instagram posts by the token the lookup returned.
// After publishing an imported video: source ("<youtube id>" / "tiktok:<id>" / "instagram:<shortcode>") is
// now this 3Speak post. Feeds the ✓ "On 3Speak" mark in the import grid.
export const markImportPublished = (source, permlink) => call('/published', { method: 'POST', body: { source, permlink } });

export const startImportJob = (video) => call('/jobs', {
  method: 'POST',
  body: video.token ? { token: video.token } : { videoId: video.id },
});
export const getImportJob = (id) => call(`/jobs/${encodeURIComponent(id)}`);

// ▶️ Batch import: up to 5 videos imported and published server side, the posts
// going out one by one through the checker's scheduled posts (as @threespeak).
// items: [{ videoId }] for YouTube, [{ token }] for looked-up TikTok / Instagram.
export const getImportBatches = () => call('/batch');
export const createImportBatch = (items, options) => call('/batch', { method: 'POST', body: { items, options } });
export const cancelImportBatch = (id) => call(`/batch/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
export const cancelImportJob = (id) => call(`/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => null);

/** Pull the finished download into the browser as a File, reporting 0..1 progress. */
export async function downloadImportFile(id, videoId, onProgress) {
  const res = await call(`/jobs/${encodeURIComponent(id)}/file`, { raw: true });
  const total = Number(res.headers.get('content-length')) || 0;
  let blob;
  if (res.body && total && onProgress) {
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      onProgress(got / total);
    }
    blob = new Blob(chunks, { type: 'video/mp4' });
  } else {
    blob = await res.blob();
  }
  return new File([blob], `import-${videoId}.mp4`, { type: 'video/mp4' });
}

/** The video's thumbnail as a data URL (proxied by our API, so no CORS trouble). null on failure. */
export async function fetchThumbnailDataUrl(video) {
  try {
    const src = video.platform !== 'youtube' ? video.thumbnail : `${API}/yt-import/thumb/${encodeURIComponent(video.id)}`;
    if (!src) return null;
    const res = await fetch(src, { credentials: 'include' });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

// Hive tags: lowercase, a-z0-9 and dashes, max 24 chars. YouTube tags are free
// text ("my vlog"), so squash them and fill up with hashtags from the description.
export function toHiveTags(video, max = 8) {
  const raw = [...(video.tags || [])];
  for (const m of String(video.description || '').matchAll(/#([\p{L}\p{N}_-]{2,})/gu)) raw.push(m[1]);
  const out = [];
  for (const tag of raw) {
    const clean = String(tag).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 24);
    if (clean.length >= 2 && !/^\d/.test(clean) && !out.includes(clean)) out.push(clean);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Hand-off to the embed studio. EmbedStudioPage picks the file up through the
 * same window.__pwaSharedFile path the vertical-short redirect uses, and the
 * metadata through window.__ytImportMeta.
 */
export function handOffToStudio(file, video, thumbnailDataUrl, mode = 'longform') {
  window.__pwaSharedFile = file;
  window.__ytImportMeta = {
    mode,
    videoId: video.id,
    // Provenance for the post's json_metadata.imported_from
    platform: video.platform || 'youtube',
    sourceUrl: video.sourceUrl || youtubeWatchUrl(video.id),
    title: String(video.title || '').slice(0, 255),
    description: String(video.description || ''),
    tags: toHiveTags(video),
    thumbnail: thumbnailDataUrl || null,
  };
}

export const youtubeStudioUrl = (videoId) => `https://studio.youtube.com/video/${videoId}/edit`;
export const youtubeWatchUrl = (videoId) => `https://www.youtube.com/watch?v=${videoId}`;
