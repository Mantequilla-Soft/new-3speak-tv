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

const INCUBATION_URL =
  import.meta.env.VITE_INCUBATION_URL || 'https://incubation.3speak.tv';

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

// --- writes, via the incubation service -------------------------------------
//
// Every write carries the ButrAuth access token. The service verifies it and
// REFUSES anyone who already has a Hive account (409), because their content
// belongs on chain, not in a shadow database.

async function write(path, method, body, accessToken) {
  if (!accessToken) throw new Error('Not signed in');
  return json(await fetch(`${INCUBATION_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  }));
}

export const postIncubationContent = (payload, token) => write('/content', 'POST', payload, token);
export const voteIncubation = (author, permlink, weight, token) =>
  write('/social/vote', 'PUT', { author, permlink, weight }, token);
export const followIncubation = (following, state, token) =>
  write('/social/follow', 'PUT', { following, state }, token);
export const saveIncubationProfile = (profile, interests, token) =>
  write('/social/profile', 'PUT', { profile, interests }, token);
export const fetchGraduationPlan = (token) => write('/public/graduation/plan', 'GET', undefined, token);
