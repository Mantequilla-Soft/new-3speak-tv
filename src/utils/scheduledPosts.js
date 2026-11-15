// Shared client for the checker's scheduled-posts API.
//
// Scheduled posts are videos whose file is already uploaded to the embed service
// but whose Hive broadcast is deferred — the checker stores the fully-built post
// and a 5-minute cron broadcasts it as @threespeak at the due time. Until then
// the post is NOT on Hive, so it can only be read/edited through these endpoints.
//
// Endpoints (all on the checker, VITE_SCHEDULED_POSTS_API_URL):
//   GET  /scheduled-posts/:owner?status=scheduled   → { scheduled_posts: [...] }
//   POST /scheduled-posts/update                     (used by EditScheduledPost)
//   POST /scheduled-posts/cancel                     (used by EditScheduledPost)
//
// Drafts live in the same store: a post created with `draft: true` has no time
// and status "draft", and POST /scheduled-posts/publish gives it one (the current
// time = out at the cron's next run). Video and audio alike: an audio draft
// names its upload (`audioPermlink`), which the checker keeps out of the audio
// lists until the post is out.

import axios from 'axios';
import { CHECKER_API_KEY } from './config';

// Loaded on a write only: the proof brings the wallet code along, which the
// readers here (cards, the studio list) do not need.
const prove = async (args) => (await import('./scheduledPostProof')).proveScheduledPost(args);

export const SCHEDULED_CHECKER_BASE = (
  import.meta.env.VITE_SCHEDULED_POSTS_API_URL || 'https://prod-checker.okinoko.io'
).replace(/\/$/, '');

/** All of a user's still-scheduled posts (most are a handful; cap at 100). */
export async function fetchScheduledPosts(owner) {
  if (!owner) return [];
  try {
    const res = await axios.get(
      `${SCHEDULED_CHECKER_BASE}/scheduled-posts/${encodeURIComponent(owner)}`,
      { params: { status: 'scheduled', limit: 100 } },
    );
    return Array.isArray(res.data?.scheduled_posts) ? res.data.scheduled_posts : [];
  } catch (err) {
    console.warn('[scheduledPosts] fetch list failed', err);
    return [];
  }
}

/** A single scheduled post by (owner, permlink), or null. */
export async function fetchScheduledPost(owner, permlink) {
  if (!owner || !permlink) return null;
  const all = await fetchScheduledPosts(owner);
  return all.find((p) => p.permlink === permlink) || null;
}

/**
 * The playable embed reference (owner/permlink) for a scheduled post.
 *
 * The player resolves the embed *asset*, not the Hive post (which isn't linked
 * until publish). For embed-studio uploads the asset is created with the SAME
 * permlink as the Hive post (`generatedPermlink` is used for both — see
 * EmbedUploadContext), so the Hive permlink resolves the asset. We still prefer
 * the explicit embed URL / embedPermlink when the full doc carries them (e.g. a
 * future single-doc endpoint), then fall back to owner/permlink — the only
 * fields the list endpoint returns.
 *
 * @returns {{ owner: string, permlink: string } | null}
 */
export function getScheduledEmbedRef(doc) {
  if (!doc) return null;
  const url = doc.jsonMetadata?.video?.url || doc.embedUrl || null;
  if (url) {
    try {
      const v = new URL(url).searchParams.get('v');
      if (v && v.includes('/')) {
        const [owner, permlink] = v.split('/');
        if (owner && permlink) return { owner, permlink };
      }
    } catch { /* fall through */ }
  }
  if (doc.embedPermlink && doc.owner) {
    return { owner: doc.owner, permlink: doc.embedPermlink };
  }
  // List-endpoint fallback: embed asset permlink === Hive permlink for these uploads.
  if (doc.owner && doc.permlink) {
    return { owner: doc.owner, permlink: doc.permlink };
  }
  return null;
}

/**
 * Shape a scheduled doc into the object Card3 expects. Reuses Card3's existing
 * scheduled status badge (`status==='scheduled' && publish_type==='schedule'`)
 * and the `_scheduled` marker so Card3 can point the card at the watch page in
 * scheduled mode.
 */
export function normalizeScheduledForCard(doc) {
  return {
    _id: `scheduled:${doc.id ?? doc.permlink}`,
    _scheduled: true,
    id: doc.id,
    owner: doc.owner,
    author: doc.owner,
    permlink: doc.permlink,
    title: doc.title || '(untitled)',
    description: doc.description || '',
    thumbnail: doc.thumbnail || null,
    // Card3 reads spkvideo for the thumbnail + duration overlay.
    spkvideo: { thumbnail_url: doc.thumbnail || null, duration: 0 },
    status: 'scheduled',
    publish_type: 'schedule',     // triggers Card3's scheduled badge
    publish_data: doc.scheduledOn, // badge shows this date
    scheduledOn: doc.scheduledOn,
    created_at: doc.createdAt,
  };
}

const authHeaders = () => (CHECKER_API_KEY ? { Authorization: `Bearer ${CHECKER_API_KEY}` } : {});

/** A user's drafts (newest first). [] on any failure. */
export async function fetchDrafts(owner) {
  if (!owner) return [];
  try {
    const res = await axios.get(
      `${SCHEDULED_CHECKER_BASE}/scheduled-posts/${encodeURIComponent(owner)}`,
      { params: { status: 'draft', limit: 100 } },
    );
    const list = Array.isArray(res.data?.scheduled_posts) ? res.data.scheduled_posts : [];
    return [...list].sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
  } catch (err) {
    console.warn('[scheduledPosts] fetch drafts failed', err);
    return [];
  }
}

/**
 * Save a fully built post as a draft (or, with `scheduledOn`, as a scheduled
 * post). `post` is the create body without owner/permlink/proof:
 * { title, description, body, tags, jsonMetadata, beneficiaries, payoutOptions,
 *   thumbnail, parentAuthor, parentPermlink, embedPermlink?, audioPermlink?,
 *   playlistAdd?, reblog? }. Resolves the checker's answer; throws on failure.
 */
export async function saveScheduledPost({ owner, permlink, scheduledOn = null, post }) {
  const draft = !scheduledOn;
  const proof = await prove(draft
    ? { action: 'draft', owner, permlink }
    : { action: 'create', owner, permlink, scheduledOn });
  const res = await axios.post(`${SCHEDULED_CHECKER_BASE}/scheduled-posts/create`, {
    ...proof,
    ...post,
    owner,
    permlink,
    ...(draft ? { draft: true } : { scheduledOn }),
  }, { headers: authHeaders() });
  if (res.status !== 201 || !res.data?.success) throw new Error(res.data?.error || 'not saved');
  return res.data;
}

/** A draft goes out: now (scheduledOn = the current time) or at a later time. */
export async function publishDraft({ owner, permlink, scheduledOn = new Date().toISOString() }) {
  const proof = await prove({ action: 'publish', owner, permlink, scheduledOn });
  const res = await axios.post(`${SCHEDULED_CHECKER_BASE}/scheduled-posts/publish`, {
    ...proof, owner, permlink, scheduledOn,
  }, { headers: authHeaders() });
  if (!res.data?.success) throw new Error(res.data?.error || 'not published');
  return res.data;
}

/** Throw a draft away (the checker marks it cancelled). */
export async function deleteDraft({ owner, permlink }) {
  const proof = await prove({ action: 'cancel', owner, permlink });
  const res = await axios.post(`${SCHEDULED_CHECKER_BASE}/scheduled-posts/cancel`, {
    ...proof, owner, permlink,
  }, { headers: authHeaders() });
  if (!res.data?.success) throw new Error(res.data?.error || 'not deleted');
  return res.data;
}
