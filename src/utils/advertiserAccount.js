/**
 * "Is this account an advertiser?" on the frontend, for the nav's Advertise button.
 *
 * The checker answers it (public yes/no): an advertiser product on file, or an
 * account that graduated from the ADVERTISER warm-up (linked server-side at
 * graduation). A yes is remembered in this browser so the button shows at once on
 * the next visit, before the lookup comes back.
 */
import { CHECKER_URL } from './config';
import { fetchWarmupContact } from '../lib/incubation';

const KNOWN_KEY = '3s-advertiser-accounts';

export function rememberAdvertiserAccount(username) {
  const name = String(username || '').toLowerCase();
  if (!name) return;
  try {
    const list = JSON.parse(localStorage.getItem(KNOWN_KEY) || '[]');
    if (!list.includes(name)) localStorage.setItem(KNOWN_KEY, JSON.stringify([...list, name].slice(-20)));
  } catch { /* storage off */ }
}

export function isRememberedAdvertiser(username) {
  try {
    return JSON.parse(localStorage.getItem(KNOWN_KEY) || '[]').includes(String(username || '').toLowerCase());
  } catch {
    return false;
  }
}

/** Is this Hive account an advertiser (a product on file, or an advertiser graduate)? */
export async function hasAdvertiserProduct(username) {
  try {
    const r = await fetch(`${CHECKER_URL}/advertise/has-product/${encodeURIComponent(username)}`);
    if (!r.ok) return false;
    const d = await r.json();
    return d.isAdvertiser === true || d.hasProduct === true;
  } catch {
    return false;
  }
}

/**
 * Is the signed-in account an advertiser? Any one of: already known in this browser,
 * their own private contact record (only advertisers have one; read with their
 * session, so it works the moment they graduate), or the public lookup. A yes is
 * remembered. Never throws; "no" when it cannot tell.
 */
export async function isAdvertiserAccount(username) {
  if (!username) return false;
  if (isRememberedAdvertiser(username)) return true;
  const contact = await fetchWarmupContact().catch(() => null);
  const yes = !!contact?.email || await hasAdvertiserProduct(username);
  if (yes) rememberAdvertiserAccount(username);
  return yes;
}
