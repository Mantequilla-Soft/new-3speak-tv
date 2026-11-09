// Which audio sources an <audio> element must ask for in CORS mode.
//
// ipfs-audio.3speak.tv answers a range from the middle of a file without a
// Content-Type. Loaded plainly, the browser's ORB check blocks that response
// (Firefox skipping a big ID3 tag, Chrome after a seek or a pre-roll spot), and
// Chrome retries forever without an error event, so the track sits at 0:00. ORB
// does not apply in CORS mode, and that host sends Access-Control-Allow-Origin
// once, so it is always asked in CORS mode.
// Every other source stays plain: ipfs-3speak.b-cdn.net and ipfs.3speak.tv send
// the CORS header twice (which fails CORS) but type every range, and outside
// podcast hosts mostly send no CORS headers at all.
export const CORS_MODE_HOSTS = ['ipfs-audio.3speak.tv'];

export function needsCorsMode(src) {
  try { return CORS_MODE_HOSTS.includes(new URL(src).hostname); } catch { return false; }
}

// Load `src` into `el`, in CORS mode when the source needs it or `forceCors`
// (an element routed through Web Audio, which only works in CORS mode).
export function setAudioSrc(el, src, forceCors = false) {
  if (forceCors || needsCorsMode(src)) el.crossOrigin = 'anonymous';
  else el.removeAttribute('crossorigin');
  el.src = src;
}
