import * as tus from 'tus-js-client';
import { EMBED_API_KEY, EMBED_UPLOAD_FALLBACK_HOSTS } from './config';
import { pickEmbedEndpoint, getEmbedHosts } from './embedEndpoints';

/**
 * Upload a video file to the embed service and return the finished asset.
 *
 * This is the same TUS pipeline the embed studio uses, minus the wizard: pick a
 * healthy embed host, PUT the file, and read the canonical
 * `https://play.3speak.tv/embed?v=owner/permlink` URL back out of the
 * `X-Embed-URL` response header.
 *
 * Extracted so flows OTHER than "publish a brand new post" can upload a file —
 * currently "replace the video on an existing post" in EditVideoModal. The
 * studio's own uploader lives inside EmbedUploadContext and is bound to that
 * wizard's step/progress state, so it can't be called from elsewhere.
 *
 * No Hive broadcast happens here. The caller decides what to do with the
 * resulting asset (publish a new post, or repoint an existing one).
 *
 * @param {File|Blob} file
 * @param {object}    opts
 * @param {string}    opts.owner               Hive account the asset belongs to
 * @param {number}   [opts.duration]           seconds, best-effort metadata
 * @param {(pct:number) => void} [opts.onProgress]
 * @param {(u:tus.Upload) => void} [opts.onStart]  receives the upload so callers can abort
 * @param {(host:string) => void} [opts.onEndpoint]  the chosen host, once picked
 * @returns {Promise<{embedUrl:string, owner:string, permlink:string}>}
 */
export async function uploadVideoAsset(file, { owner, duration = 0, onProgress, onStart, onEndpoint } = {}) {
  if (!file) throw new Error('No file given.');
  if (!owner) throw new Error('No owner given.');
  if (!EMBED_API_KEY) throw new Error('Uploads are not configured (missing embed API key).');

  const { base, uploadUrl } = await pickEmbedEndpoint();
  // Tell the caller WHICH host won the pick. With a pool configured this is a
  // load/health decision made per upload, so it is worth surfacing: when an
  // upload misbehaves, the first question is which endpoint took it.
  try { onEndpoint?.(hostLabel(base || uploadUrl)); } catch { /* display only */ }

  let embedUrl = '';
  await new Promise((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: uploadUrl,
      // Sequential 8MB chunks, matching the studio: large parallel chunks
      // contend for bandwidth and trip tusd's lock handling.
      chunkSize: 8 * 1024 * 1024,
      retryDelays: [0, 3000, 5000, 10000, 20000, 30000],
      removeFingerprintOnSuccess: true,
      // Retry network drops and the transient 5xx tusd returns for stalled
      // bodies, but never retry auth/4xx — those will fail identically forever.
      onShouldRetry: (err) => {
        const status = err?.originalResponse?.getStatus?.() ?? 0;
        return status === 0 || status === 409 || status === 423 || status === 429 || status >= 500;
      },
      headers: { 'X-API-Key': EMBED_API_KEY },
      metadata: {
        filename: file.name || 'video.mp4',
        filetype: file.type || 'video/mp4',
        frontend_app: '3speak-tv',
        owner,
        short: 'false',
        duration: String(Math.round(duration || 0)),
        // Deliberately NO `permlink`: the service mints a fresh asset id. A
        // replacement must become its own asset — reusing the old permlink
        // would overwrite media that existing embeds still point at.
      },
      onProgress: (sent, total) => {
        if (onProgress && total) onProgress(Math.round((sent / total) * 100));
      },
      onAfterResponse: (req, res) => {
        const header = res.getHeader('X-Embed-URL') || res.getHeader('x-embed-url');
        if (header) embedUrl = header;
      },
      onError: reject,
      onSuccess: resolve,
    });
    onStart?.(upload);
    upload.start();
  });

  if (!embedUrl) {
    throw new Error('Upload finished but the server did not return a video URL.');
  }

  // …/embed?v=owner/permlink — the pair the post's `video.info` block needs.
  let assetOwner = owner;
  let assetPermlink = '';
  try {
    const vParam = new URL(embedUrl).searchParams.get('v') || '';
    const [o, p] = vParam.split('/');
    if (o) assetOwner = o;
    if (p) assetPermlink = p;
  } catch { /* keep the caller's owner, leave permlink empty */ }

  return { embedUrl, owner: assetOwner, permlink: assetPermlink };
}

/**
 * Register a freshly-uploaded asset as the replacement for an existing video.
 *
 * Nothing swaps immediately: the new asset still has to encode. Once it does,
 * the embed service copies its manifest onto the ORIGINAL entry, so that entry
 * keeps its permlink, upload date, view count, Hive association and its place in
 * every feed. The Hive post is never edited.
 *
 * @param {string} newPermlink       the just-uploaded asset
 * @param {string} originalPermlink  the asset whose media it should replace
 */
