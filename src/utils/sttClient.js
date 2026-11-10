// Streaming speech-to-text client for the teleprompter.
//
// Taps the SAME MediaStreamTrack that MediaRecorder is recording (via Web Audio —
// no second getUserMedia, so it can't starve the browser recognizer the way a
// second mic capture does), downsamples it in an AudioWorklet, and streams 16 kHz
// mono Int16 PCM to a self-hosted STT server over a WebSocket. Transcripts come
// back as JSON and are handed to `onTranscript`.
//
// Wire protocol (must match the STT server — see the hand-off plan):
//   connect:  `${url}?lang=<bcp47>&token=<exp.hmac>`
//   client → server:  first a text frame {"type":"start","lang":"en-US"}, then
//                     binary frames of PCM16 mono 16 kHz little-endian
//   server → client:  {"type":"partial"|"final","text":"..."}  and
//                     {"type":"error","message":"..."}
//
// Returns a handle with stop(); tears everything down safely.
import { EMBED_API_KEY } from './config';

// Mint a short-lived signed token from the preview server (which holds the signing
// secret — never the browser). Returns '' on failure so a no-auth STT box (local
// testing) still connects; an auth-required box will then close 4401.
export async function getSttToken() {
  try {
    const r = await fetch('/api/stt-token', {
      credentials: 'include',
      headers: EMBED_API_KEY ? { 'X-API-Key': EMBED_API_KEY } : {},
    });
    if (!r.ok) return '';
    const j = await r.json();
    return j.token || '';
  } catch { return ''; }
}

export function createSttStream({ track, url, lang, onTranscript, onStatus }) {
  let ctx = null;
  let source = null;
  let worklet = null;
  let ws = null;
  let closed = false;

  const status = (s, msg) => { try { onStatus?.(s, msg); } catch { /* ignore */ } };

  (async () => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx || !track) { status('error', 'audio unavailable'); return; }
      ctx = new AudioCtx();
      await ctx.audioWorklet.addModule('/stt-downsampler.js');
      if (closed) { try { ctx.close(); } catch { /* ignore */ } return; }

      source = ctx.createMediaStreamSource(new MediaStream([track]));
      worklet = new AudioWorkletNode(ctx, 'stt-downsampler', { processorOptions: { targetRate: 16000 } });

      const token = await getSttToken();
      if (closed) { try { ctx.close(); } catch { /* ignore */ } return; }
      const wsUrl = new URL(url);
      wsUrl.searchParams.set('lang', lang || 'en-US');
      if (token) wsUrl.searchParams.set('token', token);
      ws = new WebSocket(wsUrl.toString());
      ws.binaryType = 'arraybuffer';
      status('connecting');

      ws.onopen = () => {
        status('connected');
        try { ws.send(JSON.stringify({ type: 'start', lang: lang || 'en-US' })); } catch { /* ignore */ }
      };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          // isFinal closes the utterance so the matcher restarts its word count.
          if (msg.type === 'partial' || msg.type === 'final') onTranscript?.(msg.text || '', msg.type === 'final');
          else if (msg.type === 'error') status('error', msg.message || 'server error');
        } catch { /* ignore non-JSON */ }
      };
      ws.onerror = () => status('error', 'connection failed');
      ws.onclose = (ev) => { if (closed) return; status('error', ev && ev.code === 4401 ? 'unauthorized' : 'closed'); };

      worklet.port.onmessage = (e) => {
        if (ws && ws.readyState === 1) { try { ws.send(e.data); } catch { /* ignore */ } }
      };

      source.connect(worklet);
      worklet.connect(ctx.destination); // pulls the graph; the processor emits silence
    } catch (err) {
      status('error', err?.message || 'stt init failed');
    }
  })();

  return {
    stop() {
      closed = true;
      try { ws?.close(); } catch { /* ignore */ }
      try { source?.disconnect(); } catch { /* ignore */ }
      try { worklet?.disconnect(); } catch { /* ignore */ }
      try { ctx?.close(); } catch { /* ignore */ }
    },
  };
}

export default createSttStream;
