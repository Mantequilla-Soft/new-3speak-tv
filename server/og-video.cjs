// Inline-playable video for Discord share cards.
//
// WHY THIS EXISTS
// ---------------
// Discord only plays a video inside its embed when og:video points at a direct,
// progressive video file (MP4/WebM over HTTPS, with range support). It will not
// run our player iframe (only whitelisted sites like YouTube get that) and it
// cannot play HLS. Every 3Speak video is HLS on IPFS, so a shared link only ever
// showed a thumbnail card.
//
// The HLS segments are already H.264 + AAC, so no transcode is needed: ffmpeg
// remuxes one rendition into an MP4 container (`-c copy`), which takes seconds
// and almost no CPU. Streaming that remux live would have no length and no
// range support (iOS Discord and Discord's media proxy both reject that), so
// the file is remuxed ONCE, cached on disk, then served statically.
//
// Flow ("lazy remux + cache"):
//   1. Discordbot fetches the share page → og-server asks ogVideoFor(): resolve
//      the video's HLS source, ffprobe it (codec, real dimensions, duration),
//      and if it's eligible emit og:video + kick off the remux in the background.
//   2. Someone clicks play → GET /og-video/<author>/<permlink>.mp4 → served from
//      the cache (waiting for the in-flight remux if it hasn't finished).
//
// Only Discordbot triggers this (OG_VIDEO_BOTS). The same sidecar also serves
// Googlebot, and remuxing for a crawler that walks the whole catalogue would
// fill the disk for nothing.
//
// Deps: none, Node 18 built-ins + the system ffmpeg/ffprobe.

const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const PLAYER_URL = process.env.PLAYER_URL || 'https://play.3speak.tv';
const CACHE_DIR = process.env.OG_VIDEO_CACHE_DIR || path.join(os.tmpdir(), '3speak-og-video');
// Server-side reads, so ipfs.3speak.tv (no CORS) is acceptable as the fallback.
// hotipfs-3speak-1 is deliberately absent: it 500s on anything not already hot.
const GATEWAYS = (process.env.OG_VIDEO_GATEWAYS || 'https://ipfs-3speak.b-cdn.net,https://ipfs.3speak.tv')
  .split(',')
  .map((s) => s.trim().replace(/\/+$/, ''))
  .filter(Boolean);
const VIDEO_BOTS = (process.env.OG_VIDEO_BOTS || 'Discordbot')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

// 480p at ~1.5 Mbps is ~11 MB/min, so 20 minutes is ~220 MB. Longer videos keep
// the plain thumbnail card rather than parking a huge file for one share.
const MAX_SECONDS = Number(process.env.OG_VIDEO_MAX_SECONDS) || 1200;
// Duration alone doesn't bound the size: the encoder's passthrough path puts the
// SOURCE (seen: 2160x1080, 275 MB for 10 min) in the folder labelled 480p.
const MAX_BYTES = (Number(process.env.OG_VIDEO_MAX_MB) || 200) * 1e6;
const CACHE_MAX_BYTES = (Number(process.env.OG_VIDEO_CACHE_MAX_GB) || 20) * 1024 ** 3;
const CACHE_TTL_MS = (Number(process.env.OG_VIDEO_CACHE_TTL_DAYS) || 14) * 86400000;
const MAX_CONCURRENT = Number(process.env.OG_VIDEO_MAX_CONCURRENT) || 2;
const MAX_QUEUED = 10;
const REMUX_TIMEOUT_MS = 10 * 60 * 1000;
const PROBE_TIMEOUT_MS = 20000;
// A failed remux (gateway hiccup) is retried, but not on every request.
const FAILURE_COOLDOWN_MS = 15 * 60 * 1000;
// How long the media route holds a request open for an in-flight remux.
// Cloudflare gives up on the origin at 100s.
const SERVE_WAIT_MS = 75000;

const AUTHOR_RE = /^[a-z0-9][a-z0-9.-]{1,15}$/;
const PERMLINK_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/;

fs.mkdirSync(CACHE_DIR, { recursive: true });

function wantsVideo(userAgent) {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return VIDEO_BOTS.some((bot) => ua.includes(bot));
}

