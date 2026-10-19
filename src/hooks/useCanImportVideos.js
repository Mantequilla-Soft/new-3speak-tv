import { useEffect, useState } from 'react';
import { getLinks } from '../utils/socialVerifier';
import { IMPORT_MODE_PLATFORMS } from '../lib/youtubeImport';

// ▶️ Can this user import videos? Only with a verified link to a platform the
// importer reads (linked on the profile, checked by checker.3speak.tv). The
// entry buttons stay hidden until that is known, and on any error.
//
// Reads the checker's PUBLIC links list, not /api/yt-import/status: that one
// needs a proven session, and re-minting a lapsed Keychain session would pop a
// signing prompt just for opening a menu.

const IMPORTABLE = new Set(Object.values(IMPORT_MODE_PLATFORMS).flat());
const cache = new Map();
const inflight = new Map();
const CACHE_TTL_MS = 60 * 1000;

async function linkedPlatforms(username) {
  const key = username.toLowerCase();
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  if (inflight.has(key)) return inflight.get(key);

  const promise = getLinks(key)
    .then((links) => links
      .filter((l) => l.verified !== false && IMPORTABLE.has(l.platform))
      .map((l) => l.platform))
    .catch(() => [])
    .then((value) => {
      cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
      inflight.delete(key);
      return value;
    });
  inflight.set(key, promise);
  return promise;
}

/** true once `user` has a verified link the importer can use (for `mode`, if given). */
export default function useCanImportVideos(user, mode) {
  const [platforms, setPlatforms] = useState([]);
  useEffect(() => {
    if (!user) { setPlatforms([]); return undefined; }
    let alive = true;
    linkedPlatforms(user).then((p) => { if (alive) setPlatforms(p); });
    return () => { alive = false; };
  }, [user]);
  const fits = mode ? IMPORT_MODE_PLATFORMS[mode] || [] : [...IMPORTABLE];
  return platforms.some((p) => fits.includes(p));
}
