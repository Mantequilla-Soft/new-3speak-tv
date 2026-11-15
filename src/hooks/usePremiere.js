import { useCallback, useEffect, useReducer } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchPremiere, premiereState, sharedOffset } from '../lib/premieres';

/**
 * The premiere at this watch address (lib/premieres.js), if the creator listed
 * it as one. `state` flips by itself at the start and at the end of the chat
 * window: a timer to the next edge re-renders the page then, so nothing ticks
 * every second here (the countdown ticks in its own component).
 *
 * `serverNow()` is the checker's clock, so the shared offset is the same for
 * every viewer whatever their own clock says.
 */
export default function usePremiere(owner, permlink, { enabled = true } = {}) {
  const on = enabled && !!owner && owner !== 'unknown' && !!permlink;
  const { data, refetch, isLoading } = useQuery({
    queryKey: ['premiere', owner, permlink],
    enabled: on,
    staleTime: 30 * 1000,
    retry: 1,
    queryFn: () => fetchPremiere(owner, permlink),
    // A reschedule or a cancel shows up while the countdown is open.
    refetchInterval: (q) => (q.state.data?.premiere ? 60 * 1000 : false),
  });
  const premiere = on ? data?.premiere || null : null;
  const skew = data?.skew || 0;
  const serverNow = useCallback(() => Date.now() + skew, [skew]);

  const [, bump] = useReducer((n) => n + 1, 0);
  const now = serverNow();
  const state = premiereState(premiere, now);
  useEffect(() => {
    if (!premiere || state === 'ended') return undefined;
    const edge = state === 'soon' ? Date.parse(premiere.startAt) : Date.parse(premiere.chatUntil);
    const wait = Math.max(0, Math.min(edge - (Date.now() + skew) + 50, 2 ** 31 - 1));
    const id = setTimeout(bump, wait);
    return () => clearTimeout(id);
  }, [premiere, state, skew]);

  return {
    premiere,
    state,
    skew,
    serverNow,
    offset: () => sharedOffset(premiere, serverNow()),
    loading: on && isLoading,
    refetch,
  };
}