function validRef(author, permlink) {
  return AUTHOR_RE.test(author || '') && PERMLINK_RE.test(permlink || '');
}

async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(undefined), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Pick the rendition to remux: 480p when there is one (small, fast, plenty for
 * an inline preview), otherwise whatever is nearest to it without going over
 * 720p. RESOLUTION in the manifest is only used for choosing; the real
 * dimensions come from ffprobe (the encoder writes 854x480 for everything,
 * portrait shorts included).
 */
function pickVariant(masterText) {
  const lines = masterText.split(/\r?\n/).map((l) => l.trim());
  const variants = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue;
    const uri = lines.slice(i + 1).find((l) => l && !l.startsWith('#'));
    if (!uri) continue;
    const res = lines[i].match(/RESOLUTION=\d+x(\d+)/);
    const named = uri.match(/(\d{3,4})p\//);
    const height = res ? Number(res[1]) : named ? Number(named[1]) : 480;
    variants.push({ uri, height });
  }
  if (!variants.length) return null;
  const score = (v) => (v.height <= 720 ? Math.abs(v.height - 480) : 10000 + v.height);
  return variants.sort((a, b) => score(a) - score(b))[0].uri;
}

// author/permlink → { key, cid, variantUrl } (or null), memoised briefly so a
// share card and the play request that follows don't both hit the player API.
const sourceMemo = new Map();
const SOURCE_TTL_MS = 10 * 60 * 1000;
const SOURCE_MISS_TTL_MS = 2 * 60 * 1000;

async function resolveSource(author, permlink) {
  const ref = `${author}/${permlink}`;
  const memo = sourceMemo.get(ref);
  if (memo && Date.now() < memo.expires) return memo.value;

  let value = null;
  try {
    value = await lookupSource(author, permlink);
  } catch (err) {
    console.error('[og-video] resolve failed', ref, err && err.message);
  }
  if (sourceMemo.size > 5000) sourceMemo.clear();
  sourceMemo.set(ref, { value, expires: Date.now() + (value ? SOURCE_TTL_MS : SOURCE_MISS_TTL_MS) });
  return value;
}

async function lookupSource(author, permlink) {
  // The player's /api/watch resolves BOTH the legacy `videos` collection and
  // embed assets (by asset id or Hive permlink), so it covers /watch, /@ and
  // /shorts share URLs alike.
  const res = await fetchWithTimeout(
    `${PLAYER_URL}/api/watch?v=${encodeURIComponent(author)}/${encodeURIComponent(permlink)}`,
    5000,
  );
  if (!res.ok) return null;
  const doc = await res.json();
  if (!doc || !doc.success || doc.isPlaceholder || !doc.videoUrl) return null;
  if (doc.status && doc.status !== 'published') return null;
  // Gated (paid) videos never get a public MP4.
  if (doc.gated === true || doc.gated === 'true') return null;

  let manifest = doc.videoUrl;
  try {
    manifest = new URL(doc.videoUrl).searchParams.get('u') || doc.videoUrl;
  } catch (_) {
    return null;
  }
  const m = manifest.match(/\/ipfs\/([A-Za-z0-9]{40,})\/(.+)$/);
  if (!m) return null;
  const [, cid, masterPath] = m;

  for (const gateway of GATEWAYS) {
    const masterUrl = `${gateway}/ipfs/${cid}/${masterPath}`;
    try {
      const r = await fetchWithTimeout(masterUrl, 8000);
      if (!r.ok) continue;
      const text = await r.text();
      if (!text.startsWith('#EXTM3U')) continue;
      // A media playlist (no variants) is remuxed as-is.
      const variant = text.includes('#EXT-X-STREAM-INF') ? pickVariant(text) : '';
      if (variant === null) continue;
      const variantUrl = variant ? new URL(variant, masterUrl).href : masterUrl;
      const tag = (variant || 'main').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
      return { key: `${cid}-${tag}`, cid, variantUrl };
    } catch (_) {
      /* next gateway */
    }
  }
  return null;
}