export async function registerMediaReplacement(newPermlink, originalPermlink) {
  if (!newPermlink || !originalPermlink || !EMBED_API_KEY) return;
  return postToAnyEmbedHost(
    `/video/${encodeURIComponent(newPermlink)}/replaces`,
    { replaces: originalPermlink },
  );
}

/**
 * Ask whether a permlink's media can be replaced, and by whom — BEFORE uploading.
 *
 * Registration used to be the first thing that checked, which meant a rejected
 * replacement had already pushed a whole file through upload and encoding; and
 * since registration is also what delists the carrier asset, a failure left an
 * orphan video listed in the owner's profile with no Hive post behind it.
 *
 * Resolves to `{ found, kind: 'embed' | 'legacy', owner, status }`,
 * or `null` when no host could answer — callers treat that as "don't know" and
 * carry on rather than blocking an upload on a health check.
 *
 * @param {string} originalPermlink  the asset permlink the post points at
 */
export async function fetchReplaceTarget(originalPermlink) {
  if (!originalPermlink || !EMBED_API_KEY) return null;
  const path = `/video/${encodeURIComponent(originalPermlink)}/replace-target`;

  for (const apiBase of embedHostList()) {
    try {
      const res = await fetch(`${apiBase}${path}`, { headers: { 'X-API-Key': EMBED_API_KEY } });
      const data = await res.json().catch(() => null);
      if (res.ok && data) return data;
      // A 404 is only an ANSWER when it came from the handler. A host that
      // predates this route 404s too, with Express's HTML page — which parses as
      // null, so it falls through to the next host instead of being mistaken for
      // "this video does not exist".
      if (res.status === 404 && data && data.found === false) return data;
    } catch {
      // Unreachable host — try the next one.
    }
  }
  return null;
}

/** Every embed host worth asking, primary tier first, de-duplicated. */
function embedHostList() {
  return [...new Set(
    [...getEmbedHosts(), ...(EMBED_UPLOAD_FALLBACK_HOSTS || [])]
      .map((h) => (h || '').replace(/\/+$/, ''))
      .filter(Boolean),
  )];
}

/**
 * Turn per-host failures into one honest message.
 *
 * Every embed host shares a single MongoDB, so when they all answer the same way
 * the answer is the SERVICE's verdict, not a host being broken — naming a host
 * there sends whoever reads the toast hunting a deployment problem that doesn't
 * exist. (This is exactly how "replaces failed on embed-okinoko (404)" was read
 * as a missing deploy when it actually meant "that original isn't replaceable".)
 * Only when the hosts genuinely disagree is the per-host breakdown the story.
 */
function describeHostFailures(path, failures) {
  if (!failures.length) return `${path} failed: no embed host reachable`;

  const unanimous = failures.every(
    (f) => f.status === failures[0].status && f.message === failures[0].message,
  );
  if (unanimous) {
    const { status, message } = failures[0];
    return message ? `${message} (${status})` : `${path} failed (${status})`;
  }
  return `${path} failed: ${failures.map((f) => `${f.host} ${f.status}`).join(', ')}`;
}

/**
 * POST to the first embed host that accepts it.
 *
 * These are DATABASE writes, and every embed host shares the same MongoDB — so a
 * call only has to reach ONE host, and picking the "least busy" one (which is
 * what pickEmbedEndpoint optimises for, correctly, for uploads) is meaningless
 * here. Worse, the hosts are deployed independently and run different builds, so
 * a load-balanced pick can land on one that predates the route. A 404/501 means
 * "this host is too old", not "the video doesn't exist" — try the next.
 */
async function postToAnyEmbedHost(path, body) {
  const failures = [];

  for (const apiBase of embedHostList()) {
    try {
      const res = await fetch(`${apiBase}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': EMBED_API_KEY },
        body: JSON.stringify(body),
      });
      if (res.ok) return await res.json().catch(() => ({}));
      const detail = await res.json().catch(() => null);
      failures.push({
        host: hostLabel(apiBase),
        status: res.status,
        message: detail?.error || detail?.message || null,
      });
    } catch (err) {
      failures.push({ host: hostLabel(apiBase), status: 0, message: err?.message || 'unreachable' });
    }
  }

  const err = new Error(describeHostFailures(path, failures));
  err.failures = failures;
  err.status = failures.length ? failures[0].status : 0;
  throw err;
}

/** Bare hostname of a URL, for display ("https://embed2.3speak.tv/uploads" -> "embed2.3speak.tv"). */
function hostLabel(url) {
  try { return new URL(url).host; } catch { return String(url || '').replace(/^https?:\/\//, '').split('/')[0]; }
}

/** Read a video file's duration (seconds) without uploading it. Best-effort: resolves 0. */
export function probeVideoDuration(file) {
  return new Promise((resolve) => {
    try {
      const el = document.createElement('video');
      el.preload = 'metadata';
      const url = URL.createObjectURL(file);
      const done = (v) => { URL.revokeObjectURL(url); resolve(v); };
      el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? el.duration : 0);
      el.onerror = () => done(0);
      el.src = url;
    } catch {
      resolve(0);
    }
  });
}
