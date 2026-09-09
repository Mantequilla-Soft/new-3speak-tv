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

// The 3Speak mark, used as the default avatar for anyone without a Hive
// account. Served from public/, so it is one cached request for every such user
// rather than a distinct image each.
//
// The square PWA icon deliberately, NOT src/assets/image/3S_logo.svg — that one
// is the wide wordmark (509x130) and would be squashed or cropped to nonsense
// in a round avatar.
const DEFAULT_INCUBATION_AVATAR = '/pwa-192x192.png';

/**
 * Avatar for someone with no Hive account.
 *
 * They have no Hive profile to read one from, and images.hive.blog answers an
 * unknown name with a 500 rather than a placeholder — so the usual
 * `/u/<name>/avatar/small` URL renders as a broken image for every one of them.
 *
 * Everyone shares the 3Speak mark, which is a deliberate trade: it reads as
 * "new here, on 3Speak" at a glance, at the cost of not telling two incubating
 * users apart by picture alone. The handle is always shown beside it, so the
 * name still distinguishes them.
 *
 * `handle` is accepted but unused, so call sites need not change if this ever
 * goes back to being per-user.
 */
// eslint-disable-next-line no-unused-vars
export function handleAvatar(handle) {
  return DEFAULT_INCUBATION_AVATAR;
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

export async function fetchIncubationProfile(handle, viewer = null) {
  // `viewer` answers "do I already follow them", so the button does not come
  // back saying Follow to somebody who does.
  const qs = viewer ? `?viewer=${encodeURIComponent(viewer)}` : '';
  return json(await fetch(`${CHECKER_URL}/incubation/profile/${encodeURIComponent(handle)}${qs}`));
}

/** Follow (or unfollow) an incubating creator. Works for Hive users too. */
export const followIncubationUser = (handle, following) =>
  write('/social/follow', 'PUT', { following: handle, state: following ? 'following' : 'unfollowed' });

/**
 * One off-chain post, for the watch page.
 *
 * 404 means no such post; 409 means it has since been published to Hive and
 * should be read from there instead. Both are "not ours" to the caller.
 */
export async function fetchIncubationPost(handle, permlink) {
  const res = await fetch(
    `${CHECKER_URL}/incubation/post/${encodeURIComponent(handle)}/${encodeURIComponent(permlink)}`
  );
  if (res.status === 404 || res.status === 409) return null;
  return json(res);
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
/**
 * Every off-chain reply under ANY of these parents, in one request.
 *
 * The single-parent call below only answers for the post itself, which is the
 * first level of a thread. A reply to a COMMENT hangs off that comment's
 * permlink, so nothing asked for it and its own author could not see it.
 */
export async function fetchIncubationRepliesFor(permlinks) {
  return json(await fetch(`${CHECKER_URL}/incubation/replies/for`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ permlinks }),
  }));
}

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
/**
 * Store a post off-chain.
 *
 * `payload.permlink` is optional but the upload path supplies it, so the stored
 * post carries the same permlink the on-chain one would have — which is what
 * the player resolves a video's source by.
 */
export const postIncubationContent = (payload) => write('/content', 'POST', payload);
export const fetchMyIncubationContent = () => write('/content/mine', 'GET');
/**
 * How many people have voted on an off-chain post, and whether the viewer has.
 *
 * These are stored votes, not Hive votes: they move no rewards, earn no
 * curation and are never replayed to the chain. Everything downstream should
 * treat the number as a count of people, never as something with a payout.
 */
export async function fetchIncubationLikes(author, permlink, viewer) {
  const qs = new URLSearchParams({ author, permlink });
  if (viewer) qs.set('viewer', viewer);
  return json(await fetch(`${CHECKER_URL}/incubation/likes?${qs}`));
}

export const voteIncubation = (author, permlink, weight) =>
  write('/social/vote', 'PUT', { author, permlink, weight });
export const followIncubation = (following, state) =>
  write('/social/follow', 'PUT', { following, state });
export const saveIncubationProfile = (profile, interests) =>
  write('/social/profile', 'PUT', { profile, interests });
export const fetchMyIncubationProfile = () => write('/social/profile/mine', 'GET');

/**
 * How far this person is towards being reviewed for a real Hive account.
 *
 * The bar comes back WITH the counts rather than being hardcoded here, so the
 * progress someone is shown is the progress that actually counts.
 */
export const fetchIncubationProgress = () => write('/progress', 'GET');

/**
 * Who reacted to this user's content.
 *
 * Hive's own notifications come from `bridge.account_notifications`, which
 * needs an account. These users have none, so this is the only thing that ever
 * tells them somebody replied.
 */
export const fetchIncubationNotifications = () => write('/notifications', 'GET');
export const markIncubationNotificationsRead = () => write('/notifications/read', 'POST');
export const fetchMyIncubationFollows = () => write('/social/follows/mine', 'GET');

