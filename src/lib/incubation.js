// Client for INCUBATING users: people signed in to 3Speak with no Hive account.
//
// Their content is off-chain. Reads come from the checker (which owns feeds and
// profiles and already has the indexes); writes go to the incubation service,
// which owns the lifecycle including the graduation replay.
//
// THE RULE THIS FILE EXISTS TO ENFORCE: a handle is NOT a Hive username. It is a
// display pseudonym for an account that does not exist yet. It must never reach
// getOperationUser(), an operation builder, or /api/broadcast — see
// currentHandle() below, which is deliberately a separate key from `user_id`.

import { CHECKER_URL } from '../utils/config';

const HANDLE_KEY = 'incubation_handle';

/**
 * The signed-in incubation handle, or null.
 *
 * Read from its OWN localStorage key, never from `user_id`. getOperationUser()
 * reads `user_id` and everything that builds a Hive operation reads that, so a
 * handle stored there would produce posts authored by an account that does not
 * exist. Keeping the keys apart is what makes that mistake unrepresentable.
 */
export function currentHandle() {
  try { return localStorage.getItem(HANDLE_KEY) || null; } catch { return null; }
}

/** True when this browser is signed in as an incubating user. */
export function isIncubating() {
  return !!currentHandle();
}

export function clearIncubation() {
  try { localStorage.removeItem(HANDLE_KEY); } catch { /* ignore */ }
}

/**
 * A deterministic avatar for a handle, as an inline SVG data URI.
 *
 * Incubating users have no Hive account, and images.hive.blog answers an
 * unknown name with a 500 rather than a placeholder — so the usual
 * `/u/<name>/avatar/small` URL renders as a broken image for every one of them.
 * Generated locally: no network call, no failure mode, and stable per handle so
 * the same person looks the same everywhere.
 */
export function handleAvatar(handle) {
  const h = String(handle || '?');
  let n = 0;
  for (let i = 0; i < h.length; i++) n = (n * 31 + h.charCodeAt(i)) >>> 0;
  const hue = n % 360;
  const letter = (h[0] || '?').toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">`
    + `<rect width="64" height="64" rx="32" fill="hsl(${hue} 62% 42%)"/>`
    + `<text x="32" y="43" font-family="system-ui,sans-serif" font-size="30" font-weight="600"`
    + ` fill="#fff" text-anchor="middle">${letter}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

async function json(res) {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.reason = body.reason || null;
    throw err;
  }
  return res.json();
}

// --- reads, via the checker -------------------------------------------------

/**
 * Resolve handles to identities for a screenful of cards, in ONE call.
 *
 * Returns a map keyed by handle. A handle that is absent from the map has no
 * identity behind it any more (the user was erased) — render it as unavailable
 * rather than as a live author.
 */
export async function resolveAuthors(handles) {
  const clean = [...new Set((handles || []).filter(Boolean).map(h => String(h).toLowerCase()))];
  if (!clean.length) return {};
  const out = {};
  // The checker caps a batch at 100; chunk here so a long feed cannot 400.
  for (let i = 0; i < clean.length; i += 100) {
    const res = await fetch(`${CHECKER_URL}/incubation/authors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handles: clean.slice(i, i + 100) })
    });
    Object.assign(out, (await json(res)).authors || {});
  }
  return out;
}

export async function fetchIncubationProfile(handle) {
  return json(await fetch(`${CHECKER_URL}/incubation/profile/${encodeURIComponent(handle)}`));
}

export async function fetchIncubationPosts(handle, limit = 30) {
  return json(await fetch(`${CHECKER_URL}/incubation/user/${encodeURIComponent(handle)}/posts?limit=${limit}`));
}

export async function fetchIncubationFeed(limit = 20) {
  return json(await fetch(`${CHECKER_URL}/incubation/feed?limit=${limit}`));
}

