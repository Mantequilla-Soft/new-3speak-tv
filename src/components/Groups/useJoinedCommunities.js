import { useEffect, useState } from 'react';
import { getSubscriptions } from '../../hive-api/hiveApi';
import { useAppStore } from '../../lib/store';

/**
 * The communities the signed-in person has joined, as a Set of hive-ids.
 *
 * Hive's own subscriptions for a Hive account; the off-chain ones for an
 * incubating user, who has no Hive account yet. Read once per person by the
 * Groups page, so the "Joined" tab can show its count before it is opened, and
 * handed to the directory, which pins them to the top of the list.
 *
 * Returns [mine, setMine]: setMine lets a Join button add to the set without a
 * refetch (hivemind takes a few seconds to serve a new subscription back).
 */
export default function useJoinedCommunities({ enabled = true } = {}) {
  const user = useAppStore((st) => st.user);
  const incubationHandle = useAppStore((st) => st.incubationHandle);
  const [mine, setMine] = useState(() => new Set());

  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    if (user) {
      getSubscriptions(user)
        // [[name, title, role, role_title], ...]
        .then((rows) => { if (alive) setMine(new Set((rows || []).map((r) => r[0]))); })
        .catch(() => { /* the list is still useful unsorted */ });
    } else if (incubationHandle) {
      import('../../lib/incubation')
        .then((m) => m.fetchMyIncubationSubscriptions())
        .then((d) => { if (alive) setMine(new Set((d.items || []).map((i) => i.community))); })
        .catch(() => { /* same */ });
    } else {
      setMine(new Set());
    }
    return () => { alive = false; };
  }, [user, incubationHandle, enabled]);

  return [mine, setMine];
}
