/*
 * Transcript of an audio file, made with the teleprompter's speech-to-text
 * server (VITE_STT_WS_URL, the same WebSocket protocol as utils/sttClient.js).
 *
 * The file never leaves the browser as a file: it is decoded here, turned into
 * 16 kHz mono 16-bit PCM and streamed to the server faster than real time
 * (TRANSCRIBE_RATE). The server answers with "final" phrases, which become the
 * transcript's sentences.
 *
 * What the server does and does not do (measured 2026-11-10):
 *  - it works through one stream at a time, about 11x real time, so parallel
 *    connections do not help: we send at 10x, just under its pace;
 *  - flooding it (a whole file at once) makes it drop the connection on its
 *    keepalive ping, so we never let more than SEND_AHEAD bytes queue up;
 *  - it only says "final" after a pause: every session ends with TAIL_SEC of
 *    silence, then {"type":"eof"}. A server that knows eof answers
 *    {"type":"done"} and we are finished; an older one ignores it, and the
 *    session is over once nothing has come back for IDLE_DONE_MS;
 *  - long files go in sessions of SESSION_SEC of audio, so no session runs
 *    for long and a dropped connection only costs its own part.
 *
 * Big MP3s are decoded in slices (MP3 is made of small independent frames, a
 * slice decodes on its own), so a one-hour episode never sits in memory as
 * raw audio. Other formats are decoded whole.
 */
import { STT_WS_URL } from './config';
import { getSttToken } from './sttClient';
import { modelIdToTag } from './detectLang';

export const SAMPLE_RATE = 16000;
export const TRANSCRIBE_RATE = 10;
const FRAME_SEC = 0.2;
const SEND_AHEAD = 64 * 1024;
const TAIL_SEC = 1.5;
const IDLE_DONE_MS = 3000;
const SESSION_SEC = 15 * 60;
const MP3_SLICE_BYTES = 2 * 1024 * 1024;
const MAX_RECONNECTS = 3;
const RESUME_BACK_SEC = 5;
// A Hive post (body + metadata) has to fit in one 64 KB transaction
export const TRANSCRIPT_MAX_CHARS = 40000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });

// ── Languages ───────────────────────────────────────────────────────────────

let langCache = null;
/** The server's models as language tags ('en-us' -> 'en-US'); [] when there is no server. */
export async function transcriptLanguages() {
  if (!STT_WS_URL) return [];
  if (langCache) return langCache;
  try {
    const r = await fetch('/api/stt-langs');
    const j = r.ok ? await r.json() : null;
    const models = Array.isArray(j?.models) ? j.models : [];
    langCache = [...new Set(models.map(modelIdToTag).filter(Boolean))];
    return langCache;
  } catch {
    return [];
  }
}

// ── Decoding ────────────────────────────────────────────────────────────────

export function isMp3(blob, name = '') {
  return /audio\/(mpeg|mp3)/i.test(blob?.type || '') || /\.mp3$/i.test(name || blob?.name || '');
}

/** Bytes taken by an ID3v2 tag at the start (cover art can be megabytes), else 0. */
export function id3Size(bytes) {
  if (!bytes || bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return 0;
  const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
  return 10 + size + ((bytes[5] & 0x10) ? 10 : 0);
}

/** An AudioBuffer (any rate the context gave, any channels) -> mono Int16 PCM. */
export function toPcm16(audio) {
  const n = audio.length;
  const chans = audio.numberOfChannels || 1;
  const data = [];
  for (let c = 0; c < chans; c++) data.push(audio.getChannelData(c));
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < chans; c++) s += data[c][i];
    s /= chans;
    out[i] = s >= 1 ? 32767 : s <= -1 ? -32768 : Math.round(s * 32767);
  }
  return out;
}

function decodeAt16k(arrayBuffer) {
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Ctx) return Promise.reject(new Error('no-audio-decoder'));
  const ctx = new Ctx(1, 1, SAMPLE_RATE);
  // Older Safari only has the callback form
  return new Promise((resolve, reject) => {
    const p = ctx.decodeAudioData(arrayBuffer, resolve, reject);
    if (p && typeof p.then === 'function') p.then(resolve, reject);
  });
}

/**
 * The file as mono 16 kHz Int16 pieces, in order. MP3s over a slice are
 * decoded slice by slice; a slice that fails is skipped (a short gap), the
 * whole file failing is an error.
 */
