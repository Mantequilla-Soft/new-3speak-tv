import { reportClientError } from '../../utils/reportClientError';

// What happened between the end of one track and the start of the next, for the
// queue that stops with the screen off on Android (twice "fixed" without seeing
// the phone). From `ended` until the next track really plays, the player notes
// each step here: which way the next track was started, what play() answered,
// the element's errors and stalls, whether the screen was off. When the next
// track took longer than GAP_MS, a play() was refused, or the listener comes back
// to a player that never went on, the steps go to the checker's client error log
// (routes/clientErrors.js, Mongo client_errors) as "[audio-queue] ...". Track ids
// only, no account name. Never throws: it must not be what breaks playback.
const GAP_MS = 5000;
const MAX_STEPS = 40;

let trace = null;

const screen = () => {
  try {
    return { vis: document.visibilityState, focus: document.hasFocus() };
  } catch {
    return {};
  }
};

// The last time the playing track moved on (timeupdate): `ended` should follow
// within a second. Much later means the page was frozen or held back at the end
// of the track, and the end only came through when the phone woke up.
let lastTickAt = 0;
export function traceTick() { lastTickAt = Date.now(); }

// A track ended: a new trace (an unsent earlier one has had its chance).
export function traceEnded(info) {
  try {
    const lateMs = lastTickAt ? Date.now() - lastTickAt : null;
    trace = { at: Date.now(), steps: [['ended', 0, { ...info, lateMs, ...screen() }]], bad: null, late: lateMs != null && lateMs > GAP_MS, sent: false };
    if (trace.late) trace.bad = `ended ${Math.round(lateMs / 1000)} s late`;
  } catch { /* never in the way */ }
}

export function traceStep(name, data) {
  if (!trace) return;
  try {
    trace.steps.push([name, Date.now() - trace.at, data ?? null]);
    if (trace.steps.length > MAX_STEPS) trace.steps.splice(1, 1);
  } catch { /* never in the way */ }
}

// Something went wrong on the way (a refused play()): send even if it recovers.
export function traceBad(name, err) {
  if (!trace) return;
  const what = err ? `${err.name || 'Error'}: ${err.message || ''}`.slice(0, 200) : null;
  traceStep(name, what);
  if (!trace.bad) trace.bad = name;
}

function send(reason) {
  if (!trace || trace.sent) return;
  trace.sent = true;
  reportClientError({
    kind: 'audio-queue',
    error: { message: `[audio-queue] ${reason}`, stack: JSON.stringify(trace.steps) },
  });
}

// The next track really plays: done, and reported when it took too long.
export function tracePlaying(info) {
  if (!trace) return;
  traceStep('playing', { ...info, ...screen() });
  const gap = Date.now() - trace.at;
  if (gap > GAP_MS) send(`next track after ${Math.round(gap / 1000)} s${trace.bad ? ` (${trace.bad})` : ''}`);
  else if (trace.bad) send(`next track started despite ${trace.bad}`);
  trace = null;
}

// The listener is back (screen on): a trace still open means nothing played.
export function traceBack() {
  if (!trace || trace.sent) return;
  traceStep('back', screen());
  if (Date.now() - trace.at > GAP_MS) send(`back after ${Math.round((Date.now() - trace.at) / 1000)} s, next track not playing${trace.bad ? ` (${trace.bad})` : ''}`);
}

// No next track (end of the list), or a stop on purpose: nothing to explain.
export function traceDrop() { trace = null; }

export function traceOpen() { return !!trace; }
