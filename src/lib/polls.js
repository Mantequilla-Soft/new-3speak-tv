/**
 * Polls on community snaps. The poll itself is on Hive: the snap's body is the
 * question and its json_metadata carries `poll: { options, ends_at }` (2 to 4
 * options, an optional end). Votes are kept by the checker (routes/polls.js),
 * one per account with the session vouch, so voting never asks the wallet; a
 * second vote moves the first until the poll ends.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CHECKER_URL } from '../utils/config';
import { sessionVouch } from './podcastProgress';

export const POLL_MIN_OPTIONS = 2;
export const POLL_MAX_OPTIONS = 4;
export const POLL_OPTION_MAX_LEN = 80;
// The end choices the composer offers, in days; 0 = no end.
export const POLL_DURATIONS = [1, 3, 7, 0];

/** The `poll` block for json_metadata, or null when the options don't make a poll. */
export function buildPollMeta(options, days, now = Date.now()) {
  const clean = (options || []).map((o) => String(o || '').replace(/\s+/g, ' ').trim().slice(0, POLL_OPTION_MAX_LEN)).filter(Boolean);
  if (clean.length < POLL_MIN_OPTIONS || clean.length > POLL_MAX_OPTIONS) return null;
  if (new Set(clean.map((o) => o.toLowerCase())).size !== clean.length) return null;
  return { options: clean, ends_at: days > 0 ? new Date(now + days * 86400000).toISOString() : null };
}

export const pollKey = (snap) => `${snap.owner}/${snap.permlink}`;
export const isPollClosed = (poll, now = Date.now()) => !!(poll?.ends_at && new Date(poll.ends_at).getTime() <= now);

/** { key: { counts, total, closed, ends_at, mine? } }; mine only when signed in. */
export async function fetchPollResults(keys, user) {
  const v = user ? await sessionVouch(user) : null;
  const res = await fetch(`${CHECKER_URL}/polls/results`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keys, ...(v ? { user, signature: v.signature, timestamp: v.timestamp } : {}) }),
  });
  if (!res.ok) throw new Error(`poll results: ${res.status}`);
  return (await res.json()).results || {};
}

export async function votePoll(user, author, permlink, choice) {
  const v = await sessionVouch(user);
  if (!v) throw Object.assign(new Error('not signed in'), { code: 'no_session' });
  const res = await fetch(`${CHECKER_URL}/polls/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user, author, permlink, choice, signature: v.signature, timestamp: v.timestamp }),
  });
  if (res.status === 409) throw Object.assign(new Error('closed'), { code: 'closed' });
  if (!res.ok) throw new Error(`poll vote: ${res.status}`);
  return (await res.json()).result;
}

export async function fetchCreatorPolls(owner) {
  const res = await fetch(`${CHECKER_URL}/polls/creator/${encodeURIComponent(owner)}`);
  if (!res.ok) throw new Error(`creator polls: ${res.status}`);
  return (await res.json()).polls || [];
}

const resultKey = (key, user) => ['poll-result', key, user || null];

/** One poll's tally (and the viewer's vote), plus `vote(choice)` that updates it. */
export function usePoll(snap, user) {
  const qc = useQueryClient();
  const key = snap?.poll ? pollKey(snap) : null;
  const { data, isLoading } = useQuery({
    queryKey: resultKey(key, user),
    enabled: !!key,
    staleTime: 30 * 1000,
    retry: 1,
    queryFn: async () => (await fetchPollResults([key], user))[key] || null,
  });
  const vote = async (choice) => {
    const result = await votePoll(user, snap.owner, snap.permlink, choice);
    qc.setQueryData(resultKey(key, user), result);
    return result;
  };
  return { result: data || null, isLoading, vote };
}

export function useCreatorPolls(owner) {
  return useQuery({
    queryKey: ['creator-polls', owner],
    enabled: !!owner,
    staleTime: 60 * 1000,
    retry: 1,
    queryFn: () => fetchCreatorPolls(owner),
  });
}

/** Whole-number shares that add up to 100 (largest remainder), for the bars. */
export function percents(counts) {
  const total = (counts || []).reduce((a, b) => a + b, 0);
  if (!total) return (counts || []).map(() => 0);
  const raw = counts.map((c) => (c * 100) / total);
  const floor = raw.map(Math.floor);
  let left = 100 - floor.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - floor[i], i]).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) { if (left <= 0) break; floor[i] += 1; left -= 1; }
  return floor;
}
