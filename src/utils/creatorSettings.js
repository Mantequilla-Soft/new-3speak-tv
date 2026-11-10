import axios from 'axios';
import { useEffect, useState } from 'react';
import { CHECKER_URL } from './config';

// Reads a creator's moderation settings from the checker.
// GET /check/:username -> { canPost, banned, canUpload, reason }
// Returns null on any error / unreachable so callers fail OPEN (never block a
// user because the check itself failed).
export async function getCreatorSettings(username) {
  if (!username) return null;
  try {
    const { data } = await axios.get(
      `${CHECKER_URL.replace(/\/$/, '')}/check/${encodeURIComponent(username)}`,
      { timeout: 8000 },
    );
    return data || null;
  } catch {
    return null;
  }
}

// Explicit-only checks: only treat as blocked when the flag is literally set.
// Users not in the contentcreators collection (banned/canUpload undefined) are
// NOT blocked.
export const isBanned = (s) => s?.banned === true;
export const isUploadBlocked = (s) => s?.canUpload === false;

// The contentcreators row a signed-in person is looked up by. A Hive account
// uses its name; a warm-up (incubating) user has none, so their row is keyed
// `~<handle>`. `~` can't appear in a Hive name, so a warm-up row can never
// match (or be matched by) a real Hive account, even one that later takes the
// same name. Same key the announcement popup uses.
export function creatorKey(user, incubationHandle) {
  if (user) return user;
  if (incubationHandle) return `~${String(incubationHandle).toLowerCase()}`;
  return null;
}

// One request per key for every component asking at once (nav, block banner,
// community page), reused for a minute.
const SHARED_TTL_MS = 60 * 1000;
const shared = new Map();
function sharedCreatorSettings(key) {
  const hit = shared.get(key);
  if (hit && Date.now() - hit.at < SHARED_TTL_MS) return hit.promise;
  const promise = getCreatorSettings(key);
  shared.set(key, { promise, at: Date.now() });
  // A failed check (null) is not kept, so the next mount asks again.
  promise.then((s) => { if (s === null && shared.get(key)?.promise === promise) shared.delete(key); });
  return promise;
}
export function clearCreatorSettingsCache() { shared.clear(); }

// Settings for one key, refetched when the key changes. `null` until it has
// loaded, and stays null when the check fails (callers fail OPEN on null).
export function useCreatorSettings(key) {
  const [state, setState] = useState({ key: null, settings: null });
  useEffect(() => {
    if (!key) return undefined;
    let cancelled = false;
    sharedCreatorSettings(key).then((settings) => {
      if (!cancelled) setState({ key, settings });
    });
    return () => { cancelled = true; };
  }, [key]);
  return state.key === key ? state.settings : null;
}
