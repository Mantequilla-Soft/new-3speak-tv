// 24h stories: shorts posted with the "Story" entry of the share menu. They sit at
// the front of the stories row, reach followers as an injected notification, and
// play a placeholder in the embed once they expire. The checker owns the data
// (routes/stories.js); this module is the client side of it.
import { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { STORIES_URL } from '../utils/config';
import { useAppStore } from './store';
import {
  signMessageWithAioha,
  getCurrentProvider,
  isManteAuthLogin,
  establishWalletSession,
  KeyTypes,
  Providers,
} from '../hive-api/aioha';
import { t } from '../i18n';

// ─── Seen, on this device ───────────────────────────────────────────────────
// The checker answers "seen" from watch_history, which is only written while the
// viewer keeps watch history on. This local list covers the rest, and makes a
// story turn seen the moment it is opened instead of on the next poll.
const SEEN_KEY = '3speak_seen_stories';
const SEEN_EVENT = '3speak-stories-seen';
const SEEN_MAX_AGE_MS = 48 * 60 * 60 * 1000; // a story is gone after 24h anyway

const storyKey = (owner, permlink) => `${owner}/${permlink}`;

function readSeen() {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

export function isStorySeenLocally(owner, permlink) {
  return !!readSeen()[storyKey(owner, permlink)];
}

/** Mark a story seen. Takes the ASSET permlink or the Hive one; both are stored by callers that know them. */
export function markStorySeen(owner, ...permlinks) {
  const seen = readSeen();
  const now = Date.now();
  let changed = false;
  for (const p of permlinks) {
    if (!owner || !p || seen[storyKey(owner, p)]) continue;
    seen[storyKey(owner, p)] = now;
    changed = true;
  }
  if (!changed) return;
  for (const [k, at] of Object.entries(seen)) {
    if (now - at > SEEN_MAX_AGE_MS) delete seen[k];
  }
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch { /* private mode */ }
  window.dispatchEvent(new Event(SEEN_EVENT));
}

// Re-render on a change from this tab (event) or another one (storage).
function useSeenVersion() {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    const onStorage = (e) => { if (e.key === SEEN_KEY) bump(); };
    window.addEventListener(SEEN_EVENT, bump);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(SEEN_EVENT, bump);
      window.removeEventListener('storage', onStorage);
    };
  }, []);
  return version;
}

// ─── The stories row ────────────────────────────────────────────────────────

/**
 * Creators with a live story, unseen first: [{ username, story_count, unseen_count,
 * latest_at, followed, streak }]. `streak` is days in a row with a story.
 */
export function useStoryCreators() {
  const { user, showNsfw } = useAppStore();
  const { data, isLoading } = useQuery({
    queryKey: ['stories', user, showNsfw],
    queryFn: async () => {
      const params = {};
      if (user) params.currentuser = user;
      if (showNsfw) params.nsfw = 'true';
      return (await axios.get(STORIES_URL, { params })).data;
    },
    staleTime: 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });
  return {
    storyCreators: data?.creators || [],
    currentUserHasStory: !!data?.currentUserHasStory,
    currentUserStreak: Number(data?.currentUserStreak) || 0,
    isLoading,
  };
}

// ─── Notifications ──────────────────────────────────────────────────────────

/**
 * Live stories from the accounts `user` follows, newest first, each with `seen`.
 * Not Hive notifications: nothing is on chain, so they are injected next to the
 * Hive list and carry their own seen state.
 */
export function useStoryNotifications(user) {
  const showNsfw = useAppStore((s) => s.showNsfw);
  const seenVersion = useSeenVersion();
  const { data } = useQuery({
    queryKey: ['story-notifications', user, showNsfw],
    enabled: !!user,
    queryFn: async () => {
      const params = { currentuser: user };
      if (showNsfw) params.nsfw = 'true';
      return (await axios.get(`${STORIES_URL}/following`, { params })).data;
    },
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });

  // The checker only returns live stories, and this refetches every minute.
  const stories = (data?.stories || [])
    .map((s) => ({
      ...s,
      seen: s.seen || isStorySeenLocally(s.owner, s.permlink) || isStorySeenLocally(s.owner, s.hive_permlink),
    }));
  // seenVersion only exists to recompute the above after markStorySeen().
  void seenVersion;

  return { stories, unseenCount: stories.filter((s) => !s.seen).length };
}

// ─── The countdown ring ─────────────────────────────────────────────────────

/** Share of the story's life still left, 0..1: the ring draws this much of its circle. */
export function storyTimeLeft(postedAt, expiresAt, now) {
  const start = new Date(postedAt).getTime();
  const end = new Date(expiresAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 1;
  return Math.min(1, Math.max(0, (end - now) / (end - start)));
}

/** A clock that ticks once a minute, so countdown rings shrink while a page stays open. */
export function useStoryClock(intervalMs = 60 * 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Where a story opens: the creator's live stories in the stories viewer. */
export const storyViewerPath = (owner) => `/shorts/stories?user=${encodeURIComponent(owner)}&story=1`;

/** Refresh every story list after the viewer watched one. */
export function useInvalidateStories() {
  const queryClient = useQueryClient();
  return useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['stories'] });
    queryClient.invalidateQueries({ queryKey: ['story-notifications'] });
  }, [queryClient]);
}