/**
 * Subscribe to a community without a Hive account.
 *
 * Stored off-chain and replayed as the ordinary `community` custom_json at
 * graduation, so the communities they joined while getting started are already
 * theirs when the account arrives.
 */
export const subscribeIncubation = (community, subscribed) =>
  write('/social/subscribe', 'PUT', { community, state: subscribed ? 'subscribed' : 'unsubscribed' });
export const fetchMyIncubationSubscriptions = () => write('/social/subscriptions/mine', 'GET');

/**
 * People you follow here who now have a real Hive account.
 *
 * A follow of a handle could never reach the chain, so when that person
 * graduates the follow is stranded. This is how the follower finds out, with
 * the name to follow for real.
 */
export const fetchGraduatedFollows = () => write('/social/graduated-follows', 'GET');
export const ackGraduatedFollow = (handle) => write('/social/graduated-follows/ack', 'POST', { handle });

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

// --- backfill: publishing an incubation backlog to Hive after graduation ----
//
// The user has a Hive account now, so every stored row finally has an author.
// The server hands back FULLY BUILT Hive operations (see the incubation
// service's lib/ops.js): publishing is a replay, not a translation.

export const fetchBackfillItems = () => write('/backfill/items', 'GET');
export const fetchBackfillSummary = () => write('/backfill/summary', 'GET');

/**
 * Move videos uploaded while incubating onto the new Hive account.
 *
 * Uploads were real assets all along; only the Hive post was deferred. They
 * were stored under the handle, so without this the user's own videos stop
 * appearing under their name the moment they graduate.
 *
 * Idempotent and cheap, but pointless to repeat, so callers guard it to once
 * per browser session.
 */
export const claimIncubationAssets = () => write('/backfill/claim-assets', 'POST', {});

const CLAIMED_KEY = 'incubation_assets_claimed';
export async function claimAssetsOnce() {
  try { if (sessionStorage.getItem(CLAIMED_KEY)) return null; } catch { /* ignore */ }
  const res = await claimIncubationAssets();
  try { sessionStorage.setItem(CLAIMED_KEY, '1'); } catch { /* ignore */ }
  return res;
}
const markBackfilled = (type, id, permlink) =>
  write('/backfill/mark', 'POST', { type, id, permlink });

// Chain-enforced spacing. These are not our policy, they are consensus rules,
// and hitting them shows up as an opaque broadcast error — so the UI paces
// itself instead of letting the user discover them one failure at a time.
export const ROOT_POST_INTERVAL_MS = 5 * 60 * 1000;   // HIVE_MIN_ROOT_COMMENT_INTERVAL
const REPLY_INTERVAL_MS = 3 * 1000;                    // HIVE_MIN_REPLY_INTERVAL
const LAST_ROOT_KEY = 'backfill_last_root_post_at';

export function lastRootPostAt() {
  try { return Number(localStorage.getItem(LAST_ROOT_KEY)) || 0; } catch { return 0; }
}
export function rootPostWaitMs() {
  return Math.max(0, ROOT_POST_INTERVAL_MS - (Date.now() - lastRootPostAt()));
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Publish selected items, one at a time, oldest first.
 *
 * Sequential and stop-on-failure by design. A root post can only be broadcast
 * once every five minutes per account, and a fresh account's resource credits
 * allow only a couple a day, so firing a whole backlog at once would fail most
 * of the way through and leave the user unable to tell what actually landed.
 *
 * The broadcast goes through /api/broadcast — the same endpoint the normal
 * posting UI uses, with the same validation and posting-authority check. This
 * adds no capability; it just supplies the operation.
 *
 * `onProgress(item, status, detail)` is called for every item so the table can
 * update live rather than freezing until the whole run finishes.
 */
export async function publishBackfill(items, onProgress = () => {}) {
  const done = [];
  for (const item of items) {
    if (item.isRootPost) {
      const wait = rootPostWaitMs();
      if (wait > 0) {
        onProgress(item, 'waiting', wait);
        break;   // stop, do not silently fail the rest
      }
    }
    onProgress(item, 'publishing');
    try {
      const res = await fetch('/api/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ operations: [item.op] })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Publish failed (${res.status})`);

      const permlink = item.op?.[1]?.permlink || null;
      await markBackfilled(item.type, item.id, permlink);
      if (item.isRootPost) {
        try { localStorage.setItem(LAST_ROOT_KEY, String(Date.now())); } catch { /* ignore */ }
      }
      done.push(item.id);
      onProgress(item, 'done');
      // Replies and custom_json have their own 3-second floor.
      if (!item.isRootPost) await sleep(REPLY_INTERVAL_MS);
    } catch (err) {
      onProgress(item, 'error', err.message);
      break;   // one failure usually means the next will fail the same way
    }
  }
  return done;
}
