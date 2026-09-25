import { useCallback, useEffect, useRef, useState } from 'react';
import { useAioha } from '@aioha/react-ui';
import { useHangout } from '../context/HangoutContext';
import { useAppStore } from '../lib/store';

/**
 * Everything a page needs to join an OpenPods room AS THE LOGGED-IN HIVE USER.
 *
 * Handing the 3Speak session over to the hangouts backend is asynchronous, and
 * two things go wrong if you just connect immediately:
 *
 *   - a cold load (opening a stream by URL) hasn't finished the handover yet,
 *     so the viewer joins as an anonymous guest — wrong chat name, and the
 *     server drops their messages before the streamer ever sees them;
 *   - the SDK joins ONCE, so a token that lands later never upgrades the
 *     identity. `joinKey` exists to be used as a React `key` on
 *     <StandaloneWatch>, forcing a re-join under the real user.
 *
 * Shared by the shorts-style mobile stream page and the live player embedded in
 * the normal watch page, which must behave identically — a viewer who chats
 * from one and then the other should be the same person both times.
 *
 * Only the SILENT handover (@threespeak signs server-side) happens on its own.
 * If that is not possible for this account, the viewer watches as a guest and
 * is asked for a wallet signature only when they choose to chat or raise a
 * hand (`signIn`). Opening a stream used to pop a wallet prompt straight away.
 */
export function useStreamSession() {
  const { sessionToken, sessionLoading, retryLogin, hangoutsUser } = useHangout();
  const { aioha, user: aiohaUser } = useAioha();
  const authenticated = useAppStore((s) => s.authenticated);
  const user = useAppStore((s) => s.user);

  // NOT limited to wallets that can sign client-side: the challenge is signed
  // server-side by @threespeak's delegated posting authority, which covers
  // HiveSigner and ManteAuth too. Gating on a signable provider meant mobile
  // viewers — who have no Keychain extension — silently joined as guests.
  const handoverUser = aiohaUser || user;
  const canHandover = !!authenticated && !!handoverUser;
  // Two attempts, not one. The handover involves a server-side signature and
  // can lose a race on a cold load; giving up after a single failure left a
  // signed-in viewer stuck as an anonymous guest for the whole session, with
  // nothing on the watch page offering to try again.
  const triesRef = useRef({ user: null, count: 0 });
  // Finished silent attempts, per account, for rendering (the ref above only
  // schedules them).
  const [silentSettled, setSilentSettled] = useState({ user: null, count: 0 });
  useEffect(() => {
    if (!canHandover || sessionToken || sessionLoading) return undefined;
    const t = triesRef.current;
    if (t.user !== handoverUser) { triesRef.current = { user: handoverUser, count: 0 }; }
    if (triesRef.current.count >= 2) return undefined;
    // Space the retry out — an immediate one usually loses the same race.
    const delay = triesRef.current.count === 0 ? 0 : 3000;
    const timer = setTimeout(() => {
      triesRef.current.count += 1;
      Promise.resolve(retryLogin(handoverUser, { interactive: false }))
        .catch(() => null)
        .finally(() => setSilentSettled((p) => ({
          user: handoverUser,
          count: p.user === handoverUser ? p.count + 1 : 1,
        })));
    }, delay);
    return () => clearTimeout(timer);
  }, [canHandover, handoverUser, sessionToken, sessionLoading, retryLogin]);

  // Are we PROBABLY about to authenticate? `authenticated` starts false and is
  // flipped true by the store's initializeAuth a beat after the first render,
  // so `canHandover` can't be trusted on a cold load — but a persisted `user_id`
  // is in localStorage synchronously, on the very first render, whenever the
  // viewer was signed in last time. That is the signal we need.
  //
  // Why it matters: if we connect as a guest during that ~100ms gap and then
  // re-connect as the authed user once the handover lands, LiveKit sees two
  // connections under one identity, kicks one as a duplicate, and the kicked
  // client rejoins — an endless ~23s churn that leaves the viewer unable to
  // raise their hand. Holding the connection until the token resolves means we
  // connect ONCE, as the real user. (See useStreamSession's callers, which
  // gate the LiveKit mount on connectReady.)
  const likelyAuthed = canHandover
    || (typeof window !== 'undefined' && !!window.localStorage.getItem('user_id'));

  // Safety deadline: never wait forever for a handover that isn't coming (a
  // genuinely expired session that initializeAuth will reject). A truly
  // anonymous viewer — no persisted user_id — doesn't wait at all.
  const [waited, setWaited] = useState(false);

  // The silent attempts are used up without a token: connect as a guest now
  // instead of sitting out the 10s deadline.
  const silentDone = canHandover && !sessionToken
    && silentSettled.user === handoverUser && silentSettled.count >= 2;

  // Asked for by the chat and raise-hand controls: may show a wallet prompt.
  const [signingIn, setSigningIn] = useState(false);
  const signIn = useCallback(async () => {
    if (!canHandover || signingIn) return null;
    setSigningIn(true);
    try {
      return await retryLogin(handoverUser, { interactive: true });
    } finally {
      setSigningIn(false);
    }
  }, [canHandover, handoverUser, retryLogin, signingIn]);
  useEffect(() => {
    if (!likelyAuthed) return undefined;
    const t = setTimeout(() => setWaited(true), 10000);
    return () => clearTimeout(t);
  }, [likelyAuthed]);

  return {
    aioha,
    authenticated,
    sessionToken,
    hangoutsUser,
    connectReady: !!sessionToken || !likelyAuthed || waited || silentDone,
    // Signed in to 3Speak but not yet to the room: offer to sign in on demand.
    needsSignIn: canHandover && !sessionToken,
    canInteract: !!sessionToken,
    signIn,
    signingIn,
    joinKey: sessionToken ? `auth-${hangoutsUser || 'user'}` : 'guest',
  };
}
