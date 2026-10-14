import { Suspense } from 'react';
import lazyRoute from '../../utils/lazyRoute';
import { useAppStore } from '../../lib/store';
import IncubatingProfile from './IncubatingProfile';

// lazyRoute, not lazy: reloads once onto a new build after a deploy (see lazyRoute.js).
const ProfilePage = lazyRoute(() => import('../../page/ProfilePage'), '../../page/ProfilePage');

/**
 * "My profile" for whoever is signed in.
 *
 * ProfilePage is built around a Hive account and keys everything off `user`,
 * which is null while incubating — so it rendered an empty channel with no
 * name, no videos and no explanation.
 *
 * Unlike the public profile route this needs no lookup: the store already knows
 * which kind of session this is, so the decision is free and there is no moment
 * where the wrong page is on screen.
 */
export default function OwnProfileRoute() {
  const user = useAppStore((s) => s.user);
  const incubationHandle = useAppStore((s) => s.incubationHandle);

  if (!user && incubationHandle) {
    return <IncubatingProfile handle={incubationHandle} own />;
  }
  return (
    <Suspense fallback={null}>
      <ProfilePage />
    </Suspense>
  );
}
