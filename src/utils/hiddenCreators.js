/**
 * Hide comments authored by HIDDEN creators (contentcreators.hidden on the checker).
 *
 * Comments are fetched straight from Hive, not the checker, so — exactly like the
 * low-reputation filter in utils/reputation.js — the hide has to happen client-side.
 * This mirrors that file's shape: collect every author (incl. nested replies), resolve
 * them in one call, then tag each node with `isHidden` so each render site can
 * short-circuit next to its existing `isLowReputation` guard.
 *
 * Resolution goes through a single bulk endpoint (POST /check-hidden) rather than
 * dumping the whole ban list to the client — the client only learns the status of the
 * authors actually on the page. Cached per-username (5 min); fail-open on any error
 * (a checker hiccup must never blank out a comment thread).
 *
 * The same answer also carries `muted`: authors on the checker's global comment
 * mutelist (well-known bots, checker utils/commentMutes.js). Unlike a hidden or
 * low-score comment, a muted one is not collapsed behind a "Show" bar: it is
 * REMOVED, with the replies under it, and not counted (dropMuted). Comments only;
 * a muted account's own posts are untouched. The viewer's own comments are never
 * muted for themselves.
 */
import { CHECKER_URL } from './config';

const cache = new Map(); // username(lc) -> { hidden: bool, muted: bool, at: ms }
const CACHE_MS = 5 * 60 * 1000;

const nameOf = (item) => (typeof item?.author === 'string' ? item.author : item?.author?.username) || '';

/**
 * Given a list of usernames, return `{ hidden, muted }`: Sets (lowercased) of those
 * that are hidden creators and those on the comment mutelist. Only the un-cached
 * ones hit the network, in one request.
 */
export async function batchCheckFlags(usernames) {
  const uniq = [...new Set((usernames || [])
    .map((u) => (typeof u === 'string' ? u : u?.username))
    .filter(Boolean)
    .map((u) => u.toLowerCase()))];

  const now = Date.now();
  const need = uniq.filter((u) => {
    const c = cache.get(u);
    return !(c && now - c.at < CACHE_MS);
  });

  if (need.length > 0) {
    try {
      const res = await fetch(`${CHECKER_URL}/check-hidden`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernames: need }),
      });
      const data = await res.json().catch(() => ({}));
      const listed = (key) => new Set((Array.isArray(data?.[key]) ? data[key] : []).map((u) => String(u).toLowerCase()));
      const hiddenSet = listed('hidden');
      const mutedSet = listed('muted'); // absent on an older checker: nobody muted
      // Cache both hits and misses so a page of non-hidden authors isn't re-checked.
      need.forEach((u) => cache.set(u, { hidden: hiddenSet.has(u), muted: mutedSet.has(u), at: now }));
    } catch {
      need.forEach((u) => cache.set(u, { hidden: false, muted: false, at: now })); // fail-open
    }
  }

  const hidden = new Set();
  const muted = new Set();
  uniq.forEach((u) => {
    const c = cache.get(u);
    if (c?.hidden) hidden.add(u);
    if (c?.muted) muted.add(u);
  });
  return { hidden, muted };
}

/** The hidden creators among `usernames` (lowercased Set). */
export async function batchCheckHidden(usernames) {
  return (await batchCheckFlags(usernames)).hidden;
}

// Collect every author across a comment tree (both {author:'x'} and
// {author:{username:'x'}}, and both children/replies nesting) — same shape as
// utils/reputation.js so it drops onto the same data.
function collectAuthors(content) {
  const authors = [];
  const walk = (items) => {
    for (const item of items || []) {
      const name = typeof item.author === 'string' ? item.author : item.author?.username;
      if (name) authors.push(name);
      const nested = item.children || item.replies;
      if (nested && nested.length) walk(nested);
    }
  };
  walk(content);
  return authors;
}

/**
 * Tag each comment (recursively) with `isHidden` for authors that are hidden
 * creators, and `isMuted` for authors on the comment mutelist (never the viewer's
 * own comments: pass `{ viewer }`). Does not remove anything: render sites collapse
 * `isHidden` nodes like `isLowReputation` ones, and `dropMuted` removes muted ones.
 */
export async function markByHidden(content, { viewer } = {}) {
  if (!content || content.length === 0) return content || [];
  const { hidden: hiddenSet, muted: mutedSet } = await batchCheckFlags(collectAuthors(content));
  if (hiddenSet.size === 0 && mutedSet.size === 0) return content; // nothing on this page: untouched
  const me = String(viewer || '').toLowerCase();

  const mark = (items) => items.map((item) => {
    const name = nameOf(item).toLowerCase();
    const marked = { ...item, isHidden: hiddenSet.has(name) };
    if (mutedSet.has(name) && name !== me) marked.isMuted = true;
    const nested = item.children || item.replies;
    if (nested && nested.length) {
      if (item.children) marked.children = mark(nested);
      else if (item.replies) marked.replies = mark(nested);
    }
    return marked;
  });

  return mark(content);
}

/**
 * Remove muted comments (`isMuted`, see markByHidden) and everything under them,
 * at every depth, for both `children` and `replies` nesting. Returns new arrays;
 * the input is not changed.
 */
export function dropMuted(content) {
  if (!Array.isArray(content)) return content || [];
  const drop = (items) => items.filter((item) => item && !item.isMuted).map((item) => {
    let out = item;
    if (Array.isArray(item.children) && item.children.length) out = { ...out, children: drop(item.children) };
    if (Array.isArray(item.replies) && item.replies.length) out = { ...out, replies: drop(item.replies) };
    return out;
  });
  return drop(content);
}

/** markByHidden, then dropMuted: the comment tree as 3Speak shows it. */
export async function markAndDropMuted(content, opts) {
  return dropMuted(await markByHidden(content, opts));
}

/** Is a single username a hidden creator? (used by the profile gate) */
export async function isCreatorHidden(username) {
  if (!username) return false;
  const set = await batchCheckHidden([username]);
  return set.has(String(username).toLowerCase());
}