export async function* decodePieces(blob, name = '') {
  if (!isMp3(blob, name) || blob.size <= MP3_SLICE_BYTES) {
    yield toPcm16(await decodeAt16k(await blob.arrayBuffer()));
    return;
  }
  const start = id3Size(new Uint8Array(await blob.slice(0, 10).arrayBuffer()));
  let ok = 0;
  for (let at = start; at < blob.size; at += MP3_SLICE_BYTES) {
    let pcm = null;
    try { pcm = toPcm16(await decodeAt16k(await blob.slice(at, at + MP3_SLICE_BYTES).arrayBuffer())); } catch { /* skip this slice */ }
    if (pcm) { ok++; yield pcm; }
  }
  if (!ok) throw new Error('decode-failed');
}

// ── Text ────────────────────────────────────────────────────────────────────

// What the recognizer makes of a cough or a breath: not a sentence
const NOISE = new Set(['the', 'a', 'uh', 'um', 'huh', 'hmm', 'mm', 'oh', 'ah', 'er']);
const PARAGRAPH_WORDS = 70;

/** A raw "final" (lower case, no punctuation) -> a sentence, or '' for noise. */
export function sentence(raw) {
  const words = String(raw || '').toLowerCase().replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (!words.length || (words.length === 1 && NOISE.has(words[0]))) return '';
  let s = words.join(' ')
    .replace(/\bi\b/g, 'I')
    .replace(/\bi'(m|ve|ll|d)\b/g, "I'$1")
    .replace(/\bthree speak\b/g, '3Speak');
  s = s.charAt(0).toUpperCase() + s.slice(1);
  return `${s}.`;
}

/** Sentences -> paragraphs of about PARAGRAPH_WORDS words. */
export function paragraphs(sentences) {
  const out = [];
  let cur = [];
  let words = 0;
  for (const s of sentences) {
    if (!s) continue;
    cur.push(s);
    words += s.split(' ').length;
    if (words >= PARAGRAPH_WORDS) { out.push(cur.join(' ')); cur = []; words = 0; }
  }
  if (cur.length) out.push(cur.join(' '));
  return out;
}

/**
 * The transcript block for a post: heading + paragraphs, cut at a paragraph
 * to `max` characters. Returns { text, shortened }.
 */
export function transcriptBlock(paras, heading, max = TRANSCRIPT_MAX_CHARS) {
  if (!paras.length) return { text: '', shortened: false };
  let text = `**${heading}**`;
  let shortened = false;
  for (const p of paras) {
    if (text.length + 2 + p.length > max) { shortened = true; break; }
    text += `\n\n${p}`;
  }
  if (shortened) text += '\n\n…';
  return { text, shortened };
}

/**
 * The description with the new transcript: the block from an earlier run
 * (`previous`) is replaced, else it goes under what was written.
 */
export function withTranscript(desc, previous, next) {
  const text = desc || '';
  if (previous && text.includes(previous)) return text.replace(previous, next).replace(/\n{3,}/g, '\n\n').trim();
  if (!next) return text;
  return text.trim() ? `${text.trim()}\n\n${next}` : next;
}

// ── Streaming ───────────────────────────────────────────────────────────────

/**
 * One server session: send `pcm` (Int16Array, may be several pieces joined
 * by the caller) paced at TRANSCRIBE_RATE, then the silent tail, and resolve
 * with the finals once the server goes quiet. `onSent(samples)` reports
 * progress. Rejects with code 'unauthorized' / 'connection' / AbortError.
 */
export function runSession({ pcm, url, lang, token, signal, onSent, WebSocketImpl = globalThis.WebSocket, now = () => Date.now(), idleMs = IDLE_DONE_MS }) {
  return new Promise((resolve, reject) => {
    const finals = [];
    let partial = '';
    let lastMsg = 0;
    let sentAll = false;
    let finished = false;
    let ws;
    const finish = (err) => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener?.('abort', onAbort);
      try { ws?.close(); } catch { /* ignore */ }
      if (err) reject(err);
      else resolve(partial.trim() ? [...finals, partial] : finals);
    };
    const onAbort = () => finish(abortError());
    if (signal?.aborted) { finish(abortError()); return; }
    signal?.addEventListener?.('abort', onAbort);

    const wsUrl = new URL(url);
    wsUrl.searchParams.set('lang', lang);
    if (token) wsUrl.searchParams.set('token', token);
    try { ws = new WebSocketImpl(wsUrl.toString()); } catch { finish(Object.assign(new Error('connection'), { code: 'connection' })); return; }
    ws.binaryType = 'arraybuffer';
    ws.onmessage = (e) => {
      lastMsg = now();
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type === 'final') { finals.push(msg.text || ''); partial = ''; }
      else if (msg.type === 'partial') partial = msg.text || '';
      else if (msg.type === 'done' && sentAll) finish();
    };
    ws.onclose = (ev) => {
      if (finished) return;
      if (sentAll) { finish(); return; } // closed after everything went: keep what came back
      finish(Object.assign(new Error(ev?.code === 4401 ? 'unauthorized' : 'connection'), { code: ev?.code === 4401 ? 'unauthorized' : 'connection', finals, partial }));
    };
    ws.onerror = () => {};
    ws.onopen = async () => {
      try { ws.send(JSON.stringify({ type: 'start', lang })); } catch { /* close follows */ }
      const frame = Math.round(SAMPLE_RATE * FRAME_SEC);
      const tail = new Int16Array(Math.round(SAMPLE_RATE * TAIL_SEC));
      const t0 = now();
      const total = pcm.length + tail.length;
      for (let i = 0; i < total && !finished; i += frame) {
        // Paced just under the server, and never more than a little queued
        while (!finished && (ws.bufferedAmount > SEND_AHEAD || (i / SAMPLE_RATE) * 1000 / TRANSCRIBE_RATE > now() - t0)) await sleep(20);
        if (finished || ws.readyState !== 1) return;
        const piece = i < pcm.length ? pcm.subarray(i, Math.min(i + frame, pcm.length)) : tail.subarray(0, Math.min(frame, total - i));
        try { ws.send(piece.slice().buffer); } catch { return; }
        if (i < pcm.length) onSent?.(Math.min(i + frame, pcm.length));
      }
      try { ws.send(JSON.stringify({ type: 'eof' })); } catch { /* close follows */ }
      sentAll = true;
      lastMsg = Math.max(lastMsg, now());
      while (!finished) {
        await sleep(200);
        if (now() - lastMsg >= idleMs) finish();
      }
    };
  });
}