function run(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    // The sidecar's unit is OOM-protected (OOMScoreAdjust=-900) and children
    // inherit that. A remux is disposable, so hand the protection back and
    // yield the CPU to everything else on the box.
    if (child.pid) {
      fsp.writeFile(`/proc/${child.pid}/oom_score_adj`, '500').catch(() => {});
      try {
        os.setPriority(child.pid, 10);
      } catch (_) {
        /* not fatal */
      }
    }
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.stderr.on('data', (d) => {
      if (err.length < 4000) err += d;
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} exited ${code || signal}: ${err.trim().slice(-300)}`));
    });
  });
}

/**
 * Rough output size: the first segment's bytes per second times the duration.
 * One small playlist read plus a HEAD. null when it can't tell, which lets the
 * video through rather than blocking it on a guess.
 */
async function estimateBytes(variantUrl, duration) {
  try {
    const r = await fetchWithTimeout(variantUrl, 8000);
    if (!r.ok) return null;
    const lines = (await r.text()).split(/\r?\n/).map((l) => l.trim());
    const inf = lines.findIndex((l) => l.startsWith('#EXTINF:'));
    if (inf === -1) return null;
    const secs = parseFloat(lines[inf].slice(8));
    const uri = lines.slice(inf + 1).find((l) => l && !l.startsWith('#'));
    if (!uri || !(secs > 0)) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const head = await fetch(new URL(uri, variantUrl).href, { method: 'HEAD', signal: ctrl.signal });
      const len = Number(head.headers.get('content-length'));
      return head.ok && len > 0 ? Math.round((len / secs) * duration) : null;
    } finally {
      clearTimeout(timer);
    }
  } catch (_) {
    return null;
  }
}

const metaPath = (key) => path.join(CACHE_DIR, `${key}.json`);
const mp4Path = (key) => path.join(CACHE_DIR, `${key}.mp4`);

/**
 * Codec, real dimensions and duration of the rendition, decided once per
 * rendition and kept on disk: a CID never changes content, so neither does the
 * answer. Anything but H.264 (+ AAC or silence) is ineligible, because `-c copy`
 * of HEVC would give an MP4 Discord can't play, and a real transcode is exactly
 * the cost this design avoids.
 */
async function probe(src) {
  try {
    return JSON.parse(await fsp.readFile(metaPath(src.key), 'utf8'));
  } catch (_) {
    /* not probed yet */
  }

  const out = await run(
    'ffprobe',
    [
      '-v', 'error',
      '-rw_timeout', '15000000',
      '-show_entries', 'stream=codec_type,codec_name,width,height:stream_side_data=rotation:format=duration',
      '-of', 'json',
      src.variantUrl,
    ],
    PROBE_TIMEOUT_MS,
  );
  const info = JSON.parse(out);
  const streams = info.streams || [];
  const video = streams.find((s) => s.codec_type === 'video');
  const audio = streams.find((s) => s.codec_type === 'audio');
  const duration = Number(info.format && info.format.duration) || 0;

  let meta;
  if (!video || video.codec_name !== 'h264') {
    meta = { ok: false, reason: `video codec ${video ? video.codec_name : 'none'}` };
  } else if (audio && audio.codec_name !== 'aac') {
    meta = { ok: false, reason: `audio codec ${audio.codec_name}` };
  } else if (duration > MAX_SECONDS) {
    meta = { ok: false, reason: `duration ${Math.round(duration)}s` };
  } else if ((await estimateBytes(src.variantUrl, duration)) > MAX_BYTES) {
    meta = { ok: false, reason: `estimated size over ${MAX_BYTES / 1e6}MB` };
  } else {
    let { width, height } = video;
    const rotation = ((video.side_data_list || []).find((d) => d.rotation != null) || {}).rotation;
    if (Math.abs(Number(rotation)) === 90) [width, height] = [height, width];
    meta = { ok: true, width, height, duration: Math.round(duration), audio: !!audio };
  }
  await fsp.writeFile(metaPath(src.key), JSON.stringify(meta));
  if (!meta.ok) console.log('[og-video] ineligible', src.key, meta.reason);
  return meta;
}

// Remux queue: at most MAX_CONCURRENT ffmpeg processes, MAX_QUEUED waiting.
let active = 0;
const waiting = [];

function schedule(task) {
  return new Promise((resolve, reject) => {
    if (active >= MAX_CONCURRENT && waiting.length >= MAX_QUEUED) {
      return reject(new Error('remux queue full'));
    }
    const start = () => {
      active++;
      task()
        .then(resolve, reject)
        .finally(() => {
          active--;
          const next = waiting.shift();
          if (next) next();
        });
    };
    if (active < MAX_CONCURRENT) start();
    else waiting.push(start);
  });
}

async function remux(src, meta) {
  const final = mp4Path(src.key);
  const tmp = `${final}.${process.pid}.${Date.now()}.tmp`;
  const started = Date.now();
  const args = [
    '-nostdin', '-v', 'error', '-y',
    '-rw_timeout', '30000000',
    '-i', src.variantUrl,
    '-map', '0:v:0',
    ...(meta.audio ? ['-map', '0:a:0', '-bsf:a', 'aac_adtstoasc'] : []),
    '-c', 'copy',
    // moov atom up front, so playback can start before the whole file arrives.
    '-movflags', '+faststart',
    '-f', 'mp4',
    tmp,
  ];
  try {
    await run('ffmpeg', args, REMUX_TIMEOUT_MS);
    await fsp.rename(tmp, final);
  } catch (err) {
    await fsp.unlink(tmp).catch(() => {});
    throw err;
  }
  const { size } = await fsp.stat(final);
  console.log(`[og-video] remuxed ${src.key} ${(size / 1e6).toFixed(1)}MB in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  return final;
}

// One in-flight job per rendition, shared by every caller.
const jobs = new Map();
const failedAt = new Map();

function getJob(src) {
  let job = jobs.get(src.key);
  if (job) return job;
  job = { meta: probe(src).catch((err) => {
    console.error('[og-video] probe failed', src.key, err && err.message);
    return null;
  }) };
  jobs.set(src.key, job);
  // Forget the job once it has settled; the disk cache carries the result.
  job.meta.then(() => {
    if (!job.file) setTimeout(() => jobs.get(src.key) === job && !job.file && jobs.delete(src.key), 60000);
  });
  return job;
}

/** The cached MP4 for this rendition, remuxing it first if needed. null if ineligible. */
function ensureFile(src) {
  const job = getJob(src);
  if (!job.file) {
    job.file = (async () => {
      const meta = await job.meta;
      if (!meta || !meta.ok) return null;
      try {
        await fsp.access(mp4Path(src.key));
        return mp4Path(src.key);
      } catch (_) {
        /* not cached */
      }
      const last = failedAt.get(src.key);
      if (last && Date.now() - last < FAILURE_COOLDOWN_MS) return null;
      try {
        return await schedule(() => remux(src, meta));
      } catch (err) {
        failedAt.set(src.key, Date.now());
        console.error('[og-video] remux failed', src.key, err && err.message);
        return null;
      }
    })().finally(() => {
      if (jobs.get(src.key) === job) jobs.delete(src.key);
    });
  }
  return job.file;
}

/**
 * og:video data for a share card, or null. Waits at most `waitMs` for the
 * probe. Only resolves + probes: the caller decides whether the page may carry
 * the video at all and then calls `prepare()`, which starts the remux in the
 * background so the card is never held up by it.
 */
async function ogVideoFor(author, permlink, { waitMs = 6000 } = {}) {
  if (!validRef(author, permlink)) return null;
  const src = await withTimeout(resolveSource(author, permlink), waitMs);
  if (!src) return null;
  const meta = await withTimeout(getJob(src).meta, waitMs);
  if (!meta || !meta.ok) return null;
  return {
    prepare: () => {
      ensureFile(src).catch(() => {});
    },
    // The rendition key in the query makes a replaced video file a new URL, so
    // Discord's and Cloudflare's caches can keep the old one as long as they like.
    path: `/og-video/${encodeURIComponent(author)}/${encodeURIComponent(permlink)}.mp4?r=${src.cid.slice(-12)}`,
    width: meta.width,
    height: meta.height,
    duration: meta.duration,
  };
}

const MEDIA_RE = /^\/og-video\/([^/]+)\/([^/]+)\.mp4$/;

function isMediaPath(pathname) {
  return MEDIA_RE.test(pathname);
}

function sendStatus(res, status, extra = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store', ...extra });
  res.end(String(status));
}

/** GET/HEAD /og-video/<author>/<permlink>.mp4: a plain static file with range support. */
async function serveMedia(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendStatus(res, 405, { Allow: 'GET, HEAD' });
  const m = pathname.match(MEDIA_RE);
  let author;
  let permlink;
  try {
    author = decodeURIComponent(m[1]);
    permlink = decodeURIComponent(m[2]);
  } catch (_) {
    return sendStatus(res, 404);
  }
  if (!validRef(author, permlink)) return sendStatus(res, 404);

  const src = await resolveSource(author, permlink);
  if (!src) return sendStatus(res, 404);
  const meta = await getJob(src).meta;
  if (!meta || !meta.ok) return sendStatus(res, meta ? 404 : 503, meta ? {} : { 'Retry-After': '30' });

  const file = await withTimeout(ensureFile(src), SERVE_WAIT_MS);
  if (!file) return sendStatus(res, 503, { 'Retry-After': '30' });

  let stat;
  try {
    stat = await fsp.stat(file);
  } catch (_) {
    return sendStatus(res, 503, { 'Retry-After': '30' });
  }
  // mtime doubles as "last used" for the LRU sweep.
  if (Date.now() - stat.mtimeMs > 3600000) {
    const now = new Date();
    fsp.utimes(file, now, now).catch(() => {});
  }

  const headers = {
    'Content-Type': 'video/mp4',
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=86400',
    'Last-Modified': stat.mtime.toUTCString(),
  };
  const size = stat.size;
  let start = 0;
  let end = size - 1;
  let status = 200;

  const range = req.headers.range;
  if (range) {
    const r = range.match(/^bytes=(\d*)-(\d*)$/);
    if (!r || (r[1] === '' && r[2] === '')) {
      return sendStatus(res, 416, { 'Content-Range': `bytes */${size}` });
    }
    if (r[1] === '') {
      start = Math.max(0, size - Number(r[2]));
    } else {
      start = Number(r[1]);
      if (r[2] !== '') end = Math.min(Number(r[2]), size - 1);
    }
    if (start > end || start >= size) {
      return sendStatus(res, 416, { 'Content-Range': `bytes */${size}` });
    }
    status = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  headers['Content-Length'] = end - start + 1;

  res.writeHead(status, headers);
  if (req.method === 'HEAD') return res.end();
  const stream = fs.createReadStream(file, { start, end });
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

/**
 * Drop MP4s unused for CACHE_TTL_MS, then the least recently used ones until
 * the cache is under CACHE_MAX_BYTES, plus temp files a crash left behind.
 * Probe results (.json) are tiny and stay, except very old ones.
 */
async function sweep() {
  let names;
  try {
    names = await fsp.readdir(CACHE_DIR);
  } catch (_) {
    return;
  }
  const now = Date.now();
  const mp4s = [];
  for (const name of names) {
    const file = path.join(CACHE_DIR, name);
    let st;
    try {
      st = await fsp.stat(file);
    } catch (_) {
      continue;
    }
    const age = now - st.mtimeMs;
    if (name.endsWith('.tmp')) {
      if (age > REMUX_TIMEOUT_MS * 2) await fsp.unlink(file).catch(() => {});
    } else if (name.endsWith('.json')) {
      if (age > CACHE_TTL_MS * 6) await fsp.unlink(file).catch(() => {});
    } else if (name.endsWith('.mp4')) {
      if (age > CACHE_TTL_MS) await fsp.unlink(file).catch(() => {});
      else mp4s.push({ file, size: st.size, mtime: st.mtimeMs });
    }
  }
  let total = mp4s.reduce((n, f) => n + f.size, 0);
  mp4s.sort((a, b) => a.mtime - b.mtime);
  while (total > CACHE_MAX_BYTES && mp4s.length) {
    const f = mp4s.shift();
    await fsp.unlink(f.file).catch(() => {});
    total -= f.size;
  }
}

sweep();
setInterval(sweep, 3600000).unref();

module.exports = { wantsVideo, ogVideoFor, isMediaPath, serveMedia };