/**
 * Off-chain replies under a REAL Hive post.
 *
 * Incubating users comment on ordinary Hive videos, so without merging these
 * into the thread their comments are invisible on the very page they were
 * written for. Callers should merge by `created` and mark these `onChain:false`.
 */
export async function fetchIncubationReplies(parentAuthor, parentPermlink, limit = 100) {
  const qs = new URLSearchParams({ parentAuthor, parentPermlink, limit: String(limit) });
  return json(await fetch(`${CHECKER_URL}/incubation/replies?${qs}`));
}

// --- writes, via our own server ------------------------------------------
//
// NOT straight to the incubation service. The ButrAuth access token lives in an
// httpOnly cookie, so the browser cannot read it to build an Authorization
// header — and it should not be able to. Our server holds the credential and
// forwards on the user's behalf, exactly as /api/broadcast does for chain ops.
//
// The proxy refuses anyone who already has a Hive account (409): their content
// belongs on chain, not in a shadow database.

async function write(path, method, body) {
  const res = await fetch(`/api/incubation${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: ['GET', 'HEAD'].includes(method) ? undefined : JSON.stringify(body || {})
  });
  return json(res);
}

/** Post off-chain content. `parentAuthor`/`parentPermlink` make it a reply. */
export const postIncubationContent = (payload) => write('/content', 'POST', payload);
export const fetchMyIncubationContent = () => write('/content/mine', 'GET');
export const voteIncubation = (author, permlink, weight) =>
  write('/social/vote', 'PUT', { author, permlink, weight });
export const followIncubation = (following, state) =>
  write('/social/follow', 'PUT', { following, state });
export const saveIncubationProfile = (profile, interests) =>
  write('/social/profile', 'PUT', { profile, interests });
export const fetchMyIncubationProfile = () => write('/social/profile/mine', 'GET');
export const fetchMyIncubationFollows = () => write('/social/follows/mine', 'GET');

/**
 * What would and would not be republished to Hive if this user graduated now.
 *
 * Worth showing rather than hiding: their votes are not coming with them, and a
 * back catalogue of videos publishes over days rather than at once, because a
 * new account's resource credits only allow a couple of posts a day at first.
 */
export const fetchGraduationPlan = () => write('/public/graduation/plan', 'GET');

/**
 * Whether this person may create their Hive account, and why not if they cannot.
 *
 * `canGraduate` folds in everything: butrauth's own eligibility (caps, provider
 * availability, one free account per person) AND whether this frontend's owner
 * has activated them in their sign-ups queue. `awaitingApproval` separates
 * "a human has not looked yet" from an actual refusal.
 *
 * `graduationBlockedReason` is coarse on purpose ('network_limit' covers several
 * distinct causes) because a precise reason would leak information about other
 * people on the same network. Surface it as "contact support", never try to
 * distinguish the cases.
 */
export async function fetchGraduationStatus() {
  const res = await fetch('/api/incubation/graduation-status', { credentials: 'include' });
  return json(res);
}

/**
 * Is this person cleared to create their Hive account?
 *
 * `canGraduate` is now the WHOLE answer, not half of it. It already folds in
 * the two things that matter: butrauth's own eligibility (caps, provider
 * availability, one free account per person) AND whether the owner of this
 * frontend has activated them in their sign-ups queue.
 *
 * That activation replaced the placeholder heuristic that used to live here. It
 * is a better signal than any threshold we could have written: the original
 * "content with good upvotes" could never work — incubating content is
 * off-chain and can receive no Hive votes — and a watch-time formula would
 * still be guessing at what the site's own operator can simply look at and
 * judge.
 */
export function canCreateAccount(status) {
  return !!status?.canGraduate;
}

/**
 * Waiting on a human, as opposed to refused.
 *
 * Worth distinguishing: someone in the queue has done nothing wrong and should
 * not be shown a prompt that dead-ends, nor a refusal that reads as rejection.
 */
export function isAwaitingApproval(status) {
  return !!status?.awaitingApproval;
}
