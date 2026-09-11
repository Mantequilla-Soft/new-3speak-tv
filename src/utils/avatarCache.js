import { useEffect, useState } from 'react';

// images.hive.blog/u/<name>/avatar resolves profile_image server-side, but it
// answers with `cache-control: public, max-age=86400`. So a browser that ever
// loaded your old picture keeps showing it for a DAY after you change it, no
// matter what the chain says — it reads as "my upload didn't work".
//
// Two layers fix that, both preferred over the proxy URL:
//   1. override — the exact image WE just uploaded, set the moment it's saved.
//   2. resolved — profile_image read straight out of the account's
//      posting_json_metadata. Those URLs are content addressed, so they are
//      immutable and can never go stale.
// The proxy stays as the fallback: it generates a default face for accounts
// with no picture at all.

const KEY = '3speak_avatar_override';
const RESOLVED_KEY = '3speak_avatar_resolved';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;   // the proxy is long past stale by then
// A fresh write needs a block or two before it reads back from the chain, so a
// reconcile in that window would throw away the URL we just set.
const RECONCILE_GRACE_MS = 2 * 60 * 1000;

let overrides = null;
let resolved = null;
const subscribers = new Set();

const clean = (u) => String(u || '').trim().replace(/^@/, '').toLowerCase();

function readStore(key) {
  try { return JSON.parse(localStorage.getItem(key) || '{}') || {}; }
  catch { return {}; }
}

function load() {
  if (!overrides) overrides = readStore(KEY);
  return overrides;
}

function loadResolved() {
  if (!resolved) resolved = readStore(RESOLVED_KEY);
  return resolved;
}

function notify() {
  subscribers.forEach((fn) => fn());
}

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(overrides || {})); } catch { /* ignore */ }
  notify();
}

/**
 * The standard Hive avatar URL. A falsy `size` keeps the bare `/avatar` form
 * (bigger default image), which some call sites render at 90px and up.
 */
export function hiveAvatarUrl(username, size = 'small') {
  const u = encodeURIComponent(clean(username));
  return size
    ? `https://images.hive.blog/u/${u}/avatar/${size}`
    : `https://images.hive.blog/u/${u}/avatar`;
}

/** Remember the image we just uploaded for this account. */
export function setAvatarOverride(username, url) {
  const u = clean(username);
  if (!u) return;
  load();
  if (!url) delete overrides[u];
  else overrides[u] = { url, ts: Date.now() };
  persist();
}

export function getAvatarOverride(username) {
  const u = clean(username);
  if (!u) return null;
  const entry = load()[u];
  if (!entry || !entry.url) return null;
  if (Date.now() - (entry.ts || 0) > MAX_AGE_MS) {
    delete overrides[u];
    persist();
    return null;
  }
  return entry.url;
}

export function clearAvatarOverride(username) {
  setAvatarOverride(username, null);
}

/**
 * Compare our override against what the chain now says. If they match, the write
 * landed and we keep serving the direct URL until the proxy catches up. If they
 * differ, the picture was changed somewhere else (or our write never landed), so
 * the override is wrong and goes away.
 */
export function reconcileAvatarOverride(username, chainUrl) {
  const u = clean(username);
  if (!u) return;
  const entry = load()[u];
  if (!entry) return;
  if (Date.now() - (entry.ts || 0) < RECONCILE_GRACE_MS) return;  // too soon to judge
  if (String(chainUrl || '') !== entry.url) {
    delete overrides[u];
    persist();
  }
}

/**
 * Remember the profile_image this account actually has on chain. Pass '' when
 * they have none, so we fall back to the proxy's generated default.
 */
export function setResolvedAvatar(username, url) {
  const u = clean(username);
  if (!u) return;
  loadResolved();
  const next = String(url || '');
  if (resolved[u] === next) return;              // nothing changed, don't re-render
  resolved[u] = next;
  try { localStorage.setItem(RESOLVED_KEY, JSON.stringify(resolved)); } catch { /* ignore */ }
  notify();
}

export function getResolvedAvatar(username) {
  const u = clean(username);
  if (!u) return null;
  return loadResolved()[u] || null;
}

/**
 * Avatar URL for a username: the picture we just uploaded, else the one the
 * chain says they have, else the (day-cached) hive proxy. Re-renders the caller
 * when any of that changes, so a new picture appears the moment it's saved.
 */
// Shown when there is no Hive account to read an avatar from. Someone
// incubating has no Hive profile at all, so `username` is null and the URL
// below would resolve to /u//avatar or /u/null/avatar and render broken.
export const NO_ACCOUNT_AVATAR = '/pwa-192x192.png';


// ---------------------------------------------------------------- lazy resolve
//
// The proxy fallback is FINE for most accounts and wrong for one important
// group: anyone whose picture is hosted by us. images.hive.blog cannot fetch
// images.3speak.tv, and rather than failing it serves its own grey face with a
// 200 — so a new user appears in every comment thread as a stranger's default
// avatar, with nothing in the console to suggest anything went wrong.
//
// Resolving needs the account's metadata, so it is done lazily and in BATCHES:
// asking per avatar would be one request per comment in a thread.
const pendingLookups = new Set();
const inFlight = new Set();
let lookupTimer = null;

async function flushLookups() {
  lookupTimer = null;
  const names = [...pendingLookups].filter((n) => !inFlight.has(n)).slice(0, 100);
  if (!names.length) return;
  names.forEach((n) => { pendingLookups.delete(n); inFlight.add(n); });
  try {
    const { getHiveUrl } = await import('./hiveNode');
    const res = await fetch(getHiveUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'condenser_api.get_accounts', params: [names],
      }),
    });
    const { result } = await res.json();
    for (const acct of result || []) {
      let image = '';
      for (const field of ['posting_json_metadata', 'json_metadata']) {
        try {
          const parsed = JSON.parse(acct[field] || '{}');
          if (parsed?.profile?.profile_image) { image = String(parsed.profile.profile_image).trim(); break; }
        } catch { /* hand-edited metadata; try the other field */ }
      }
      // Remembered even when EMPTY, so an account with no picture is not asked
      // about again on every render for the rest of the session.
      setResolvedAvatar(acct.name, image);
    }
  } catch {
    // Offline or a bad node: the proxy URL still renders something.
  } finally {
    names.forEach((n) => inFlight.delete(n));
  }
}

/** Ask for this account's real picture, once, soon, together with others. */
function queueLookup(username) {
  const u = clean(username);
  if (!u || inFlight.has(u)) return;
  loadResolved();
  if (u in resolved) return;        // already known, including "known to be blank"
  pendingLookups.add(u);
  if (!lookupTimer) lookupTimer = setTimeout(flushLookups, 60);
}

export function useAvatarUrl(username, size = 'small') {
  const [, bump] = useState(0);
  useEffect(() => {
    const fn = () => bump((n) => n + 1);
    subscribers.add(fn);
    return () => { subscribers.delete(fn); };
  }, []);
  // No account: return the 3Speak mark rather than building a Hive URL for a
  // name that does not exist. Fixes every caller at once — the nav trigger, the
  // profile dropdown and anything else that asks for "my avatar" while the
  // viewer has no Hive account.
  if (!username) return NO_ACCOUNT_AVATAR;
  const override = getAvatarOverride(username);
  if (override) return override;
  const known = getResolvedAvatar(username);
  if (known) return known;
  // Nothing known yet: show the proxy now and find out the truth in the
  // background. When the answer arrives, notify() re-renders every avatar for
  // that account at once.
  queueLookup(username);
  return hiveAvatarUrl(username, size);
}
