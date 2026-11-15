/**
 * Reading 3Speak HLS playlists: which rendition to take, and its segments.
 *
 * Uploads are encoded to muxed renditions (H.264 + AAC in one .ts stream, no
 * audio-only group): `manifest.m3u8` lists e.g. 1080p, 720p and 480p, highest
 * first. Listening to a video therefore takes the LOWEST bandwidth rendition
 * (lib/videoAsAudio.js), and a download for offline takes the best one at or
 * under 480p (lib/videoDownloads.js). Every playlist the browser reads comes
 * through the player API (play.3speak.tv /hls), which sends CORS headers and
 * absolutises the references.
 */

const lines = (text) => String(text || '').split(/\r?\n/).map((l) => l.trim());

/** Resolve a playlist reference against the playlist's own URL. */
export function resolveRef(ref, base) {
  try { return new URL(ref, base).href; } catch { return ref; }
}

/**
 * The renditions of a master playlist, [{ url, bandwidth, width, height }], in
 * playlist order. [] for a media playlist (it has no #EXT-X-STREAM-INF).
 */
export function parseMaster(text, baseUrl) {
  const ls = lines(text);
  const out = [];
  for (let i = 0; i < ls.length; i++) {
    if (!ls[i].startsWith('#EXT-X-STREAM-INF')) continue;
    const bandwidth = Number(/BANDWIDTH=(\d+)/.exec(ls[i])?.[1]) || 0;
    const res = /RESOLUTION=(\d+)x(\d+)/.exec(ls[i]);
    let j = i + 1;
    while (j < ls.length && (!ls[j] || ls[j].startsWith('#'))) j++;
    if (j < ls.length) {
      out.push({ url: resolveRef(ls[j], baseUrl), bandwidth, width: res ? Number(res[1]) : 0, height: res ? Number(res[2]) : 0 });
      i = j;
    }
  }
  return out;
}

/** The rendition with the lowest bandwidth, or null. */
export function lowestRendition(renditions) {
  let best = null;
  for (const r of renditions || []) {
    if (!best || (r.bandwidth || Infinity) < (best.bandwidth || Infinity)) best = r;
  }
  return best;
}

/**
 * The best rendition at or under `maxHeight` (by height, then bandwidth); the
 * lowest one when every rendition is taller. null for none.
 */
export function renditionUpTo(renditions, maxHeight = 480) {
  const list = (renditions || []).filter((r) => r?.url);
  if (!list.length) return null;
  const fits = list.filter((r) => r.height && r.height <= maxHeight);
  if (!fits.length) return lowestRendition(list);
  return fits.reduce((a, b) => (b.height > a.height || (b.height === a.height && b.bandwidth > a.bandwidth) ? b : a));
}

/**
 * A media playlist's segments: { segments: [{ url, duration }], targetDuration,
 * encrypted, map }. `map` is an #EXT-X-MAP init segment url (fMP4) or null;
 * encrypted is true when the playlist names a key (never the case for 3Speak
 * uploads, and then it is not saved).
 */
export function parseMedia(text, baseUrl) {
  const ls = lines(text);
  const segments = [];
  let duration = null;
  let targetDuration = 0;
  let encrypted = false;
  let map = null;
  for (const l of ls) {
    if (l.startsWith('#EXT-X-TARGETDURATION:')) targetDuration = Number(l.split(':')[1]) || 0;
    else if (l.startsWith('#EXT-X-KEY:') && !/METHOD=NONE/.test(l)) encrypted = true;
    else if (l.startsWith('#EXT-X-MAP:')) {
      const uri = /URI="([^"]+)"/.exec(l)?.[1];
      if (uri) map = resolveRef(uri, baseUrl);
    } else if (l.startsWith('#EXTINF:')) duration = parseFloat(l.slice(8)) || 0;
    else if (l && !l.startsWith('#')) {
      segments.push({ url: resolveRef(l, baseUrl), duration: duration ?? 0 });
      duration = null;
    }
  }
  return { segments, targetDuration, encrypted, map };
}

/** A VOD media playlist for these segments, each named by `uriOf(index)`. */
export function buildMediaPlaylist(segments, uriOf, { map = null } = {}) {
  const target = Math.max(1, Math.ceil(Math.max(0, ...segments.map((s) => s.duration || 0))));
  const out = ['#EXTM3U', `#EXT-X-VERSION:${map ? 7 : 3}`, `#EXT-X-TARGETDURATION:${target}`, '#EXT-X-MEDIA-SEQUENCE:0', '#EXT-X-PLAYLIST-TYPE:VOD'];
  if (map) out.push(`#EXT-X-MAP:URI="${map}"`);
  segments.forEach((s, i) => {
    out.push(`#EXTINF:${(Number(s.duration) || 0).toFixed(6)},`);
    out.push(uriOf(i));
  });
  out.push('#EXT-X-ENDLIST');
  return `${out.join('\n')}\n`;
}

/** Fetch a playlist's text (CORS, no cookies). Throws on a failed answer. */
export async function fetchPlaylist(url, { signal, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(url, { mode: 'cors', credentials: 'omit', signal });
  if (!res.ok) {
    const err = new Error(`playlist ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.text();
}
