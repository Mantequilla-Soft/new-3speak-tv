import { useEffect, useState } from 'react';
import { BUTRAUTH_URL } from './config';

/**
 * Can somebody create a free Hive account from THIS device?
 *
 * Butter Auth refuses account creation from a capped network, a shared address
 * that has already had one, or a VPN. Without asking, the first a person hears
 * of it is after they have signed in, chosen a name and generated keys -- which
 * is the worst possible moment to be told no.
 *
 * Asked FROM THE BROWSER, deliberately. The answer is about the caller's IP, so
 * routing it through our own server would ask about the server's address and
 * always come back "yes".
 *
 * FAILS OPEN. If the check errors, times out, or is blocked, `possible` stays
 * true and the button shows. Hiding signup because a request failed would turn
 * a blip into a lost user, and the real gate still runs at creation time -- this
 * is a courtesy, not an enforcement point.
 */

// One answer per page load. It is keyed on the address, which does not change
// under someone mid-session, and every entry point asks -- the nav, the login
// modal, the mobile bar -- so without this a single page could ask three times.
let cached = null;

export function fetchSignupPossible() {
  if (cached) return cached;
  cached = (async () => {
    try {
      const res = await fetch(`${BUTRAUTH_URL}/api/account/signup-possible`, {
        // No cookies: the endpoint takes none, and sending them would require a
        // named origin instead of the wildcard it answers with.
        credentials: 'omit',
        signal: AbortSignal.timeout?.(6000),
      });
      if (!res.ok) return { possible: true };
      const data = await res.json();
      return {
        possible: data.possible !== false,
        reason: data.reason || null,
        message: data.message || null,
      };
    } catch {
      return { possible: true };
    }
  })();
  return cached;
}

/** Re-ask on the next call. For tests and for after a network change. */
export function resetSignupPossible() {
  cached = null;
}

export function useSignupPossible() {
  // Starts as possible so the button is never hidden for the moment the check
  // is in flight, then corrected if the answer says otherwise. The other order
  // makes signup flicker out of existence on every page load.
  const [state, setState] = useState({ possible: true, reason: null, message: null, loading: true });

  useEffect(() => {
    let alive = true;
    fetchSignupPossible().then((r) => {
      if (alive) setState({ ...r, loading: false });
    });
    return () => { alive = false; };
  }, []);

  return state;
}
