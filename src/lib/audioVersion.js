// "Publish as audio": a creator's own video as an MP3 (server/audio-version.cjs),
// handed to the audio uploader with the video as its source (lib/derived.js,
// kind audio_version). The server only answers for a login it can prove, like
// /narrate (lib/narration.js).
import { getCurrentProvider, Providers } from '../hive-api/aioha';

const API = import.meta.env.VITE_THREESPEAK_API || '/api';
const SITE = 'https://3speak.tv';

function headers(json) {
  const h = json ? { 'Content-Type': 'application/json' } : {};
  if (getCurrentProvider() === Providers.HiveSigner) {
    const tok = localStorage.getItem('hivesignerToken');
    if (tok) h.Authorization = `Bearer ${tok}`;
  }
  return h;
}

async function send(path, { method = 'GET', body } = {}, fetchFn = fetch) {
  const go = () => fetchFn(`${API}/audio-version${path}`, {
    method,
    headers: headers(body !== undefined),
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
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

async function failed(res) {
  const data = await res.json().catch(() => ({}));
  return Object.assign(new Error(data?.error || `HTTP ${res.status}`), { status: res.status, code: data?.errorCode || null, id: data?.id || null });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The MP3 of author/permlink as a Blob: starts a job (or picks up the one already
 * running), waits for it, downloads it. Throws with `code` from the server.
 */
export async function makeAudioVersion(author, permlink, { fetchFn = fetch, pollMs = 3000, maxPolls = 900 } = {}) {
  let res = await send('/jobs', { method: 'POST', body: { author, permlink } }, fetchFn);
  let id;
  if (res.ok) id = (await res.json()).id;
  else {
    const err = await failed(res);
    if (err.code !== 'busy' || !err.id) throw err;
    id = err.id;
  }
  for (let i = 0; i < maxPolls; i += 1) {
    res = await send(`/jobs/${id}`, {}, fetchFn);
    if (!res.ok) throw await failed(res);
    const s = await res.json();
    if (s.status === 'done') break;
    if (s.status === 'failed') throw Object.assign(new Error(s.error || 'failed'), { code: s.errorCode || 'failed' });
    if (i === maxPolls - 1) throw Object.assign(new Error('timed out'), { code: 'timeout' });
    await sleep(pollMs);
  }
  res = await send(`/jobs/${id}/audio`, {}, fetchFn);
  if (!res.ok) throw await failed(res);
  return res.blob();
}

/** The first lines of a video's text, without links, embeds or the 3Speak footer. */
export function excerptOf(body, max = 400) {
  const lines = String(body || '').split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^(https?:\/\/|!\[|\[!\[|<|---|▶)/.test(l));
  const text = lines.join('\n\n');
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/**
 * The audio uploader's start (the `open-audio-upload` event detail) for the MP3
 * of a video: its title, the start of its text plus a line back to the video,
 * its tags and cover, and the video as the source. `watchLabel` is the
 * translated "The video" lead-in.
 */
export function audioVersionUpload({ blob, author, permlink, title, body, tags = [], cover = '', watchLabel = 'The video' }) {
  const url = `${SITE}/@${author}/${permlink}`;
  const excerpt = excerptOf(body);
  return {
    blob,
    filename: `${permlink}.mp3`,
    type: 'podcast',
    source: 'import',
    prefill: {
      title: String(title || '').slice(0, 255),
      description: [excerpt, `${watchLabel}: ${url}`].filter(Boolean).join('\n\n'),
      tags: (tags || []).filter((x) => !/^hive-\d+$/.test(x)).slice(0, 8),
      coverUrl: /^https:\/\//.test(cover || '') ? cover : '',
      madeFrom: { kind: 'audio_version', author, permlink },
    },
  };
}
