// Renders the three focus-mode moods (Rain, Night piano, Fireplace) as looping
// music beds for narrated posts: headless Chromium plays focusMusic.js into an
// OfflineAudioContext (render-music-beds.html), ffmpeg sets the loudness and
// encodes. Run from the repo root: node scripts/narration/render-music-beds.mjs
// Env: NARRATION_MUSIC_DIR (default /mnt/HC_Volume_103240961/prodops/cache/narration-music),
// CHROMIUM_PATH, PLAYWRIGHT_CORE (path to playwright-core when it is not installed here).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const OUT = process.env.NARRATION_MUSIC_DIR || '/mnt/HC_Volume_103240961/prodops/cache/narration-music';
const CHROME = process.env.CHROMIUM_PATH || '/root/.cache/ms-playwright/chromium-1148/chrome-linux/chrome';
const SECONDS = 360;
const WARMUP = 12;
const CROSSFADE = 4;
const RATE = 44100;
const TARGET_LUFS = -20;
const MOODS = [
  { id: 'rain', mood: 1 },
  { id: 'piano', mood: 2 },
  { id: 'fireplace', mood: 3 },
];

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const FILES = {
  '/': path.join(here, 'render-music-beds.html'),
  '/focusMusic.js': path.join(root, 'src/components/common/FocusWriter/focusMusic.js'),
};
const server = http.createServer((req, res) => {
  const file = FILES[req.url.split('?')[0]];
  if (!file) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript' : 'text/html' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const url = `http://127.0.0.1:${server.address().port}/`;

function wavHeader(bytes) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + bytes, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
  h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(bytes, 40);
  return h;
}

/** Integrated loudness (LUFS) and sample peak (dBFS) of a file, by ffmpeg's ebur128. */
function measure(file) {
  const log = ffmpegLog(['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const summary = log.slice(log.lastIndexOf('Summary:'));
  const lufs = Number((summary.match(/I:\s+(-?[\d.]+) LUFS/) || [])[1]);
  const peak = Number((summary.match(/Peak:\s+(-?[\d.]+) dBFS/) || [])[1]);
  return { lufs, peak };
}
/** Runs ffmpeg; its log (stderr). Throws when it fails. */
function ffmpegLog(args) {
  const r = spawnSync('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  const log = String(r.stderr || '');
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${log.trim().split('\n').slice(-3).join(' ')}`);
  return log;
}

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const beds = [];
try {
  const page = await browser.newPage();
  await page.goto(url);
  await page.waitForFunction(() => window.ready === true);
  for (const { id, mood } of MOODS) {
    const started = Date.now();
    const info = await page.evaluate((o) => window.renderBed(o), { mood, seconds: SECONDS, warmup: WARMUP, crossfade: CROSSFADE, sampleRate: RATE });
    const wav = path.join(OUT, `${id}.wav`);
    const fd = fs.openSync(wav, 'w');
    fs.writeSync(fd, wavHeader(info.bytes));
    const STEP = 4 * 1024 * 1024;
    for (let off = 0; off < info.bytes; off += STEP) {
      const b64 = await page.evaluate(([o, l]) => window.chunk(o, l), [off, STEP]);
      fs.writeSync(fd, Buffer.from(b64, 'base64'));
    }
    fs.closeSync(fd);
    // A static gain to the target (no dynamic loudnorm: it would pump), then MP3.
    const raw = measure(wav);
    if (!Number.isFinite(raw.lufs)) throw new Error(`${id}: could not measure the loudness`);
    const gain = TARGET_LUFS - raw.lufs;
    const mp3 = path.join(OUT, `${id}.mp3`);
    ffmpegLog(['-hide_banner', '-y', '-i', wav, '-af', `volume=${gain.toFixed(2)}dB`, '-c:a', 'libmp3lame', '-b:a', '192k', mp3]);
    fs.unlinkSync(wav);
    const done = measure(mp3);
    beds.push({ id, file: `${id}.mp3`, seconds: SECONDS, lufs: Math.round(done.lufs * 10) / 10 });
    console.log(`${id}: rendered in ${Math.round((Date.now() - started) / 1000)} s, raw ${raw.lufs} LUFS, gain ${gain.toFixed(2)} dB, now ${done.lufs} LUFS, peak ${done.peak} dBFS`);
  }
} finally {
  await browser.close();
  server.close();
}
fs.writeFileSync(path.join(OUT, 'beds.json'), `${JSON.stringify(beds, null, 2)}\n`);
console.log(`wrote ${path.join(OUT, 'beds.json')}`);
