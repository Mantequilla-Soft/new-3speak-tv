/**
 * Live captions for a stream host (H11): the SDK studio's CaptionSource, built
 * on the teleprompter's speech-to-text client (utils/sttClient.js), so it uses
 * the SAME self-hosted speech server and the same signed tokens. No new server.
 *
 * A live stream runs for hours, but one speech session does not: the speech
 * server ends a session after its time limit (10 minutes by default) and a
 * token is short-lived. So this keeps one session open at a time and reconnects
 * with a fresh token when it closes, backing off when it keeps failing, and
 * gives up (status 'error', the studio shows it and frees its slot) after
 * MAX_FAILS closes in a row without any text in between. A session that was
 * connected for STABLE_MS or longer ended cleanly (the time limit, during a
 * quiet stretch too) and starts the count afresh; one dropped right after
 * connecting still counts, so a server that keeps refusing is not retried
 * every second forever.
 *
 * With `liveUrl` (the server's /live, where stream captions run on Whisper:
 * Vosk partials, Whisper's sentence as each final) it starts there, with a
 * token scoped to it for the signed-in `user`. A /live that never connects
 * (nginx not passing it yet, no token) is left for `url` (/stt) for the rest
 * of the stream, at once and without counting as a failure.
 */
import { createSttStream } from './sttClient';

export const BACKOFF_MS = [1000, 2000, 5000, 10000, 20000];
export const MAX_FAILS = 6;
export const STABLE_MS = 30 * 1000;

/**
 * @param {{ url: string, connect?: typeof createSttStream }} cfg
 * @returns {(track: MediaStreamTrack, opts: { lang: string, onText: (text: string, final: boolean) => void, onStatus?: (s: string, m?: string) => void }) => { stop: () => void }}
 */
export function createLiveCaptionSource({ url, liveUrl = null, user = null, connect = createSttStream }) {
  return (track, { lang, onText, onStatus }) => {
    let onLive = !!liveUrl;
    let liveWorked = false;
    let stopped = false;
    let session = null;
    let gen = 0;
    let fails = 0;
    let timer = null;
    const status = (s, m) => { try { onStatus?.(s, m); } catch { /* ignore */ } };

    const open = () => {
      if (stopped) return;
      const g = ++gen;
      let connectedAt = 0;
      status('connecting');
      const live = onLive;
      session = connect({
        track,
        url: live ? liveUrl : url,
        lang,
        ...(live ? { tokenScope: 'live', user } : {}),
        onTranscript: (text, isFinal) => {
          if (stopped || g !== gen) return;
          // Words came through: the connection works, start counting afresh.
          fails = 0;
          onText(text, !!isFinal);
        },
        onStatus: (s, m) => {
          if (stopped || g !== gen) return;
          if (s === 'connected') {
            connectedAt = Date.now();
            if (live) liveWorked = true;
            status('connected');
            return;
          }
          if (s !== 'error') return;
          // One close reports twice (the server's error message, then the
          // socket close): only the first one counts, for this session.
          gen += 1;
          try { session?.stop(); } catch { /* already closed */ }
          session = null;
          if (live && !liveWorked && !connectedAt) {
            onLive = false;
            open();
            return;
          }
          if (connectedAt && Date.now() - connectedAt >= STABLE_MS) fails = 0;
          fails += 1;
          if (fails >= MAX_FAILS) { status('error', m); return; }
          const wait = BACKOFF_MS[Math.min(fails - 1, BACKOFF_MS.length - 1)];
          timer = setTimeout(() => { timer = null; open(); }, wait);
        },
      });
    };
    open();

    return {
      stop() {
        stopped = true;
        gen += 1;
        if (timer) clearTimeout(timer);
        timer = null;
        try { session?.stop(); } catch { /* already closed */ }
        session = null;
      },
    };
  };
}

/**
 * The speech server's models as the studio's language list, named in the
 * site language (`en-us` -> "American English").
 */
export function captionLanguages(models, uiLang) {
  let names = null;
  try { names = new Intl.DisplayNames([uiLang || 'en'], { type: 'language' }); } catch { names = null; }
  return (Array.isArray(models) ? models : [])
    .filter((m) => typeof m === 'string' && /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/i.test(m))
    .map((code) => {
      const [base, region] = code.split('-');
      const tag = region ? `${base}-${region.toUpperCase()}` : base;
      let label;
      try { label = names?.of(tag) || code; } catch { label = code; }
      return { code: code.toLowerCase(), label };
    });
}
