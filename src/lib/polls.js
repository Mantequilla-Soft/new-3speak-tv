/**
 * Polls on community snaps, on the Hive Open Polls protocol (the one PeakD and
 * Ecency use), so a 3Speak poll is a poll there too and theirs count here.
 *
 * The poll: the snap's body is the question; its json_metadata carries our own
 * `poll: { options, ends_at }` (what the checker indexes the snap with,
 * 3speakchecks utils/polls.js) AND the protocol's fields (openPollFields):
 * content_type 'poll', version, question, choices, end_time and the options.
 *
 * A vote is a custom_json `polls` { poll: 'author/permlink', action: 'vote',
 * choices: [n] } (n from 1) in the voter's name, through the usual posting path
 * (Butter Auth, the @threespeak proxy, else the wallet). A second vote replaces
 * the first. The results come from the public polls API (polls.hivehub.dev),
 * which reads those operations from Hive; it is a few seconds behind, so a vote
 * shows at once from here.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyTypes } from '@aioha/aioha';
import { customJsonWithAioha } from '../hive-api/aioha';

export const POLLS_API_URL = import.meta.env.VITE_POLLS_API_URL || 'https://polls.hivehub.dev';
// The protocol version PeakD writes (2026-11); the API reads polls by it.
export const OPEN_POLLS_VERSION = 0.8;

export const POLL_MIN_OPTIONS = 2;
export const POLL_MAX_OPTIONS = 4;
export const POLL_OPTION_MAX_LEN = 80;
// The end choices the composer offers, in days. A protocol poll always ends,
// so there is no "no end"; 30 days is the most the checker keeps a poll open.
export const POLL_DURATIONS = [1, 3, 7, 30];

/** Our poll block for json_metadata, or null when the options don't make a poll. */
export function buildPollMeta(options, days, now = Date.now()) {
  const clean = (options || []).map((o) => String(o || '').replace(/\s+/g, ' ').trim().slice(0, POLL_OPTION_MAX_LEN)).filter(Boolean);
  if (clean.length < POLL_MIN_OPTIONS || clean.length > POLL_MAX_OPTIONS) return null;
  if (new Set(clean.map((o) => o.toLowerCase())).size !== clean.length) return null;
  const d = days > 0 ? days : 1;
  return { options: clean, ends_at: new Date(now + d * 86400000).toISOString() };
}

/**
 * The Hive Open Polls fields for a snap's json_metadata, from our poll block and
 * the snap's text (the question, one line). One vote per account, changeable
 * until the end, open to any account, results shown after voting.
 */
export function openPollFields(question, poll) {
  if (!poll || !Array.isArray(poll.options)) return {};
  const q = String(question || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return {
    content_type: 'poll',
    version: OPEN_POLLS_VERSION,
    question: q,
    choices: poll.options,
    preferred_interpretation: 'number_of_votes',
    end_time: Math.floor(new Date(poll.ends_at).getTime() / 1000),
    max_choices_voted: 1,
    allow_vote_changes: true,
    filters: { account_age: 0 },
    ui_hide_res_until_voted: true,
    community_membership: [],
  };
}

export const pollKey = (snap) => `${snap.owner}/${snap.permlink}`;
export const isPollClosed = (poll, now = Date.now()) => !!(poll?.ends_at && new Date(poll.ends_at).getTime() <= now);

/**
 * One poll as the API reports it, in our shape: { counts, total, closed,
 * ends_at, mine } (counts by option, mine the viewer's option or null). `size`
 * is how many options the snap has; a poll the API has not read yet is all 0.
 */
export function resultFromApi(row, size, user) {
  const counts = Array.from({ length: size }, () => 0);
  for (const c of row?.poll_choices || []) {
    const i = Number(c.choice_num) - 1;
    if (i >= 0 && i < size) counts[i] = Number(c.votes?.total_votes) || 0;
  }
  const voter = user ? (row?.poll_voters || []).find((v) => v.name === user) : null;
  const pick = Array.isArray(voter?.choices) ? Number(voter.choices[0]) - 1 : -1;
  return {
    counts,
    total: counts.reduce((a, b) => a + b, 0),
    closed: row?.status ? row.status !== 'Active' : false,
    ends_at: row?.end_time ? `${row.end_time}Z` : null,
    mine: pick >= 0 && pick < size ? pick : null,
  };
}

/** The API's row for one poll, or null while it has not read the poll. */
export async function fetchOpenPoll(author, permlink) {
  const qs = `author=eq.${encodeURIComponent(author)}&permlink=eq.${encodeURIComponent(permlink)}`;
  const res = await fetch(`${POLLS_API_URL}/rpc/poll?${qs}`);
  if (!res.ok) throw new Error(`poll: ${res.status}`);
  const rows = await res.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

/** Vote (option index from 0) as `user`: one `polls` custom_json on Hive. */
export async function votePoll(author, permlink, choice) {
  const json = JSON.stringify({ poll: `${author}/${permlink}`, action: 'vote', choices: [choice + 1] });
  const r = await customJsonWithAioha(KeyTypes.Posting, 'polls', json, 'Vote in a poll');
  if (r && r.success === false) throw new Error('vote rejected');
  return r;
}

/** The result after `user` picked `choice`, before the API has read the vote. */
export function withVote(result, choice) {
  const counts = [...result.counts];
  if (result.mine !== null && result.mine !== undefined && counts[result.mine] > 0) counts[result.mine] -= 1;
  counts[choice] += 1;
  return { ...result, counts, total: counts.reduce((a, b) => a + b, 0), mine: choice };
}

/** A creator's polls, newest first, with their results (the API's own list). */
export async function fetchCreatorPolls(owner) {
  const res = await fetch(`${POLLS_API_URL}/rpc/poll?author=eq.${encodeURIComponent(owner)}&order=created.desc&limit=20`);
  if (!res.ok) throw new Error(`creator polls: ${res.status}`);
  const rows = await res.json();
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const choices = [...(row.poll_choices || [])].sort((a, b) => a.choice_num - b.choice_num);
    const result = resultFromApi(row, choices.length, null);
    return {
      key: `${row.author}/${row.permlink}`,
      author: row.author,
      permlink: row.permlink,
      question: row.question || row.post_title || '',
      options: choices.map((c) => c.choice_text),
      counts: result.counts,
      total: result.total,
      closed: result.closed,
    };
  });
}

const resultKey = (key, user) => ['poll-result', key, user || null];

/** One poll's tally (and the viewer's vote), plus `vote(choice)` that updates it. */
export function usePoll(snap, user) {
  const qc = useQueryClient();
  const key = snap?.poll ? pollKey(snap) : null;
  const size = snap?.poll?.options?.length || 0;
  const { data, isLoading } = useQuery({
    queryKey: resultKey(key, user),
    enabled: !!key,
    staleTime: 30 * 1000,
    retry: 1,
    queryFn: async () => resultFromApi(await fetchOpenPoll(snap.owner, snap.permlink), size, user),
  });
  const vote = async (choice) => {
    await votePoll(snap.owner, snap.permlink, choice);
    const before = qc.getQueryData(resultKey(key, user)) || resultFromApi(null, size, user);
    const after = withVote(before, choice);
    qc.setQueryData(resultKey(key, user), after);
    return after;
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
