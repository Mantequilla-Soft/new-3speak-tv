/**
 * Our API's word for who this session is: POST /api/podcasts/signature
 * { action, payload: 'session' } answers a vouch "we verified a session for @x",
 * signed with @threespeak's own key (`3speak-podcasts|<action>-vouch|<x>|session|<ms>`).
 * The checker takes it for a day as proof of who is asking, for listening progress
 * ('progress'), listener rewards ('listen') and push-notification choices ('push').
 * Every login type gets one without a wallet prompt: the Butter Auth cookie, the
 * wallet-login session cookie, or a HiveSigner token sent as a Bearer header.
 *
 * `named: true` tells the API which account the page acts for, so only a verified
 * session of exactly that account is vouched for (two logins in one browser never
 * get mixed up). Without it, the API vouches for its first verified session.
 *
 * Null when the session can't be proven (signed out, another account, API down).
 */
import { getCurrentProvider, Providers } from '../hive-api/aioha';

const THREESPEAK_API = import.meta.env.VITE_THREESPEAK_API || '/api';

function hiveSignerBearer() {
  if (getCurrentProvider() !== Providers.HiveSigner) return null;
  try { return localStorage.getItem('hivesignerToken') || null; } catch { return null; }
}

export async function fetchSessionVouch(action, user, { named = false } = {}) {
  if (!user) return null;
  try {
    const headers = { 'Content-Type': 'application/json' };
    const token = hiveSignerBearer();
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${THREESPEAK_API}/podcasts/signature`, {
      method: 'POST', headers, credentials: 'include',
      body: JSON.stringify(named ? { action, payload: 'session', username: user } : { action, payload: 'session' }),
    });
    const data = await res.json().catch(() => ({}));
    // The server vouches for whoever ITS session is; never use a proof for someone else.
    if (!res.ok || !data.signature || data.username !== user) return null;
    return { user, signature: data.signature, timestamp: data.timestamp };
  } catch {
    return null;
  }
}
