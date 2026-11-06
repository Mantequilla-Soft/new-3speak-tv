import { CHECKER_URL } from './config';
import { fetchSessionVouch } from '../lib/sessionVouch';

/**
 * Browser side of push notifications.
 *
 * Three separate things have to line up, and they fail in different ways:
 *   1. the browser supports push at all (iOS only does inside an installed PWA)
 *   2. the user granted permission (a hard "denied" cannot be re-asked from JS)
 *   3. a PushSubscription exists and the server knows about it
 * `getPushState()` reports all three so the UI can say which one is missing
 * rather than showing a toggle that silently does nothing.
 */

// The fallback worker gets a scope of its own, deliberately.
//
// A service worker does NOT need to control any pages to receive push events —
// it only needs to exist. And registering it at '/' put it in a fight it always
// loses: vite-plugin-pwa registers ITS dev worker at '/' on every page load,
// and two different scripts cannot share a scope, so each load replaced the
// other. Every replacement drops the push subscription tied to the old
// registration, which is why a subscription would save correctly and then come
// back `410 Gone` from the push service minutes later.
const PUSH_SCOPE = '/push-scope/';

export const pushSupported = () => (
  typeof window !== 'undefined'
  && 'serviceWorker' in navigator
  && 'PushManager' in window
  && 'Notification' in window
);

// VAPID keys travel as base64url; PushManager wants raw bytes.
function urlBase64ToUint8Array(base64) {
  const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/**
 * The active service worker registration, or null.
 *
 * `navigator.serviceWorker.ready` NEVER RESOLVES when nothing is registered —
 * it does not reject, it simply hangs. Awaiting it unguarded is what made the
 * first version of this silently do nothing on the Vite dev server (which
 * serves no worker at all): permission was granted, then the promise sat there
 * forever with no error and no toast. So `ready` is raced against a short
 * timeout and only ever used as a late-registration fallback.
 */
/** A registration that can receive push, preferring our own dedicated one. */
async function registration() {
  if (!pushSupported()) return null;
  const dedicated = await navigator.serviceWorker.getRegistration(PUSH_SCOPE);
  if (dedicated) return dedicated;
  const root = await navigator.serviceWorker.getRegistration('/');
  // Only trust the app's root worker when it actually got somewhere: in dev on
  // Firefox it is an ES module the browser cannot evaluate, and a half-dead
  // registration is worse than none because subscribe() on it fails silently.
  if (root && root.active) return root;
  return null;
}

/**
 * A registration, registering one ourselves if the page hasn't.
 *
 * The app registers its worker on load, but that can leave nothing usable here:
 * an earlier build whose worker threw during evaluation leaves a dead
 * registration behind, and a tab opened before the fix never retries. Rather
 * than telling someone to hard-reload, try the registration ourselves.
 *
 * Two candidate URLs because the worker is served from different paths in a
 * build and under the Vite dev server, and this code cannot tell which it is
 * running in. The wrong one rejects harmlessly (dev serves the SPA shell at
 * /sw.js, which is not a worker) and we fall through to the other.
 */
async function ensureRegistration() {
  const existing = await registration();
  if (existing) return existing;
  const candidates = [
    // Production: the real, bundled worker already at the root scope.
    ['/sw.js', { scope: '/' }],
    // Anything else: our own classic, dependency-free worker, parked at a scope
    // nothing else claims. Works in every browser including Firefox, which has
    // no ES-module service worker support and so cannot run the dev worker.
    ['/push-sw.js', { scope: PUSH_SCOPE }],
  ];
  for (const [url, opts] of candidates) {
    try {
      const reg = await navigator.serviceWorker.register(url, opts);
      if (reg) {
        // A registration is not usable the instant it is created.
        if (!reg.active) await new Promise((r) => setTimeout(r, 700));
        return reg;
      }
    } catch {
      // Wrong path for this build, or the script failed to evaluate; try the next.
    }
  }
  return null;
}

export async function getPushState() {
  if (!pushSupported()) return { supported: false, permission: 'unsupported', subscribed: false };
  const reg = await ensureRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  // `worker` distinguishes "this browser can't" from "this build doesn't ship
  // one", which are very different problems with very different fixes.
  return { supported: true, worker: !!reg, permission: Notification.permission, subscribed: !!sub };
}

export async function enablePush(username) {
  if (!pushSupported()) throw new Error('This browser does not support notifications.');
  if (!username) throw new Error('Log in first so we know whose creators to follow.');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications are blocked for this site.');

  const keyRes = await fetch(`${CHECKER_URL}/push/vapid-key`);
  if (!keyRes.ok) throw new Error('Notifications are not switched on yet.');
  const { publicKey } = await keyRes.json();

  const reg = await ensureRegistration();
  if (!reg) {
    throw new Error(
      'Could not start the background worker notifications need. A reload usually fixes it.',
    );
  }

  // Reuse an existing subscription rather than making a second one: a browser
  // hands out one per registration, and re-subscribing with a different key
  // throws instead of replacing it.
  const subscription = (await reg.pushManager.getSubscription())
    || (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }));

  const res = await fetch(`${CHECKER_URL}/push/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, subscription: subscription.toJSON() }),
  });
  if (!res.ok) throw new Error('Could not save your notification settings.');
  return true;
}

/**
 * Re-tell the server about a subscription the browser already has.
 *
 * The two sides can drift apart in one direction that the UI cannot show: the
 * sender DELETES rows the push service reports as gone (404/410), which is
 * correct — but the browser may still hold a perfectly good subscription
 * afterwards, e.g. after the worker was unregistered and re-registered. The
 * toggle reads local state, so it says "On" while the server has no way to
 * reach you, and there is nothing for the user to click to fix it.
 *
 * Cheap to just re-assert on load: the endpoint is an upsert keyed by
 * (username, endpoint), so a row that already exists is only touched.
 */
export async function syncPushSubscription(username) {
  if (!pushSupported() || !username) return false;
  const reg = await registration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (!sub) return false;
  try {
    await fetch(`${CHECKER_URL}/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, subscription: sub.toJSON() }),
    });
    return true;
  } catch {
    return false;
  }
}

