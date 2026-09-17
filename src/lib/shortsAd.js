/**
 * The shorts surface's half of server-side ad insertion.
 *
 * A shorts spot is NOT stitched into anybody's short — it is its own item, a
 * full-screen vertical video played between one short and the next. So there is no
 * timeline to map and no break to detect: this asks whether it is time, and hands
 * back a manifest to play. See utils/adFormats.js `shorts_roll` for why the format
 * works that way rather than as a pre-roll.
 *
 * ⚠️ The cadence is counted in SHORTS WATCHED, not minutes. Someone swiping the feed
 * clears ten shorts well inside any sane time-based cooldown, so a minutes rule would
 * either silence the surface or fire constantly depending on how fast they swipe. The
 * count lives here, in memory, for the length of one visit — it is not a profile and
 * is not written to the device.
 *
 * Every failure path returns "no ad". A short must never fail to play because the ad
 * system had a bad day.
 */
import { CHECKER_URL } from '../utils/config';
import { rememberAdSeen, recentAdKeys } from './adBreak';

let watchedSinceAd = 0;

/** Count one short as watched. Called when the feed advances, not when it is opened. */
export function countShortWatched() {
  watchedSinceAd += 1;
}

/** How many have gone by since the last spot. Exposed for the cadence check and tests. */
export function shortsSinceAd() {
  return watchedSinceAd;
}

/**
 * Ask whether this viewer is due a spot.
 *
 * `owner`/`permlink` are the short they just FINISHED: that creator is the reason the
 * viewer was there for the slot, and is who the creator half of the revenue is owed
 * to. Returns null for "not yet", "nothing booked", or anything going wrong.
 */
export async function requestShortsAd({ owner, permlink, viewer }) {
  try {
    const res = await fetch(`${CHECKER_URL}/m/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        surface: 'shorts',
        owner: owner || null,
        permlink: permlink || null,
        viewer: viewer || null,
        shortsWatched: watchedSinceAd,
        recentAdKeys: recentAdKeys(),
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.shortsAd || !data.shortsAd.manifestUrl) return null;

    // The counter resets on a SPOT SERVED, not on a request. A run of "not yet"
    // answers must keep counting up, or the cadence never arrives.
    watchedSinceAd = 0;
    // Remembered in the same store the watch page uses, so a spot seen in the feed
    // is not repeated on the next watch page either. One shared notion of "already
    // shown this ad".
    rememberAdSeen(data.shortsAd.adKey);
    return data.shortsAd;
  } catch {
    return null;
  }
}

/** Forget the count — a fresh visit starts over. */
export function resetShortsAdCount() {
  watchedSinceAd = 0;
}

/** The session id lives in the manifest URL; nothing else hands it to us. */
function sidOf(manifestUrl) {
  return (String(manifestUrl || '').match(/\/m\/([0-9a-f]{32})\/short\.m3u8/) || [])[1] || null;
}

/**
 * Tell the server how many seconds of the spot actually PLAYED.
 *
 * 🚨 This is what bills the advertiser and pays the creator, not the segment fetches.
 * A player downloads ahead of what it shows — the closing segment of a 29s spot is
 * requested around eleven seconds in and not shown until 24.6s — so measuring delivery
 * by what was fetched counted buffered spots nobody saw and missed watched spots that
 * ended early. The server credits this against its own clock, so an inflated figure
 * buys nothing; being honest here is simply the only way the number is right.
 *
 * Fire-and-forget on purpose, `keepalive` so the last beat survives the page going
 * away, and every failure swallowed: a viewer's feed must never stutter because our
 * accounting had a bad moment.
 */
export function reportShortsWatched(manifestUrl, seconds) {
  const sid = sidOf(manifestUrl);
  if (!sid || !(seconds > 0)) return;
  try {
    fetch(`${CHECKER_URL}/m/${sid}/w`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seconds }),
      keepalive: true,
    }).catch(() => {});
  } catch { /* never the reason a short fails to play */ }
}

/**
 * 🚫 DO NOT ADD A PREFETCH HERE. It was tried, and it is wrong twice over.
 *
 * The obvious fix for the black frame is to pull the spot's playlist and first segment
 * into the HTTP cache while the previous short is still playing. Neither half works:
 *
 *   1. The checker serves /m/<sid>/short.m3u8 with `Cache-Control: no-store`, so the
 *      browser is forbidden from keeping it. The player re-fetches everything cold
 *      regardless, and the warm-up is pure overhead.
 *
 *   2. Worse, the segments in that playlist are OUR endpoints (/m/<sid>/a and /b), not
 *      the CDN's — and fetching one is what records the delivery. A prefetch bills the
 *      advertiser for a spot nobody has seen yet, and starts the pacing clock early,
 *      so the real playback then looks too fast and gets refused a count.
 *
 * The black frame is covered in the UI instead — see the `loading` branch of
 * ShortsAdOverlay, held until the first timeupdate proves a frame has rendered.
 */
