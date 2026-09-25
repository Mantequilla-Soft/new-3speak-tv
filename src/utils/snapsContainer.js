import axios from 'axios';
import { getHiveUrl } from './hiveNode';
import { HIVE_API_NODES } from './config';

// Resolving the latest @peak.snaps container — the parent every snap-style
// post (video short, audio snap, text snap, OpenPod announcement) replies to.
//
// Why this is more than a one-line RPC call: peak.snaps publishes a fresh
// container every ~8-13h and the previous one keeps accepting replies, so
// there is never a window with no container to reply to. When this lookup
// fails it is therefore essentially never "bad timing" — it is the RPC node.
// Two ways that happens:
//
//   1. The session-pinned node has no hivemind. `bridge.*` and
//      `get_discussions_by_author_before_date` are hivemind calls; a plain
//      hived node answers the node picker's health probe just fine and then
//      errors on every one of these. Because the pick is sticky for the whole
//      session, that user cannot post a snap until they reload.
//   2. An ordinary timeout / rate-limit / node hiccup.
//
// So we walk every candidate node, try both the hivemind APIs on each, and
// keep re-trying rounds until a deadline before admitting defeat.

const SNAP_ACCOUNT = 'peak.snaps';

/* Accounts whose top-level posts are CONTAINERS: a bucket other people reply into,
 * not something anybody wrote to be read. @peak.snaps rotates one every ~8-13h;
 * Ecency's waves work the same way. Listed rather than pattern-matched on the
 * permlink, because the permlink conventions differ per app and the account does not.
 *
 * Extend this when another snap-style host appears. */
const CONTAINER_ACCOUNTS = new Set([SNAP_ACCOUNT, 'ecency.waves']);

/**
 * Is this post a container rather than content?
 *
 * Used to keep containers out of anything that presents a conversation to a viewer.
 * A snap replying to a container is the start of that conversation; the container
 * above it is plumbing, and showing it turns a two-step reaction chain into a
 * three-step one whose first step nobody wrote.
 */
export function isSnapsContainer(post) {
  if (!post) return false;
  return CONTAINER_ACCOUNTS.has(String(post.author || '').trim().toLowerCase());
}
const PER_CALL_TIMEOUT_MS = 6000;
const DEFAULT_DEADLINE_MS = 45000;
const ROUND_BACKOFF_MS = [500, 1500, 3000, 5000];

// Containers rotate on the order of hours, so a short memo is safe and makes
// a second post in the same session instant. Replying to a container that has
// just been superseded is harmless — it still accepts the comment.
const CACHE_TTL_MS = 5 * 60 * 1000;
let cached = null; // { author, permlink, at }

function nodeOrder() {
  const pinned = getHiveUrl();
  const rest = (HIVE_API_NODES || []).filter((n) => n && n !== pinned);
  return [...new Set([pinned, ...rest].filter(Boolean))];
}

function normalize(post) {
  if (!post || !post.permlink) return null;
  // Guard against picking up a reply if the API ever returns one.
  if (typeof post.depth === 'number' && post.depth !== 0) return null;
  return { author: post.author || SNAP_ACCOUNT, permlink: post.permlink };
}

async function rpc(node, body, signal) {
  const { data } = await axios.post(node, { jsonrpc: '2.0', id: 1, ...body }, {
    timeout: PER_CALL_TIMEOUT_MS,
    signal,
  });
  // Hive RPC reports node-side failures in the body with HTTP 200 — a node
  // without hivemind answers "Unable to parse endpoint data." this way.
  if (data?.error) {
    throw new Error(data.error.message || data.error.error || 'RPC error');
  }
  return data?.result;
}

async function viaBridge(node, signal) {
  const result = await rpc(node, {
    method: 'bridge.get_account_posts',
    params: { sort: 'posts', account: SNAP_ACCOUNT, start_author: '', start_permlink: '', limit: 1 },
  }, signal);
  return normalize(Array.isArray(result) ? result[0] : null);
}

async function viaCondenser(node, signal) {
  const before = new Date().toISOString().split('.')[0];
  const result = await rpc(node, {
    method: 'condenser_api.get_discussions_by_author_before_date',
    params: [SNAP_ACCOUNT, '', before, 1],
  }, signal);
  return normalize(Array.isArray(result) ? result[0] : null);
}

const STRATEGIES = [viaBridge, viaCondenser];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Resolve the newest @peak.snaps container post, trying every configured Hive
 * node and both hivemind APIs, repeatedly, until `deadlineMs` elapses.
 *
 * @param {object}   [opts]
 * @param {function} [opts.onProgress] called with a human-readable status line
 * @param {number}   [opts.deadlineMs] give up after this long (default 45s)
 * @param {AbortSignal} [opts.signal]
 * @param {boolean}  [opts.force]      ignore the short-lived cache
 * @returns {Promise<{author: string, permlink: string}>}
 */
export async function resolveSnapsContainer({
  onProgress,
  deadlineMs = DEFAULT_DEADLINE_MS,
  signal,
  force = false,
} = {}) {
  const say = (msg) => { try { onProgress?.(msg); } catch { /* non-fatal */ } };

  if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { author: cached.author, permlink: cached.permlink };
  }

  const startedAt = Date.now();
  const nodes = nodeOrder();
  let lastError = null;
  let round = 0;

  while (Date.now() - startedAt < deadlineMs) {
    if (signal?.aborted) throw new Error('Cancelled');
    if (round > 0) {
      const wait = ROUND_BACKOFF_MS[Math.min(round - 1, ROUND_BACKOFF_MS.length - 1)];
      say(`Snaps container not found yet — retrying (attempt ${round + 1})...`);
      await sleep(wait);
    }

    for (const node of nodes) {
      for (const strategy of STRATEGIES) {
        if (signal?.aborted) throw new Error('Cancelled');
        if (Date.now() - startedAt >= deadlineMs) break;
        try {
          const found = await strategy(node, signal);
          if (found) {
            cached = { ...found, at: Date.now() };
            return found;
          }
          lastError = new Error(`${node} returned no @${SNAP_ACCOUNT} posts`);
        } catch (err) {
          lastError = new Error(`${node}: ${err?.message || err}`);
        }
      }
    }
    round += 1;
  }

  const detail = lastError?.message ? ` (last error — ${lastError.message})` : '';
  throw new Error(
    `Could not reach any Hive node to find the snaps container${detail}. ` +
    'Please check your connection and try again.'
  );
}

/** Drop the memo — used after a successful post so the next one re-checks. */
export function clearSnapsContainerCache() {
  cached = null;
}