export async function disablePush(username) {
  const reg = await registration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (sub) {
    // Tell the server before dropping it locally — once unsubscribed we no
    // longer have the endpoint to tell it about, and the row would linger.
    await fetch(`${CHECKER_URL}/push/unsubscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, endpoint: sub.endpoint }),
    }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  return true;
}

/** What this person wants to be told about. Defaults to everything on. */
export async function getPushPrefs(username) {
  if (!username) return { kinds: [], prefs: {} };
  try {
    const res = await fetch(`${CHECKER_URL}/push/prefs?username=${encodeURIComponent(username)}`);
    if (!res.ok) return { kinds: [], prefs: {} };
    const data = await res.json();
    return { kinds: data.kinds || [], prefs: data.prefs || {} };
  } catch {
    return { kinds: [], prefs: {} };
  }
}

/**
 * 🚧 TEMPORARY, remove once the checker runs with PUSH_REQUIRE_PROOF=true.
 * While that flag is off the checker still saves choices sent without proof (and
 * logs them), so a vouch we could not get must not stop anyone from saving: the
 * save goes out without one, with a console warning, exactly as before. Once the
 * flag is on, set this to false (or delete it and its branch in setPushPrefs).
 */
export const PUSH_PREFS_UNPROVEN_FALLBACK = true;

// The checker takes a vouch for a day; reuse one for a little less.
const PUSH_VOUCH_REUSE_MS = 23 * 60 * 60 * 1000;
const pushVouches = new Map(); // account -> { user, signature, timestamp }

// The same cleaning as the checker's cleanUser, so the vouch names the account it reads.
const pushUser = (u) => String(u || '').trim().toLowerCase().replace(/^@/, '');

async function pushVouch(user, { fresh = false } = {}) {
  const hit = pushVouches.get(user);
  if (!fresh && hit && Date.now() - hit.timestamp < PUSH_VOUCH_REUSE_MS) return hit;
  pushVouches.delete(user);
  const v = await fetchSessionVouch('push', user, { named: true });
  if (v) pushVouches.set(user, v);
  return v;
}

/** Thrown when the checker wants proof of who is saving and we have none. */
const notConfirmed = () => Object.assign(
  new Error('Could not confirm it is you. Log out and back in, then try again.'),
  { code: 'not_confirmed' },
);

/**
 * Save what this person wants to be told about. The checker wants proof that
 * the request comes from that account: our API's session vouch (lib/sessionVouch.js),
 * no wallet prompt for any login type.
 */
export async function setPushPrefs(username, prefs) {
  const user = pushUser(username);
  const send = async (v) => fetch(`${CHECKER_URL}/push/prefs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, prefs, ...(v ? { signature: v.signature, timestamp: v.timestamp } : {}) }),
  });

  const cached = pushVouches.has(user);
  let v = await pushVouch(user);
  if (!v) {
    if (!PUSH_PREFS_UNPROVEN_FALLBACK) throw notConfirmed();
    console.warn(`[push] no session vouch for @${user}; saving without one while the checker still accepts that (PUSH_REQUIRE_PROOF off)`);
  }
  let res = await send(v);
  // A day-old vouch the checker no longer takes: get a fresh one and try once more.
  if (res.status === 401 && v && cached) {
    v = await pushVouch(user, { fresh: true });
    if (v) res = await send(v);
  }
  if (res.status === 401) {
    pushVouches.delete(user);
    throw notConfirmed();
  }
  if (!res.ok) throw new Error('Could not save your notification choices.');
  const data = await res.json();
  return data.prefs || {};
}