// ─── Publishing ─────────────────────────────────────────────────────────────

/**
 * Tell the checker that a just-published post is a story. The post itself carries
 * the flag (json_metadata['3speak'].story), so this needs no signature; the
 * checker reads it back from Hive. A fresh post can take a few blocks to become
 * readable, hence the retries.
 */
export async function registerStory(author, permlink, { attempts = 6, delayMs = 3000 } = {}) {
  let lastError = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await axios.post(`${STORIES_URL}/register`, { author, permlink }, { timeout: 15000 });
      if (res.data?.success) return res.data.story;
      lastError = new Error(res.data?.error || 'register failed');
    } catch (err) {
      lastError = err;
      // Only "not readable yet" is worth waiting for; a 400/403 will not change.
      if (!err.response?.data?.retry && err.response?.status && err.response.status < 500) throw err;
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw lastError || new Error('register failed');
}

// ─── The poster's own tools ─────────────────────────────────────────────────

/** A streak worth showing: one day is just a story. */
export const STREAK_MIN = 2;

/**
 * The user's story streak: { streak, postedToday }. A streak counts days in a row
 * with a story and survives until a day passes with none, so `postedToday` false
 * with a streak means today's story keeps it going.
 */
export function useStoryStreak(user) {
  const { data } = useQuery({
    queryKey: ['story-streak', user],
    enabled: !!user,
    queryFn: async () => (await axios.get(`${STORIES_URL}/streak/${encodeURIComponent(user)}`)).data,
    staleTime: 60 * 1000,
  });
  return { streak: Number(data?.streak) || 0, postedToday: !!data?.postedToday };
}

/**
 * Who watched a story: { count, viewers: [{ username, at }] }, newest first.
 * Read from watch history, so only signed-in viewers who keep it on are listed.
 */
export function useStorySeenBy(author, hivePermlink, enabled = true) {
  const { data, isLoading } = useQuery({
    queryKey: ['story-seen', author, hivePermlink],
    enabled: !!author && !!hivePermlink && enabled,
    queryFn: async () => (await axios.get(`${STORIES_URL}/seen`, { params: { author, permlink: hivePermlink } })).data,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });
  return { count: Number(data?.count) || 0, viewers: data?.viewers || [], isLoading };
}

// Must match keepMessage() in 3speakchecks/routes/stories.js and the signer in
// server/index.cjs exactly.
const keepMessage = (author, permlink, timestamp) =>
  ['3speak-stories', 'keep', author, permlink, String(timestamp)].join('|');

const THREESPEAK_API = import.meta.env.VITE_THREESPEAK_API || '/api';
const SIGN_CAPABLE_PROVIDERS = new Set([Providers.Keychain, Providers.HiveAuth, Providers.PeakVault, Providers.Ledger]);
const canSignLocally = () => !isManteAuthLogin() && SIGN_CAPABLE_PROVIDERS.has(getCurrentProvider());

// Signing follows the comment pins (lib/commentPins.js): @threespeak signs under
// the grant most authors gave it, and a wallet that can sign does it itself when
// that grant is missing.
async function signKeepViaThreespeak(account, permlink) {
  const provider = getCurrentProvider();
  const isWallet = !!provider && provider !== Providers.HiveSigner && !isManteAuthLogin();
  const doPost = async () => {
    const headers = { 'Content-Type': 'application/json' };
    if (provider === Providers.HiveSigner) {
      const token = localStorage.getItem('hivesignerToken');
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    const r = await fetch(`${THREESPEAK_API}/stories/keep-signature`, {
      method: 'POST', headers, credentials: 'include',
      body: JSON.stringify({ permlink, username: account }),
    });
    return { r, d: await r.json().catch(() => ({})) };
  };
  let { r, d } = await doPost();
  if (isWallet && r.status === 401 && d?.reason === 'not_signed_in_as' && await establishWalletSession(account)) {
    ({ r, d } = await doPost());
  }
  if (!r.ok || !d.signature) throw new Error(d.error || t('shorts.storyTools.keepFailed'));
  if (d.username && String(d.username).toLowerCase() !== String(account).toLowerCase()) {
    throw new Error(t('shorts.storyTools.keepFailed'));
  }
  return { signature: d.signature, timestamp: d.timestamp };
}

async function signKeepLocally(account, permlink) {
  const timestamp = Date.now();
  const res = await signMessageWithAioha(keepMessage(account, permlink, timestamp), KeyTypes.Posting, t('shorts.storyTools.keepWalletPrompt'));
  if (!res?.success || !res.result) throw new Error(t('shorts.storyTools.keepFailed'));
  return { signature: res.result, timestamp };
}

/**
 * Turn the author's own live story into an ordinary short that stays. Takes the
 * HIVE permlink. Only a live story can be kept; the checker refuses an expired one.
 */
export async function keepStoryAsShort(author, hivePermlink) {
  let signed;
  try {
    signed = await signKeepViaThreespeak(author, hivePermlink);
  } catch (err) {
    if (!canSignLocally()) throw err;
    signed = await signKeepLocally(author, hivePermlink);
  }
  const res = await fetch(`${STORIES_URL}/keep`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ author, permlink: hivePermlink, ...signed }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.success) throw new Error(d.error || t('shorts.storyTools.keepFailed'));
  return d.kept;
}
