import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { HangoutsApiClient, loginWithAioha, loginWithSignFn } from '@snapie/hangouts-core';
import { Providers } from '@aioha/aioha';
import { useAppStore } from '../lib/store';
import aioha, { isManteAuthLogin } from '../hive-api/aioha';
import { EMBED_API_KEY } from '../utils/config';

const HangoutContext = createContext(undefined);

// Module-level shared state so concurrent callers share one request and one cache
const sessionCache = new Map();
let pendingLogin = null;

// Token-persistence helpers. Off by default — see <HangoutContextProvider
// tokenStorage="local" /> to opt in. localStorage tokens survive browser
// restarts and are XSS-readable for up to the JWT TTL (24h); sessionStorage
// only survives reloads in the same tab. Keep "none" if you'd rather have
// the user re-sign on every visit.
const TOKEN_STORAGE_PREFIX = 'hh_session_';
const NOOP_STORAGE = { read: () => null, write: () => {}, clear: () => {} };
function buildTokenStorage(mode) {
  if (!mode || mode === 'none' || typeof window === 'undefined') return NOOP_STORAGE;
  if (mode !== 'local' && mode !== 'session') {
    // Custom storage object with read/write/clear — use as-is.
    return mode;
  }
  const store = mode === 'session' ? window.sessionStorage : window.localStorage;
  return {
    read(username) {
      if (!username) return null;
      try {
        const raw = store.getItem(TOKEN_STORAGE_PREFIX + username);
        if (!raw) return null;
        // Decode the JWT exp claim — reject if expired or expiring within
        // 30s so we don't hand the server a token it'll immediately reject.
        const payload = JSON.parse(atob(raw.split('.')[1]));
        if (payload.exp && payload.exp * 1000 < Date.now() + 30_000) {
          store.removeItem(TOKEN_STORAGE_PREFIX + username);
          return null;
        }
        return raw;
      } catch {
        try { store.removeItem(TOKEN_STORAGE_PREFIX + username); } catch { /* ignore */ }
        return null;
      }
    },
    write(username, token) {
      if (!username) return;
      try { store.setItem(TOKEN_STORAGE_PREFIX + username, token); } catch { /* ignore */ }
    },
    clear(username) {
      if (!username) return;
      try { store.removeItem(TOKEN_STORAGE_PREFIX + username); } catch { /* ignore */ }
    },
  };
}

const HANGOUTS_API_URL = import.meta.env.VITE_HANGOUTS_API_URL || '';
const OPENPODS_ENABLED = !!HANGOUTS_API_URL;

// preview-3speak's own backend (broadcast/manteauth). Same base aioha.js uses.
const THREESPEAK_API = import.meta.env.VITE_THREESPEAK_API || '/api';

// True when the current login can sign a challenge message client-side.
// Wallet providers (Keychain/HiveAuth/PeakVault/Ledger) can; HiveSigner can't
// sign arbitrary buffers, and ManteAuth/ButrAuth holds no client-side key.
function canSignClientSide() {
  if (isManteAuthLogin()) return false;
  const provider = aioha.getCurrentProvider?.() ?? null;
  return !!provider && provider !== Providers.HiveSigner;
}

