import { CHECKER_URL } from '../utils/config';

/**
 * Ask whether this account is being shown a pre-upload spot.
 *
 * Returns the ad, or null for every other outcome — not shown to this account, a Pro
 * subscriber, no campaign running, the checker unreachable, a malformed answer. The
 * caller treats null as "post immediately", so every failure has to look like null
 * rather than like an exception somebody might forget to catch.
 *
 * The request carries no video: the gate runs before anything is posted, which is the
 * whole reason the surface exists and why the server does not ask for an owner or a
 * permlink here.
 */
export async function fetchUploadGateAd(account) {
  if (!account) return null;
  try {
    const res = await fetch(`${CHECKER_URL}/m/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ surface: 'upload', viewer: String(account).toLowerCase() }),
    });
    if (!res.ok) return null;
    const body = await res.json();
    const ad = body && body.uploadAd;
    return ad && typeof ad.manifestUrl === 'string' ? ad : null;
  } catch {
    return null;
  }
}

/**
 * Tell the checker the gated video actually got posted.
 *
 * Watching the spot only STARTS its impression; this is what completes it, and the
 * server refuses the claim unless a video with this permlink exists under the same
 * account and was created after the spot was served. Without that, "watch it and get
 * credited" is a loop somebody can sit in — and on this surface the person watching is
 * the person being paid.
 *
 * Fire and forget. The video is already published by the time this runs, so nothing the
 * user can see depends on the answer, and a failure here must never surface as though
 * their upload went wrong.
 */
export function confirmUploadGatePost(sid, permlink) {
  if (!sid || !permlink) return;
  try {
    fetch(`${CHECKER_URL}/m/${encodeURIComponent(sid)}/posted`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permlink }),
      keepalive: true,   // survives the navigation away from the studio
    }).catch(() => {});
  } catch {
    // Nothing to do and nothing to tell them: the post itself succeeded.
  }
}

/** The session id out of a gate manifest URL, which is where the checker puts it. */
export function gateSessionId(ad) {
  const m = /\/m\/([0-9a-f]{32})\//.exec(String(ad?.manifestUrl || ''));
  return m ? m[1] : null;
}
