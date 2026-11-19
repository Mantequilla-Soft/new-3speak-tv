/**
 * Collab posts: a creator names a co-creator while publishing. The post carries
 * `collaborators: ['<account>']` in its json_metadata and a beneficiary split for
 * them; the checker (routes/collabs.js) reads that back from Hive and holds an
 * invite the co-creator accepts or declines with the session vouch. Only an
 * accepted collab shows on the co-creator's channel, in their followers' feeds,
 * and as "badadib with x" on cards and the watch page.
 */
import { useQuery } from '@tanstack/react-query';
import { CHECKER_URL } from '../utils/config';
import { sessionVouch } from './podcastProgress';
import { HIVE_MAX_BENEFICIARIES } from '../utils/beneficiaries';

const API = `${CHECKER_URL}/collabs`;
export const COLLAB_SPLIT_DEFAULT = 50;
export const COLLAB_SPLITS = [25, 50, 75];

async function vouched(path, user, body = {}) {
  const v = await sessionVouch(user);
  if (!v) throw new Error('not signed in');
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, user, signature: v.signature, timestamp: v.timestamp }),
  });
  if (!res.ok) throw new Error(`collabs${path}: ${res.status}`);
  return res.json();
}

/** The co-creator's answer. */
export const respondToCollab = (user, author, permlink, accept) => vouched('/respond', user, { author, permlink, accept: !!accept });

/** Invites to me: [{ author, permlink, title, status, created_at }]. */
export async function fetchMyCollabs(user) {
  if (!user) return [];
  return (await vouched('/mine', user)).invites || [];
}

export function useMyCollabInvites(user) {
  const { data } = useQuery({
    queryKey: ['collab-invites', user],
    enabled: !!user,
    staleTime: 60 * 1000,
    retry: 1,
    queryFn: () => fetchMyCollabs(user),
  });
  return data || [];
}

/**
 * Tell the checker about a just-published collab post. It reads the post from
 * Hive itself, so this carries nothing but the address; retried while the post
 * propagates.
 */
export async function registerCollab(author, permlink, { attempts = 5, delayMs = 3000 } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(`${API}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ author, permlink }),
      });
      if (res.ok) return (await res.json()).collaborators || [];
      if (res.status !== 404) return [];
    } catch { /* network: try again */ }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  return [];
}

/** Accepted collaborators of one post (the watch page). */
export function usePostCollaborators(author, permlink) {
  const { data } = useQuery({
    queryKey: ['post-collabs', author, permlink],
    enabled: !!author && !!permlink,
    staleTime: 5 * 60 * 1000,
    retry: 0,
    queryFn: async () => {
      const res = await fetch(`${API}/post/${encodeURIComponent(author)}/${encodeURIComponent(permlink)}`);
      if (!res.ok) return [];
      return (await res.json()).collaborators || [];
    },
  });
  return data || [];
}

/**
 * The collaborator's beneficiary weight (Hive's 1/100 %): `split` % of what the
 * creator keeps after every other beneficiary. Null when it can't fit: no share
 * left, or Hive's beneficiary limit already reached.
 */
export function collabWeight(otherBeneficiaries, split = COLLAB_SPLIT_DEFAULT) {
  const list = Array.isArray(otherBeneficiaries) ? otherBeneficiaries : [];
  if (list.length >= HIVE_MAX_BENEFICIARIES) return null;
  const used = list.reduce((n, b) => n + (Number(b.weight) || 0), 0);
  const left = 10000 - used;
  const w = Math.floor((left * Math.min(100, Math.max(1, split))) / 100);
  return w >= 100 ? w : null;
}

/** The names a card or watch page shows next to the author. */
export const collaboratorsOf = (video) => (Array.isArray(video?.collaborators) ? video.collaborators.filter(Boolean) : []);