// Sign a Hangouts challenge via @threespeak (delegated posting authority) so the
// background service signs for the user — no wallet popup — for ALL login types.
// Auth to the preview backend: HiveSigner → Bearer token; ManteAuth → httpOnly
// cookie; wallet (Keychain/HiveAuth/PeakVault/Ledger) → public app key + claimed
// username (same trust as /api/broadcast). The backend verifies the user granted
// @threespeak posting auth before signing; the patched Hangouts /auth/verify
// accepts the delegated signature. Throws on failure (e.g. authority not
// granted) so the caller can fall back to a client-side signature.
async function signOpenPodsChallengeViaThreespeak(challenge, username) {
  const provider = aioha.getCurrentProvider?.() ?? null;
  const headers = { 'Content-Type': 'application/json' };
  const body = { challenge };
  if (provider === Providers.HiveSigner) {
    const token = localStorage.getItem('hivesignerToken');
    if (!token) throw new Error('HiveSigner session expired — reconnect and try again');
    headers.Authorization = `Bearer ${token}`;
  } else if (!isManteAuthLogin()) {
    // Wallet login: no server-side credential → app key + claimed username.
    headers['X-API-Key'] = EMBED_API_KEY;
    body.username = username;
  }
  // ManteAuth: httpOnly cookie travels via credentials:'include'.
  const res = await fetch(`${THREESPEAK_API}/openpods/sign-challenge`, {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.signature) {
    throw new Error(data.error || 'Could not sign the OpenPods challenge');
  }
  return data.signature;
}
/**
 * Is this session token still accepted by the server?
 *
 * `GET /auth/me` is a cheap authenticated probe. Anything other than a clean
 * 401 (network blip, server down) counts as "keep the token" — we only discard
 * on an explicit rejection, so a flaky connection can't log the user out.
 */
async function verifySessionToken(token) {
  try {
    const res = await fetch(`${HANGOUTS_API_URL.replace(/\/$/, '')}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.status !== 401;
  } catch {
    return true;
  }
}

// No-op stub when the OpenPods API URL isn't configured, so the rest of the
// app can mount the provider without crashing. Anything that does network is
// guarded by `OPENPODS_ENABLED` and never reaches the stub.
const hangoutsClient = OPENPODS_ENABLED
  ? new HangoutsApiClient({ baseUrl: HANGOUTS_API_URL })
  : {
      setSessionToken: () => {},
      clearSessionToken: () => {},
      getSessionToken: () => null,
      listRooms: async () => [],
      requestChallenge: async () => { throw new Error('VITE_HANGOUTS_API_URL is not configured'); },
      request: async () => { throw new Error('VITE_HANGOUTS_API_URL is not configured'); },
    };

export function HangoutContextProvider({ children, tokenStorage = 'none' }) {
  const [activeRoom, setActiveRoom]       = useState(null);
  const [sessionToken, setSessionToken]   = useState(null);
  const [sessionLoading, setSessionLoading] = useState(false);

  const { authenticated, user } = useAppStore();

  // Token storage is configured at mount time and won't change between
  // renders — keeping it stable avoids re-creating the storage adapter
  // mid-session and tearing down cached entries.
  const storageRef = useRef(buildTokenStorage(tokenStorage));

  // `interactive: false` = the silent @threespeak signature only, never a
  // wallet popup. Watching a stream uses that: the viewer is only asked to sign
  // once they actually want to chat or raise a hand.
  const loginToHangouts = useCallback(async (requestedUser = user, { interactive = true } = {}) => {
    if (!OPENPODS_ENABLED) return null;
    if (!authenticated || !requestedUser) return null;

    const isStillCurrentUser = () => {
      const state = useAppStore.getState();
      return state.authenticated && state.user === requestedUser;
    };

    // Return cached token immediately — checks both in-memory cache and
    // the configured persistent storage (no-op when tokenStorage="none").
    let cached = sessionCache.get(requestedUser);
    if (!cached) {
      const persisted = storageRef.current.read(requestedUser);
      if (persisted) {
        cached = persisted;
        sessionCache.set(requestedUser, persisted);
      }
    }
    if (cached) {
      // A restored token can be unexpired yet UNVERIFIABLE — the storage layer
      // only decodes the `exp` claim, it can't check the signature. After the
      // server's SESSION_SECRET is rotated, every stored token stays "valid
      // looking" forever while the server rejects it, and the user is stuck
      // with "Invalid or expired session token" on every action with no way
      // out but clearing site data. Probe it once, and re-mint if it's dead.
      const stillGood = await verifySessionToken(cached);
      if (stillGood) {
        if (isStillCurrentUser()) {
          hangoutsClient.setSessionToken(cached);
          setSessionToken(cached);
        }
        return cached;
      }
      sessionCache.delete(requestedUser);
      storageRef.current.clear(requestedUser);
      hangoutsClient.clearSessionToken();
    }

    // No cached token, so we sign a fresh challenge. Per 3speak policy, ALL
    // logins go through the background @threespeak signer first (no wallet
    // popup). Only if that fails — e.g. the user never granted @threespeak
    // posting authority — do wallet providers fall back to a client-side
    // Aioha signature (the actual fallback happens at the loginPromise below).

    // Deduplicate: if a login is already in-flight, await it
    // A silent attempt in flight does not satisfy an interactive request: it
    // cannot fall back to the wallet. That case waits below and retries.
    if (pendingLogin?.user === requestedUser && (pendingLogin.interactive || !interactive)) {
      try {
        const token = await pendingLogin.promise;
        if (isStillCurrentUser()) setSessionToken(token);
        return token;
      } catch { /* error already logged by the initiating call */ }
      return null;
    }

    // If another account is mid-signature, don't apply that token to this user.
    // Wait for it to settle, then retry only if this account is still current.
    if (pendingLogin) {
      setSessionLoading(true);
      try {
        await pendingLogin.promise;
      } catch { /* error already logged by the initiating call */ }
      return isStillCurrentUser() ? loginToHangouts(requestedUser, { interactive }) : null;
    }

    setSessionLoading(true);

    // Background @threespeak signer for every login (no wallet popup). If it
    // fails (e.g. the user hasn't granted @threespeak posting authority) and the
    // provider CAN sign client-side, fall back to a client-side Aioha signature.
    const loginPromise = (async () => {
      try {
        return await loginWithSignFn(
          hangoutsClient,
          requestedUser,
          (challenge) => signOpenPodsChallengeViaThreespeak(challenge, requestedUser),
        );
      } catch (bgErr) {
        if (interactive && canSignClientSide()) {
          return loginWithAioha(hangoutsClient, aioha, requestedUser);
        }
        throw bgErr;
      }
    })()
      .then(session => {
        const tokenUser = session.username || requestedUser;
        sessionCache.set(tokenUser, session.token);
        storageRef.current.write(tokenUser, session.token);
        if (isStillCurrentUser()) {
          hangoutsClient.setSessionToken(session.token);
        } else {
          hangoutsClient.clearSessionToken();
        }
        return session.token;
      })
      .catch(err => {
        console.error('[OpenPods] Session auth failed:', err);
        throw err;
      })
      .finally(() => {
        if (pendingLogin?.user === requestedUser) pendingLogin = null;
      });

    pendingLogin = { user: requestedUser, promise: loginPromise, interactive };

    try {
      const token = await loginPromise;
      if (isStillCurrentUser()) setSessionToken(token);
      return token;
    } catch {
      if (isStillCurrentUser()) setSessionToken(null);
      return null;
    } finally {
      if (isStillCurrentUser()) setSessionLoading(false);
    }
  }, [authenticated, user]);

  const openRoom = useCallback((roomName) => {
    if (!roomName) return false;

    // Authenticated user → fetch a hangouts session token (lazy sign).
    // Unauthenticated visitor → still allowed: the room opens in
    // listen-only guest mode (the SDK calls /listen which doesn't need
    // a token).
    if (authenticated && user && !sessionToken && !sessionLoading) {
      loginToHangouts(user);
    }

    setActiveRoom(roomName);
    return true;
  }, [authenticated, user, sessionToken, sessionLoading, loginToHangouts]);

  // No eager login on auth change — sign-prompt is annoying on every page load.
  // Login is triggered lazily when the user actively opens Hangouts:
  //   - lands on /openpods or /openpods/publish (the pages call retryLogin)
  //   - clicks a room (openRoom() calls loginToHangouts)
  //
  // Only clear hangouts state on actual user TRANSITION (logged-out, or user
  // swap). Without the prevUserRef guard, every re-render that happens to
  // re-fire this effect would clear sessionToken / activeRoom — which makes
  // an open <OpenPodModal> unmount mid-session and close its LiveKit
  // WebSocket immediately, surfacing as "could not establish signal
  // connection" 60ms after the room appears.
  //
  // Initial mount is also explicitly NOT a "transition" — child pages
  // (e.g. /openpods/:roomName deep links) may have already set activeRoom
  // via openRoom() in their own useEffects, which fire BEFORE this parent
  // effect. Clearing here would silently swallow that deep link.
  const prevUserRef = useRef({ authenticated: null, user: null });
  const isInitialMountRef = useRef(true);
  useEffect(() => {
    if (!OPENPODS_ENABLED) return;
    const prev = prevUserRef.current;
    // Compare USER identity only — `authenticated` flips false→true after
    // the store rehydrates `user` from localStorage and the async session
    // re-verify lands. That's not a real user transition and we must not
    // clear activeRoom for it (would kill an in-flight deep-link modal).
    const sameUser = prev.user === user;
    prevUserRef.current = { authenticated, user };
    if (sameUser) return;

    if (isInitialMountRef.current) {
      // First run: record current auth state and (when applicable) restore
      // a persisted hangouts token so a refresh on /openpods/:room can use
      // it without re-signing. Crucially, do NOT touch activeRoom — that
      // belongs to whatever page-level deep-link effect already ran.
      isInitialMountRef.current = false;
      if (authenticated && user) {
        const persisted = storageRef.current.read(user);
        if (persisted) {
          sessionCache.set(user, persisted);
          hangoutsClient.setSessionToken(persisted);
          setSessionToken(persisted);
        }
      }
      return;
    }

    if (authenticated && user) {
      setActiveRoom(null);
      setSessionToken(null);
      hangoutsClient.clearSessionToken();
      // When persistence is enabled, try to forward a previously-issued
      // token so the user skips the hangouts re-sign on this load. No-op
      // when tokenStorage="none" — the lazy-sign flow runs as before.
      const persisted = storageRef.current.read(user);
      if (persisted) {
        sessionCache.set(user, persisted);
        hangoutsClient.setSessionToken(persisted);
        setSessionToken(persisted);
      }
    } else {
      // On full logout, drop the previous user's persisted token so they
      // can't share devices and silently re-enter someone else's session.
      if (prev.user) storageRef.current.clear(prev.user);
      setActiveRoom(null);
      setSessionToken(null);
      setSessionLoading(false);
      sessionCache.clear();
      hangoutsClient.clearSessionToken();
    }
  }, [authenticated, user]);

  return (
    <HangoutContext.Provider value={{
      activeRoom,
      openRoom,
      closeRoom:      () => setActiveRoom(null),
      sessionToken,
      sessionLoading,
      retryLogin:     loginToHangouts,
      hangoutsUser:   user,
    }}>
      {children}
    </HangoutContext.Provider>
  );
}

export function useHangout() {
  const ctx = useContext(HangoutContext);
  if (!ctx) throw new Error('useHangout must be used within HangoutContextProvider');
  return ctx;
}
