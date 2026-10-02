// Inline-playable teaser for Discord share cards.
//
// WHY THIS EXISTS
// ---------------
// Discord only plays a video inside its embed when og:video points at a direct,
// progressive video file (MP4/WebM over HTTPS, with range support). It will not
// run our player iframe (only whitelisted sites like YouTube get that) and it
// cannot play HLS. Every 3Speak video is HLS on IPFS, so a shared link only ever
// showed a thumbnail card.
//
// What Discord gets is a TEASER, not the video: the first CLIP_SECONDS, then an
// outro video (OG_VIDEO_OUTRO) that sends people to 3speak.tv for the rest. The
// point of a share is a visit, not a view inside Discord.
//
// The two pieces never share a shape (resolution, profile, audio rate all vary
// across the library, and the manifests lie about it), so they're re-encoded
// into one 480p-class H.264/AAC file rather than joined with `-c copy`. That's
// ~25s of video: 2-4s of CPU, and only the first few segments are downloaded,
// so it's ready before Discord checks the file (it does so the moment it
// unfurls the link, and gives up well within the ~35s a full-length copy took).
//
// Flow ("lazy build + cache"):
//   1. Discordbot fetches the share page → og-server asks ogVideoFor(): resolve
//      the video's HLS source + ffprobe it (real dimensions, duration), then
//      prepare() builds the teaser while the card waits a few seconds for it.
//   2. Discord fetches GET /og-video/<author>/<permlink>.mp4 → served from the
//      cache (waiting for an in-flight build if it hasn't finished).
//
// Only Discordbot triggers this (OG_VIDEO_BOTS). The same sidecar also serves
// Googlebot, and building for a crawler that walks the whole catalogue would
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

const CLIP_SECONDS = Number(process.env.OG_VIDEO_CLIP_SECONDS) || 20;
// author/permlink of the video appended after the teaser; empty = no outro.
const OUTRO_REF = (process.env.OG_VIDEO_OUTRO ?? 'badadib/test-886').trim();
// Bump when the encode settings change, so old teasers aren't served as new.
const ENCODE_VERSION = 'e1';
const CACHE_MAX_BYTES = (Number(process.env.OG_VIDEO_CACHE_MAX_GB) || 20) * 1024 ** 3;
const CACHE_TTL_MS = (Number(process.env.OG_VIDEO_CACHE_TTL_DAYS) || 14) * 86400000;
const MAX_CONCURRENT = Number(process.env.OG_VIDEO_MAX_CONCURRENT) || 2;
const MAX_QUEUED = 10;
const BUILD_TIMEOUT_MS = 3 * 60 * 1000;
const PROBE_TIMEOUT_MS = 20000;
// A failed build (gateway hiccup) is retried, but not on every request.
const FAILURE_COOLDOWN_MS = 15 * 60 * 1000;
// How long the media route holds a request open for an in-flight build.
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
 * Pick the rendition to read: 480p when there is one (the teaser is 480p-class
 * anyway), otherwise whatever is nearest to it without going over 720p. RESOLUTION in the manifest is only used for choosing; the real
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
      // A media playlist (no variants) is read as-is.
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
    // inherit that. A teaser build is disposable, so hand the protection back and
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

const probePath = (key) => path.join(CACHE_DIR, `${key}.probe.json`);
const mp4Path = (key) => path.join(CACHE_DIR, `${key}.mp4`);

/**
 * Real dimensions, duration and whether there's audio, decided once per
 * rendition and kept on disk: a CID never changes content, so neither does the
 * answer. Any codec ffmpeg can decode is fine, since the teaser is re-encoded.
 */
async function probeRendition(src) {
  try {
    return JSON.parse(await fsp.readFile(probePath(src.key), 'utf8'));
  } catch (_) {
    /* not probed yet */
  }

  const out = await run(
    'ffprobe',
    [
      '-v', 'error',
      '-rw_timeout', '15000000',
      '-show_entries', 'stream=codec_type,width,height:stream_side_data=rotation:format=duration',
      '-of', 'json',
      src.variantUrl,
    ],
    PROBE_TIMEOUT_MS,
  );
  const info = JSON.parse(out);
  const streams = info.streams || [];
  const video = streams.find((s) => s.codec_type === 'video');
  const audio = streams.find((s) => s.codec_type === 'audio');

  let meta;
  if (!video) {
    meta = { ok: false, reason: 'no video stream' };
  } else {
    let { width, height } = video;
    const rotation = ((video.side_data_list || []).find((d) => d.rotation != null) || {}).rotation;
    if (Math.abs(Number(rotation)) === 90) [width, height] = [height, width];
    const duration = Math.round((Number(info.format && info.format.duration) || 0) * 100) / 100;
    meta = { ok: true, width, height, duration, audio: !!audio };
  }
  await fsp.writeFile(probePath(src.key), JSON.stringify(meta));
  if (!meta.ok) console.log('[og-video] ineligible', src.key, meta.reason);
  return meta;
}

