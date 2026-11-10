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

// Settings for one key, refetched when the key changes. `null` until it has
// loaded, and stays null when the check fails (callers fail OPEN on null).
export function useCreatorSettings(key) {
  const [state, setState] = useState({ key: null, settings: null });
  useEffect(() => {
    if (!key) return undefined;
    let cancelled = false;
    getCreatorSettings(key).then((settings) => {
      if (!cancelled) setState({ key, settings });
    });
    return () => { cancelled = true; };
  }, [key]);
  return state.key === key ? state.settings : null;
}
