// Drafts session for an embedded editor (Shorts editor or Ad Wizard): a token from our own server
// (POST /api/editor-token), which only issues it for a VERIFIED session of `user` (butrauth, or the wallet /
// HiveSigner session cookie). HiveSigner gets a session silently; wallet logins sign once, and only when the
// person asked (interactive), never as a surprise popup. Same rules as EditorModal.
import { establishWalletSession, getCurrentProvider, Providers } from '../hive-api/aioha';

export async function mintDraftSession(user, interactive) {
  if (!user) return { session: null, reason: 'logged-out' };
  const who = String(user).toLowerCase();
  const mint = () => fetch('/api/editor-token', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: who }),
  }).catch(() => null);
  let res = await mint();
  const silent = getCurrentProvider() === Providers.HiveSigner;
  if (res && res.status === 401 && (interactive || silent)) {
    try { await establishWalletSession(user); } catch { /* declined or failed */ }
    res = await mint();
  }
  let session = null;
  if (res && res.ok) {
    const s = await res.json().catch(() => null);
    if (s && s.user === who) session = s; // a cookie of another account must not open its drafts
  }
  if (session) return { session, reason: null };
  const needsSignIn = res && (res.status === 401 || res.ok);
  return { session: null, reason: needsSignIn ? (interactive ? 'sign-in-failed' : 'sign-in-needed') : 'unavailable' };
}
