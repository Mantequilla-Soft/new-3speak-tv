import axios from 'axios';
import { useQuery } from '@tanstack/react-query';
import { CHECKER_URL } from '../utils/config';

/**
 * Making curation visible: what a vote earns its voter, and the curator page
 * (/curation/:user, page/Curation.jsx) from the checker's GET /curation/:user.
 *
 * How Hive pays curators (HF25 rules, checked against live posts): half of a
 * post's payout goes to its voters, split by each vote's curation weight. The
 * weight is the vote's rshares in the post's first 24 hours, half of it until 72
 * hours, an eighth after that. Votes of the first day therefore earn about half
 * of the value they add; later ones less. A vote that was changed afterwards, a
 * post that declined its payout or turned curation off, or one already paid out
 * earns nothing.
 */

const H = 3600 * 1000;
export const CURATION_SHARE = 0.5;

/** The curation weight factor of a vote cast `ageMs` after the post. */
export function curationFactor(ageMs) {
  if (!(ageMs >= 0)) return 1;
  if (ageMs < 24 * H) return 1;
  if (ageMs < 72 * H) return 0.5;
  return 0.125;
}

const chainMs = (s) => (s ? Date.parse(/Z$/.test(s) ? s : `${s}Z`) : NaN);
const declined = (maxAccepted) => /^\s*0(\.0+)?\s/.test(`${maxAccepted || ''} `);

/**
 * The curation reward a new vote worth `value` (in $, as estimate() gives it) can
 * expect from `post` (a get_content row). 0 when it earns nothing.
 */
export function estimateCuration({ value, post, now = Date.now(), changed = false }) {
  const v = Number(value);
  if (!(v > 0) || changed || !post) return 0;
  if (post.allow_curation_rewards === false || declined(post.max_accepted_payout)) return 0;
  const cashout = chainMs(post.cashout_time);
  if (Number.isFinite(cashout) && cashout < now) return 0;
  const created = chainMs(post.created);
  return v * CURATION_SHARE * curationFactor(now - created);
}

/** Money for the vote toast: "0.12", and "<0.01" for a sliver. */
export function formatSmallUsd(n) {
  const v = Number(n) || 0;
  if (v > 0 && v < 0.005) return '<0.01';
  return v.toFixed(v >= 1 ? 2 : 3).replace(/(\.\d\d)0$/, '$1');
}

export async function fetchCuration(user) {
  const { data } = await axios.get(`${CHECKER_URL}/curation/${encodeURIComponent(user)}`);
  return data;
}

export function useCuration(user) {
  return useQuery({
    queryKey: ['curation', user],
    queryFn: () => fetchCuration(user),
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

/**
 * Tell the checker a vote was cast on 3Speak (POST /curation/vote): the
 * curator page lists only those, as a Hive vote carries no app. Sent after the
 * vote went through, with the voter's session vouch; an unvote or downvote
 * (weight <= 0) takes the post off. Never throws: the vote itself already
 * happened, a lost report only leaves it off the curator page.
 */
export async function noteSiteVote(voter, author, permlink, weight) {
  if (!voter || !author || !permlink) return;
  try {
    const { sessionVouch } = await import('./podcastProgress');
    const v = await sessionVouch(voter);
    if (!v) return;
    await axios.post(`${CHECKER_URL}/curation/vote`, {
      user: v.user, signature: v.signature, timestamp: v.timestamp, author, permlink, weight: Math.round(Number(weight) || 0),
    });
  } catch { /* the curator page simply misses this one */ }
}

/** Where a pick lives on 3Speak (same rules as Supporters' supportItemLink). */
export function pickLink(p) {
  if (p.kind === 'audio') return `/audio/${p.author}/${p.permlink}`;
  if (p.kind === 'short') return `/shorts?v=${p.author}/${p.asset_permlink || p.permlink}`;
  return `/@${p.author}/${p.permlink}`;
}
