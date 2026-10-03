// The translation editor's calls to 3Speak's own API (server/i18n-editor.cjs).
//
// The server only accepts a PROVEN identity here: the Butter Auth cookie, the
// "Sign in with Hive" wallet-session cookie, or a HiveSigner token it checks with
// hivesigner.com. So, like broadcastViaThreespeak in hive-api/aioha.js, every
// call sends cookies, HiveSigner logins add their bearer token, and a write that
// comes back 401 establishes a wallet session ONCE (the wallet asks the user to
// approve a sign-in) and retries, instead of leaving a wallet user at a dead end.
import { Providers } from '@aioha/aioha';
import {
  establishWalletSession,
  getCurrentProvider,
  getOperationUser,
  isManteAuthLogin,
} from '../hive-api/aioha';

const API = import.meta.env.VITE_THREESPEAK_API || '/api';

function authHeaders() {
  try {
    if (getCurrentProvider() === Providers.HiveSigner) {
      const token = localStorage.getItem('hivesignerToken');
      if (token) return { Authorization: `Bearer ${token}` };
    }
  } catch { /* storage disabled */ }
  return {};
}

async function request(method, path, body) {
  const res = await fetch(`${API}/i18n${path}`, {
    method,
    credentials: 'include',
    cache: 'no-store',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...authHeaders(),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function write(method, path, body) {
  let r = await request(method, path, body);
  if (r.status === 401 && !isManteAuthLogin() && await establishWalletSession(getOperationUser())) {
    r = await request(method, path, body);
  }
  return r;
}

/** { user, translator }. Never throws; signed out or API down reads as "not a translator". */
export async function fetchTranslatorStatus() {
  try {
    const r = await request('GET', '/me');
    if (r.ok && r.data && typeof r.data === 'object') {
      return { user: r.data.user || null, translator: r.data.translator === true };
    }
  } catch { /* API unreachable */ }
  return { user: null, translator: false };
}

/** Menu hint: is this Hive name on the translator list? Never throws. */
export async function isTranslatorName(user) {
  if (!user) return false;
  try {
    const r = await request('GET', `/translator/${encodeURIComponent(user)}`);
    return r.ok && r.data?.translator === true;
  } catch { return false; }
}

/**
 * Prove the signed-in wallet account to the server (wallet sign-in prompt for
 * Keychain/HiveAuth/PeakVault/Ledger, token exchange for HiveSigner).
 */
export async function verifyAccount() {
  if (isManteAuthLogin()) return false;
  try { return await establishWalletSession(getOperationUser()); } catch { return false; }
}

/**
 * PUT { changes } (≤ 200). Resolves { ok, status, data }; data.errors holds per-key
 * messages, data.marks / data.unmarked the proofread marks the save set or removed.
 */
export const saveStrings = (lang, changes) => write('PUT', `/strings/${encodeURIComponent(lang)}`, { changes });

/** POST a community language { code, native, english, dir }. */
export const addLanguage = (lang) => write('POST', '/languages', lang);

/** GET { marks: { key: { by, at, hash } } } for a language. Resolves { ok, status, data }. */
export async function fetchProofread(lang) {
  try {
    return await request('GET', `/proofread/${encodeURIComponent(lang)}`);
  } catch {
    return { ok: false, status: 0, data: {} };
  }
}

/** PUT { marks: { key: { checked, hash } } } (≤ 500). data.marks echoes the stored marks. */
export const saveProofread = (lang, marks) => write('PUT', `/proofread/${encodeURIComponent(lang)}`, { marks });