// One in-flight probe per rendition.
const probes = new Map();

function probeOnce(src) {
  let p = probes.get(src.key);
  if (!p) {
    p = probeRendition(src)
      .catch((err) => {
        console.error('[og-video] probe failed', src.key, err && err.message);
        return null;
      })
      .finally(() => probes.delete(src.key));
    probes.set(src.key, p);
  }
  return p;
}

// Build queue: at most MAX_CONCURRENT ffmpeg processes, MAX_QUEUED waiting.
let active = 0;
const waiting = [];

function schedule(task) {
  return new Promise((resolve, reject) => {
    if (active >= MAX_CONCURRENT && waiting.length >= MAX_QUEUED) {
      return reject(new Error('build queue full'));
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

/**
 * The outro, copied once from IPFS to a local file (it's read by every build).
 * null when none is configured, or it can't be fetched right now: the teaser is
 * then built without it, under its own cache key.
 */
let outroMemo = null;

async function getOutro() {
  if (!OUTRO_REF) return null;
  if (outroMemo && Date.now() < outroMemo.expires) {
    const o = await outroMemo.promise;
    // The sweep may have evicted the local copy since.
    if (!o || fs.existsSync(o.file)) return o;
  }
  const promise = loadOutro().catch((err) => {
    console.error('[og-video] outro unavailable', OUTRO_REF, err && err.message);
    return null;
  });
  outroMemo = { promise, expires: 0 };
  const o = await promise;
  outroMemo.expires = Date.now() + (o ? 10 * 60 * 1000 : 60 * 1000);
  return o;
}

async function loadOutro() {
  const [author, permlink] = OUTRO_REF.split('/');
  const src = validRef(author, permlink) && (await resolveSource(author, permlink));
  if (!src) throw new Error('not resolvable');
  const meta = await probeOnce(src);
  if (!meta || !meta.ok) throw new Error('probe failed');
  const file = path.join(CACHE_DIR, `outro-${src.key}.mp4`);
  try {
    await fsp.access(file);
  } catch (_) {
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    try {
      await run('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-rw_timeout', '30000000', '-i', src.variantUrl,
        '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', '-f', 'mp4', tmp], BUILD_TIMEOUT_MS);
      await fsp.rename(tmp, file);
    } catch (err) {
      await fsp.unlink(tmp).catch(() => {});
      throw err;
    }
  }
  return { file, cid: src.cid, duration: meta.duration || 1, audio: meta.audio };
}

// The teaser's frame: the source's own aspect ratio inside 854x480 (portrait
// stays portrait), even dimensions for H.264.
function fitBox(w, h) {
  if (!(w > 0 && h > 0)) return [854, 480];
  const s = Math.min(1, 854 / Math.max(w, h), 480 / Math.min(w, h));
  const even = (n) => Math.max(2, Math.round(n / 2) * 2);
  return [even(w * s), even(h * s)];
}

/**
 * Everything a teaser build needs, and the cache key that captures all of it:
 * the rendition, the clip length, the encode settings and the outro. Changing
 * any of them (e.g. swapping in the real outro) makes a new file and a new URL.
 */
async function planFor(src) {
  const meta = await probeOnce(src);
  if (!meta || !meta.ok) return null;
  const outro = await getOutro();
  const clip = meta.duration > 0 ? Math.min(CLIP_SECONDS, meta.duration) : CLIP_SECONDS;
  const [width, height] = fitBox(meta.width, meta.height);
  const outroTag = outro ? outro.cid.slice(-8) : 'none';
  return {
    src,
    meta,
    outro,
    clip,
    width,
    height,
    duration: clip + (outro ? outro.duration : 0),
    key: `${src.key}-${ENCODE_VERSION}-t${CLIP_SECONDS}-o${outroTag}`,
    tag: `${src.cid.slice(-8)}${outroTag}`,
  };
}

async function build(plan) {
  const { src, meta, outro, clip, width: W, height: H } = plan;
  const final = mp4Path(plan.key);
  const tmp = `${final}.${process.pid}.${Date.now()}.tmp`;
  const started = Date.now();

  // -t before -i: ffmpeg stops reading the HLS input there, so only the first
  // few segments are ever downloaded.
  const inputs = ['-rw_timeout', '30000000', '-t', String(clip), '-i', src.variantUrl];
  let next = 1;
  let outroIdx = null;
  if (outro) {
    inputs.push('-i', outro.file);
    outroIdx = next++;
  }
  // A silent source gets generated silence, so both pieces always have audio
  // for the concat.
  const silence = (secs) => {
    inputs.push('-f', 'lavfi', '-t', String(secs), '-i', 'anullsrc=r=44100:cl=stereo');
    return `${next++}:a`;
  };
  const mainAudio = meta.audio ? '0:a' : silence(clip);
  const outroAudio = outro ? (outro.audio ? `${outroIdx}:a` : silence(outro.duration)) : null;

  const fitV = (i) =>
    `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p`;
  // The library mixes 44.1k and 48k; padding to the exact length keeps the
  // outro's sound starting with its picture.
  const fitA = (label, secs) =>
    `[${label}]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=0:${secs},apad=whole_dur=${secs}`;
  let graph = `${fitV(0)}[v0];${fitA(mainAudio, clip)}[a0]`;
  let outV = '[v0]';
  let outA = '[a0]';
  if (outro) {
    graph += `;${fitV(outroIdx)}[v1];${fitA(outroAudio, outro.duration)}[a1];[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]`;
    outV = '[v]';
    outA = '[a]';
  }

  const args = [
    '-nostdin', '-v', 'error', '-y',
    ...inputs,
    '-filter_complex', graph,
    '-map', outV, '-map', outA,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-profile:v', 'main',
    '-c:a', 'aac', '-b:a', '128k',
    '-threads', '2',
    // moov atom up front, so playback can start before the whole file arrives.
    '-movflags', '+faststart',
    '-f', 'mp4',
    tmp,
  ];
  try {
    await run('ffmpeg', args, BUILD_TIMEOUT_MS);
    await fsp.rename(tmp, final);
  } catch (err) {
    await fsp.unlink(tmp).catch(() => {});
    throw err;
  }
  const { size } = await fsp.stat(final);
  console.log(`[og-video] built ${plan.key} ${(size / 1e6).toFixed(1)}MB in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  return final;
}

// One in-flight build per teaser, shared by every caller.
const builds = new Map();
const failedAt = new Map();

/** The cached teaser for this plan, building it first if needed. null on failure. */
function ensureFile(plan) {
  let p = builds.get(plan.key);
  if (p) return p;
  p = (async () => {
    try {
      await fsp.access(mp4Path(plan.key));
      return mp4Path(plan.key);
    } catch (_) {
      /* not cached */
    }
    const last = failedAt.get(plan.key);
    if (last && Date.now() - last < FAILURE_COOLDOWN_MS) return null;
    try {
      return await schedule(() => build(plan));
    } catch (err) {
      failedAt.set(plan.key, Date.now());
      console.error('[og-video] build failed', plan.key, err && err.message);
      return null;
    }
  })().finally(() => builds.delete(plan.key));
  builds.set(plan.key, p);
  return p;
}

/**
 * og:video data for a share card, or null. Waits at most `waitMs` for the
 * source + probe. The caller decides whether the page may carry the video at
 * all, then calls `prepare(ms)`: it starts the build and resolves when the file
 * is ready or `ms` has passed, whichever comes first.
 */
async function ogVideoFor(author, permlink, { waitMs = 6000 } = {}) {
  if (!validRef(author, permlink)) return null;
  const src = await withTimeout(resolveSource(author, permlink), waitMs);
  if (!src) return null;
  const plan = await withTimeout(planFor(src), waitMs);
  if (!plan) return null;
  return {
    prepare: (ms) => withTimeout(ensureFile(plan), ms),
    // The source CID + outro in the query make a replaced video file or a new
    // outro a new URL, so Discord's and Cloudflare's caches can keep the old one.
    path: `/og-video/${encodeURIComponent(author)}/${encodeURIComponent(permlink)}.mp4?r=${plan.tag}`,
    width: plan.width,
    height: plan.height,
    duration: Math.round(plan.duration),
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
  const plan = await planFor(src);
  if (!plan) return sendStatus(res, 503, { 'Retry-After': '30' });

  const file = await withTimeout(ensureFile(plan), SERVE_WAIT_MS);
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
 * Probe results (.json) are tiny and stay, except very old ones. The local
 * outro copy is an .mp4 like the rest; getOutro() fetches it again if evicted.
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
      if (age > BUILD_TIMEOUT_MS * 2) await fsp.unlink(file).catch(() => {});
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
