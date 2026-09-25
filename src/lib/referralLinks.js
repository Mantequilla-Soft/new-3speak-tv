// Invite links, as 3Speak's own server serves them (server/index.cjs, through
// the Butter Auth SDK). The browser never talks to Butter Auth for these: the
// referrer screen needs the app's client credentials, and the landing page
// needs to know the invite is for 3Speak before offering to sign up.

async function getJson(url) {
  const res = await fetch(url, { credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** { valid, referrer, fastTrack } for the landing page. */
export const fetchInvite = (code) => getJson(`/api/referral/invite/${encodeURIComponent(code)}`);

/** { account, links: ReferralLink[] } for the signed-in user. 401 when signed out. */
export const fetchMyInviteLinks = () => getJson('/api/referral/links');

/** { people } for one of the signed-in user's links. */
export const fetchInvitePeople = (linkId) => getJson(`/api/referral/links/${encodeURIComponent(linkId)}/people`);
