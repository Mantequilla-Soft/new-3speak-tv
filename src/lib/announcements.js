// The announcement popup: messages from the 3Speak team, shown once per browser to
// logged-in users. An announcement is either for everybody, or addressed to
// particular accounts ("personal").
//
// The team publishes announcements straight into Mongo from a separate admin tool;
// the checker serves them (/announcements/latest) and stores replies
// (POST /announcements/:number/replies). See 3speakchecks/routes/announcements.js
// for the document shape.
import { CHECKER_URL } from '../utils/config';
import { getCurrentProvider, Providers } from '../hive-api/aioha';
import { APP_VERSION } from '../version';

const SEEN_KEY = '3speak_announcement_seen';
const THREESPEAK_API = import.meta.env.VITE_THREESPEAK_API || '/api';

// Personal announcements keep their own marker per account: a personal message
// must not count as having seen the general one before it, and a second account
// on the same browser must still get theirs.
const seenKey = (personalFor) => (personalFor ? `${SEEN_KEY}:${personalFor}` : SEEN_KEY);

// The highest announcement number shown here, 0 if none. null when storage is
// unavailable: we could never remember the close, so the caller shows nothing
// rather than the same popup on every visit.
export function readSeenAnnouncement(personalFor = null) {
  try {
    return Number(localStorage.getItem(seenKey(personalFor))) || 0;
  } catch {
    return null;
  }
}

export function markAnnouncementSeen(number, personalFor = null) {
  try {
    const key = seenKey(personalFor);
    if (number > (Number(localStorage.getItem(key)) || 0)) {
      localStorage.setItem(key, String(number));
    }
  } catch {
    // localStorage unavailable — ignore.
  }
}

// Ask our own backend to vouch that this session really is @user. Silent and
// best-effort: it never prompts the wallet, and without it the caller simply gets
// no personal announcements / an unproven name on a reply.
async function vouch(path, body, user) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (getCurrentProvider() === Providers.HiveSigner) {
      const token = localStorage.getItem('hivesignerToken');
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch(`${THREESPEAK_API}/announcements/${path}`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    // The server signs for whoever ITS session is. If that is not who the page
    // thinks is logged in, use no proof at all rather than the wrong one.
    if (!res.ok || !data.signature || data.username !== user) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * The newest general announcement and, for a proven account, the newest one
 * addressed to it: { announcement, personal }, either may be null.
 */
export async function fetchAnnouncements(user) {
  const name = user ? String(user).toLowerCase() : null;
  const proof = name ? await vouch('read-signature', {}, name) : null;
  const res = proof
    ? await fetch(`${CHECKER_URL}/announcements/latest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: name, signature: proof.signature, timestamp: proof.timestamp }),
      })
    : await fetch(`${CHECKER_URL}/announcements/latest`);
  if (!res.ok) return { announcement: null, personal: null };
  const data = await res.json().catch(() => ({}));
  return { announcement: data.announcement || null, personal: data.personal || null };
}

/**
 * Send a reply. Resolves on success; throws an Error whose `status` is the HTTP
 * status (429 = sent too many just now) so the popup can say the right thing.
 */
export async function sendAnnouncementReply(number, text, user) {
  const name = user ? String(user).toLowerCase() : null;
  const proof = name ? await vouch('reply-signature', { number }, name) : null;
  const res = await fetch(`${CHECKER_URL}/announcements/${number}/replies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      username: name,
      signature: proof?.signature,
      timestamp: proof?.timestamp,
      app_version: APP_VERSION,
    }),
  });
  if (!res.ok) {
    const err = new Error(`reply failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
}