function joinPieces(pieces, length) {
  const out = new Int16Array(length);
  let at = 0;
  for (const p of pieces) { out.set(p, at); at += p.length; }
  return out;
}

/**
 * Transcribe `blob`. `durationSec` (known length) drives the progress until
 * decoding has measured it. onProgress({ phase: 'decoding'|'listening', done: 0..1 }).
 * Resolves with the sentences (formatted, noise dropped).
 */
export async function transcribe(blob, { name = '', lang = 'en-US', durationSec = 0, signal, onProgress, url = STT_WS_URL, WebSocketImpl, idleMs } = {}) {
  if (!url) throw Object.assign(new Error('unavailable'), { code: 'unavailable' });
  const total = Math.max(1, Math.round((durationSec || 0) * SAMPLE_RATE));
  const report = (phase, done) => { try { onProgress?.({ phase, done: Math.max(0, Math.min(0.99, done)) }); } catch { /* ignore */ } };
  report('decoding', 0);

  const finals = [];
  let pending = [];
  let pendingLen = 0;
  let doneSamples = 0;
  let reconnects = 0;

  const flush = async () => {
    if (!pendingLen) return;
    const pcm = joinPieces(pending, pendingLen);
    pending = [];
    pendingLen = 0;
    let from = 0;
    while (from < pcm.length) {
      if (signal?.aborted) throw abortError();
      const token = await getSttToken();
      const base = doneSamples;
      let sent = 0;
      try {
        const got = await runSession({
          pcm: pcm.subarray(from), url, lang, token, signal, idleMs,
          ...(WebSocketImpl ? { WebSocketImpl } : {}),
          onSent: (n) => { sent = n; report('listening', (base + n) / Math.max(total, base + n + 1)); },
        });
        finals.push(...got);
        doneSamples = base + (pcm.length - from);
        from = pcm.length;
      } catch (err) {
        if (err?.name === 'AbortError' || err?.code === 'unauthorized' || reconnects >= MAX_RECONNECTS) throw err;
        // Dropped: keep what came back and go on from what we had sent, less
        // a few seconds the server may not have reached (a word or two may
        // show up twice, none go missing)
        reconnects++;
        finals.push(...(err.finals || []));
        const resume = Math.max(0, sent - RESUME_BACK_SEC * SAMPLE_RATE);
        doneSamples = base + resume;
        from += resume;
        await sleep(1000);
      }
    }
  };

  for await (const piece of decodePieces(blob, name)) {
    if (signal?.aborted) throw abortError();
    pending.push(piece);
    pendingLen += piece.length;
    if (pendingLen >= SESSION_SEC * SAMPLE_RATE) await flush();
  }
  await flush();
  report('listening', 0.99);
  return finals.map(sentence).filter(Boolean);
}
