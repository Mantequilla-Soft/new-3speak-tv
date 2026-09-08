import * as tus from 'tus-js-client';
import { toastIn } from './toast';
import { EMBED_API_KEY, CHECKER_URL, CHECKER_API_KEY } from './config';
import { pickEmbedEndpoint } from './embedEndpoints';

// Every toast from this module is headed "Live"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Live');

/**
 * Publish a finished OpenPods broadcast as the session's video-on-demand.
 *
 * The whole trick is the permlink: the embed service resolves it as
 *   tokenClaims?.permlink || metadata?.permlink || generateVideoId()
 * so an X-API-Key upload that passes `permlink` in its TUS metadata gets a
 * video row at exactly `{ owner: host, permlink: roomName }` — the same
 * identity as the live stream and the announcement post. The player already
 * tries the VIDEO lookup before the stream lookup, so every existing
 * `?v=host/roomName` link flips from "live" to the VOD by itself. Nothing in
 * the uploader or encoder changes.
 *
 * We deliberately set the permlink UP FRONT rather than renaming afterwards:
 * the encoder's webhook updates the row with `updateOne({ permlink })`, so a
 * post-upload rename would orphan the encode and the video would never reach
 * `status: 'published'`.
 *
 * Runs at module scope (not inside a component) so it keeps going after the
 * studio modal unmounts.
 */
export async function publishStreamVod({
  blob,
  filename,
  duration,
  roomName,
  owner,
  title,
  description,
  tags,
  thumbnailUrl,
}) {
  if (!blob || !roomName || !owner) return;

  if (!EMBED_API_KEY) {
    console.error('[streamVod] No embed API key configured — cannot publish the stream VOD.');
    toast.error('Stream ended, but the video could not be uploaded (upload key missing).');
    return;
  }

  const toastId = toast.loading('Uploading your stream video… 0%');

  try {
    const { base, uploadUrl } = await pickEmbedEndpoint();

    await new Promise((resolve, reject) => {
      const upload = new tus.Upload(blob, {
        endpoint: uploadUrl,
        chunkSize: 8 * 1024 * 1024,
        retryDelays: [0, 3000, 5000, 10000, 20000, 30000],
        removeFingerprintOnSuccess: true,
        headers: { 'X-API-Key': EMBED_API_KEY },
        metadata: {
          filename: filename || `${roomName}.webm`,
          filetype: blob.type || 'video/webm',
          frontend_app: '3speak-tv',
          owner,
          short: 'false',
          duration: String(Math.round(duration || 0)),
          // The stream id IS the asset permlink — see the note above.
          permlink: roomName,
        },
        onProgress: (sent, total) => {
          const pct = total ? Math.round((sent / total) * 100) : 0;
          toast.loading(`Uploading your stream video… ${pct}%`, { id: toastId });
        },
        onError: reject,
        onSuccess: resolve,
      });
      upload.start();
    });

    // Give the row a real title + link it to the announcement post. The Hive
    // post for this session lives at the SAME owner/permlink, so this is the
    // correct association, and it's what makes the title show up (the checker
    // reads hive_title || embed_title || originalFilename).
    const apiBase = (base || '').replace(/\/+$/, '');
    await fetch(`${apiBase}/video/${encodeURIComponent(roomName)}/hive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': EMBED_API_KEY },
      body: JSON.stringify({
        hive_author: owner,
        hive_permlink: roomName,
        hive_title: title || `Live stream — ${roomName}`,
        hive_body: description || '',
        hive_tags: Array.isArray(tags) ? tags : [],
      }),
    }).catch((err) => console.warn('[streamVod] hive association failed (non-fatal):', err));

    // Stamp it as an OpenPods recording so the profile's Streams tab can find
    // it without inferring from the filename.
    if (CHECKER_API_KEY) {
      await fetch(`${CHECKER_URL}/video/openpod`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CHECKER_API_KEY}` },
        body: JSON.stringify({ owner, permlink: roomName, room: roomName }),
      }).catch((err) => console.warn('[streamVod] openpod flag failed (non-fatal):', err));
    }

    if (thumbnailUrl) {
      await fetch(`${apiBase}/video/${encodeURIComponent(roomName)}/thumbnail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': EMBED_API_KEY },
        body: JSON.stringify({ thumbnail_url: thumbnailUrl }),
      }).catch((err) => console.warn('[streamVod] thumbnail failed (non-fatal):', err));
    }

    toast.success('Stream video uploaded — it will replace the live stream once encoding finishes.', {
      id: toastId,
      duration: 8000,
    });
  } catch (err) {
    console.error('[streamVod] upload failed:', err);
    toast.error('Stream ended, but the video upload failed.', { id: toastId });
  }
}

/**
 * Track a SERVER-SIDE VOD publish and mirror its progress into the same toasts
 * the old client upload used.
 *
 * The server now uploads the recording itself (see the hangouts server's
 * streamVodPublish), so there's nothing to upload here — we just poll the
 * status endpoint and narrate it. Runs at module scope so it keeps going after
 * the OpenPods modal unmounts, exactly like the upload used to.
 */
export async function trackServerVodPublish({ statusUrl }) {
  if (!statusUrl) return;
  const toastId = toast.loading('Saving your stream video…');
  const started = Date.now();
  const MAX_MS = 20 * 60 * 1000;   // give a long recording time to upload

  const poll = async () => {
    let state = null;
    try {
      const res = await fetch(statusUrl, { cache: 'no-store' });
      if (res.ok) state = await res.json();
    } catch { /* transient — try again */ }

    if (state?.status === 'uploading') {
      toast.loading(`Uploading your stream video… ${state.progress ?? 0}%`, { id: toastId });
    } else if (state?.status === 'processing') {
      toast.loading('Uploaded — the encoder is processing your video…', { id: toastId });
    } else if (state?.status === 'published') {
      toast.success('Stream video saved — it will replace the live stream once encoding finishes.', { id: toastId, duration: 8000 });
      return;
    } else if (state?.status === 'failed') {
      toast.error(`Stream ended, but the video couldn't be saved: ${state.error || 'upload failed'}.`, { id: toastId });
      return;
    }

    if (Date.now() - started > MAX_MS) {
      toast.error('Stream ended — the video is still processing; check your profile shortly.', { id: toastId, duration: 8000 });
      return;
    }
    setTimeout(poll, 3000);
  };
  void poll();
}
