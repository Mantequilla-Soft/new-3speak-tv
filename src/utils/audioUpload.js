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

/**
 * Upload an audio blob to the 3Speak audio service.
 * Mirrors snapie-io's `uploadAudioTo3Speak` contract:
 *   POST {THREESPEAK_AUDIO_API_URL}/api/audio/upload
 *   Headers: X-API-Key, X-User
 *   Body: multipart/form-data { audio, duration, format, title }
 *   Response: { success, permlink, cid, playUrl, apiUrl }
 */
export async function uploadAudioTo3Speak({ blob, durationSec, username, title }) {
  if (!THREESPEAK_API_KEY) {
    throw new Error('VITE_3SPEAK_API_KEY is not set');
  }
  if (!username) throw new Error('No username');
  if (!blob) throw new Error('No audio data');

  const isMp3 = (blob.type || '').includes('mpeg') || (blob.type || '').includes('mp3');
  const format = isMp3 ? 'mp3' : 'webm';

  const fd = new FormData();
  fd.append('audio', blob, `recording.${format}`);
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
