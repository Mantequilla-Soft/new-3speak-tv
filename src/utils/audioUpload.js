import { resolveSnapsContainer } from './snapsContainer';
import { THREESPEAK_AUDIO_API_URL, THREESPEAK_API_KEY } from './config';

/**
 * Resolve the latest peak.snaps container post — used as the parent for snap-style replies.
 * Delegates to the shared resolver, which walks every Hive node and both
 * hivemind APIs before giving up (see utils/snapsContainer.js).
 */
export async function getSnapsContainer(opts) {
  return resolveSnapsContainer(opts);
}

// The audio service accepts a file by its extension alone (mp3, m4a, ogg, webm,
// wav) and stores `format` as sent; the RSS feeds turn that into the enclosure's
// MIME type. So name the file after its real type: the MIME type first, then the
// picked file's own extension. Anything else (flac, raw aac) keeps the old `webm`
// label, which the service accepts and its MP3 worker's ffmpeg sees through.
// webm comes first: Chrome's recorder says `audio/webm;codecs=opus`.
const MIME_FORMATS = [
  [/webm/, 'webm'],
  [/mpeg|mp3/, 'mp3'],
  [/mp4|m4a/, 'm4a'],
  [/ogg|opus/, 'ogg'],
  [/wav|wave/, 'wav'],
];
const SERVICE_FORMATS = new Set(['mp3', 'm4a', 'ogg', 'webm', 'wav']);

export function audioFormatFor(blob, filename) {
  const type = (blob?.type || '').toLowerCase();
  for (const [re, format] of MIME_FORMATS) if (re.test(type)) return format;
  const ext = String(filename || '').split('.').pop().toLowerCase();
  return SERVICE_FORMATS.has(ext) ? ext : 'webm';
}

// Errors the upload modal turns into a translated line, keyed by `err.code`.
function uploadError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// iOS/iPadOS WebKit (so every iOS browser, Chrome included) can send a
// disk-backed File/Blob as an EMPTY multipart body: the headers go out, the
// bytes don't, and the audio service fails with busboy's "Unexpected end of
// form". All 20 attempts from one iPad (iPadOS 27.0.1) on 2026-10-31 did.
// Handing FormData an in-memory copy works around it, and reading the bytes
// first tells us up front when the file can no longer be read at all (e.g.
// after the tab was suspended), instead of POSTing nothing.
async function inMemoryCopy(blob) {
  let buf;
  try {
    buf = await blob.arrayBuffer();
  } catch {
    throw uploadError('unreadable', 'Could not read the audio file');
  }
  if (!buf.byteLength || buf.byteLength < blob.size) {
    throw uploadError('unreadable', 'Could not read the audio file');
  }
  return new Blob([buf], { type: blob.type });
}

/**
 * Upload an audio blob to the 3Speak audio service.
 * Mirrors snapie-io's `uploadAudioTo3Speak` contract:
 *   POST {THREESPEAK_AUDIO_API_URL}/api/audio/upload
 *   Headers: X-API-Key, X-User
 *   Body: multipart/form-data { audio, duration, format, title }
 *   Response: { success, permlink, cid, playUrl, apiUrl }
 * Throws with `err.code` 'unreadable' | 'rateLimited' | 'server' for the
 * failures the modal explains in the user's language.
 */
export async function uploadAudioTo3Speak({ blob, filename, durationSec, username, title }) {
  if (!THREESPEAK_API_KEY) {
    throw new Error('VITE_3SPEAK_API_KEY is not set');
  }
  if (!username) throw new Error('No username');
  if (!blob) throw new Error('No audio data');

  const format = audioFormatFor(blob, filename);
  // Built fresh on every call, so a retry never re-sends a spent FormData.
  const audio = await inMemoryCopy(blob);

  const fd = new FormData();
  fd.append('audio', audio, `recording.${format}`);
  fd.append('duration', String(Math.max(0, Math.round(durationSec || 0))));
  fd.append('format', format);
  fd.append('title', title || `Audio by ${username}`);

  const resp = await fetch(`${THREESPEAK_AUDIO_API_URL}/api/audio/upload`, {
    method: 'POST',
    headers: {
      'X-API-Key': THREESPEAK_API_KEY,
      'X-User': username,
    },
    body: fd,
  });

  if (!resp.ok) {
    let msg = `Upload failed (${resp.status})`;
    try {
      const data = await resp.json();
      msg = data.error || data.message || msg;
    } catch {}
    // The service's 5xx body is a bare "Internal server error", and its 429
    // comes from the upload rate limiter: both read better translated.
    if (resp.status === 429) throw uploadError('rateLimited', msg);
    if (resp.status >= 500) throw uploadError('server', msg);
    throw new Error(msg);
  }

  const data = await resp.json();
  // Normalize http→https on returned URLs (snapie does the same)
  const playUrl = data.playUrl?.replace(/^http:/, 'https:') || data.playUrl;
  const apiUrl = data.apiUrl?.replace(/^http:/, 'https:') || data.apiUrl;

  return {
    permlink: data.permlink,
    cid: data.cid,
    playUrl,
    apiUrl,
  };
}

/**
 * Tell the audio service which Hive post an upload became, right after the
 * post is broadcast. Without it the link waits for the checker's sync job
 * (every 30 min), and until then the track has no upvotes/payout on its tile
 * and is missing from the RSS feeds. Best effort: the sync job still catches
 * anything this misses.
 *   PATCH {THREESPEAK_AUDIO_API_URL}/api/audio/:permlink/post-permlink
 *   Headers: X-API-Key, X-User (must be the upload's owner)
 */
export async function linkAudioToPost({ audioPermlink, postPermlink, username }) {
  if (!THREESPEAK_API_KEY || !audioPermlink || !postPermlink || !username) return false;
  try {
    const resp = await fetch(
      `${THREESPEAK_AUDIO_API_URL}/api/audio/${encodeURIComponent(audioPermlink)}/post-permlink`,
      {
        method: 'PATCH',
        headers: {
          'X-API-Key': THREESPEAK_API_KEY,
          'X-User': username,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ post_permlink: postPermlink }),
      },
    );
    return resp.ok;
  } catch (err) {
    console.warn('Linking audio to its post failed (the sync job will catch it):', err?.message);
    return false;
  }
}
