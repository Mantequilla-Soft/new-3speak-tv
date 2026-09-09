import { lazy, Suspense, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchIncubationProfile } from '../../lib/incubation';
import IncubatingProfile from './IncubatingProfile';

const UserProfilePage = lazy(() => import('../Userprofilepage/UserProfilePage'));

// A name is EITHER a Hive account or an incubating handle, never both: the
// handle claim refuses any name that already exists on chain, so there is no
// ambiguity to resolve and no precedence rule to get wrong.
//
// Cached for the session because a profile is often opened repeatedly (comment
// thread, back button, author badge) and the answer cannot change without a
// full page load anyway.
const cache = new Map();

/**
 * Sends a profile URL to the right page.
 *
 * Wraps UserProfilePage rather than modifying it: that component is 880 lines
 * with a dozen effects built around a Hive account existing, and teaching it to
 * render a user who has none would be a far larger change than this, with more
 * ways to break profiles that work today.
 *
 * The incubation lookup runs first and costs one cached request. Rendering the
 * Hive page optimistically would be faster for the common case but would flash
 * a "no such account" error at every visitor arriving from a comment thread,
 * which is precisely the audience this exists for.
 */
export default function ProfileRouter() {
  const { user } = useParams();
  const handle = String(user || '').toLowerCase();
  const [verdict, setVerdict] = useState(() => cache.get(handle) ?? null);

  useEffect(() => {
    if (cache.has(handle)) { setVerdict(cache.get(handle)); return undefined; }
    let alive = true;
    setVerdict(null);
    fetchIncubationProfile(handle)
      .then(p => {
        // 'graduated' goes to the normal Hive profile: they have a real account
        // now, and that page is richer than anything here.
        const v = p?.status === 'incubating' ? 'incubating' : 'hive';
        cache.set(handle, v);
        if (alive) setVerdict(v);
      })
      .catch(() => {
        // 404 is the ordinary answer for a real Hive user. Any other failure
        // also lands here, and defaulting to the Hive page is the safe side:
        // worst case someone sees the profile they asked for.
        cache.set(handle, 'hive');
        if (alive) setVerdict('hive');
      });
    return () => { alive = false; };
  }, [handle]);

  if (verdict === null) return null;          // one tick; the app already shows a shell
  if (verdict === 'incubating') return <IncubatingProfile handle={handle} />;
  return (
    <Suspense fallback={null}>
      <UserProfilePage />
    </Suspense>
  );
}
