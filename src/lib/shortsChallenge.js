// 🏁 Weekly Shorts challenge: one theme per week, Sunday 00:00 UTC to Saturday
// 23:59 UTC (owner 2026-11-22), named after the ISO week of its Monday
// ('2026-W48' = Sunday 2026-11-22 to Saturday 2026-11-28). The themes and their prompts live in the checker's Mongo
// (`shorts_challenges`, edited by the team), and so do the entries
// (`shorts_challenge_entries`): a Short joins by carrying the week's tag
// (`challenge2026w48`), and it shows up and counts only once the team has checked
// it (owner 2026-11-22). No votes and no prizes: the theme is the reason to post.
//
// Checker API (3speakchecks routes/shortsChallenges.js):
//   GET /shorts-challenges                  { week, current, next, past[] }
//   GET /shorts-challenges/:week            { challenge }
//   GET /shorts-challenges/:week/entries    the checked entries, tag-feed shape
// A challenge: { week, tag, theme, texts: { en: { title, prompt }, de: ... },
//                starts_at, ends_at, entries } (entries = checked count)

import { useQuery } from '@tanstack/react-query';
import { CHECKER_URL } from '../utils/config';
import { getLanguage } from '../i18n';

const STALE_MS = 5 * 60 * 1000;

async function getJson(path) {
  const res = await fetch(`${CHECKER_URL}${path}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`checker ${res.status}`);
  return res.json();
}

/** This week, next week and the weeks before: { week, current, next, past }. */
export async function fetchChallenges() {
  const data = await getJson('/shorts-challenges');
  return { week: data?.week || null, current: data?.current || null, next: data?.next || null, past: data?.past || [] };
}

/** One week's challenge, or null when there is none. */
export async function fetchChallenge(weekId) {
  const data = await getJson(`/shorts-challenges/${encodeURIComponent(weekId)}`);
  return data?.challenge || null;
}

/** A week's checked entries: { total, totalPages, videos }. */
export async function fetchChallengeEntries(weekId, { page = 1, limit = 24 } = {}) {
  const data = await getJson(`/shorts-challenges/${encodeURIComponent(weekId)}/entries?page=${page}&limit=${limit}`);
  return { total: data?.total || 0, totalPages: data?.totalPages || 1, videos: data?.videos || [] };
}

/** This week, next week and the weeks before (react-query, shared by every caller). */
export function useShortsChallenges() {
  return useQuery({ queryKey: ['shortsChallenges'], queryFn: fetchChallenges, staleTime: STALE_MS, retry: 1 });
}

/** This week's challenge, or null (none this week, still loading, or the checker is down). */
export function useCurrentChallenge() {
  const { data } = useShortsChallenges();
  return data?.current || null;
}

/** One week's challenge: { data: challenge | null, isLoading }. */
export function useShortsChallenge(weekId, { enabled = true } = {}) {
  return useQuery({
    queryKey: ['shortsChallenge', weekId],
    queryFn: () => fetchChallenge(weekId),
    enabled: enabled && !!weekId,
    staleTime: STALE_MS,
    retry: 1,
  });
}

/**
 * A challenge's title or prompt in the reader's language: the exact code, then
 * its base language ('pt-BR' -> 'pt'), then English.
 */
export function challengeText(challenge, field, lang = getLanguage()) {
  const texts = challenge?.texts || {};
  const code = String(lang || 'en').toLowerCase();
  const pick = texts[code] || texts[code.split('-')[0]] || texts.en || {};
  return pick[field] || '';
}

/** The challenge week a moment falls in, in UTC: '2026-W48' (a Sunday counts with the Monday after it). */
export function weekIdOf(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1));
  const day = d.getUTCDay() || 7; // Monday 1 .. Sunday 7
  d.setUTCDate(d.getUTCDate() + 4 - day); // the Thursday of this week decides the year
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / (24 * 3600 * 1000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** The Hive tag a week's entries carry: '2026-W48' -> 'challenge2026w48'. */
export function tagOf(weekId) {
  return `challenge${String(weekId).replace('-W', 'w').toLowerCase()}`;
}

// "Join with a Short" on /challenge: the Short's details step turns the switch on
// for that week. Per tab, and only a convenience: without storage the switch is
// simply off and the creator turns it on.
const JOIN_KEY = '3speak-challenge-join';
export function rememberJoin(weekId) {
  try { sessionStorage.setItem(JOIN_KEY, String(weekId)); } catch { /* no storage */ }
}
export function takeJoin(weekId) {
  try {
    const v = sessionStorage.getItem(JOIN_KEY);
    if (v) sessionStorage.removeItem(JOIN_KEY);
    return v === weekId;
  } catch { return false; }
}

/** `tags` with the week's tag added (on) or removed (off), keeping the order. */
export function withChallengeTag(tags, weekId, on) {
  const tag = tagOf(weekId);
  const rest = (tags || []).filter((t) => t !== tag);
  return on ? [...rest, tag] : rest;
}
