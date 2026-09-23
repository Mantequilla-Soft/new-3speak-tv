// Video tags v2 — the new closed-vocabulary taxonomy assigned by the background
// tagger (see TAGS_V2_FRONTEND.md). A 2-level tree: 7 broad CATEGORIES, 27 TOPICS.
//
// Two things worth knowing:
//  1. A video's tag list may contain a CATEGORY slug instead of a topic. That's
//     intentional and correct — it means "definitely this area, not sure which
//     topic". Display it normally with the category label.
//  2. The BACKEND vocabulary is CLOSED: the tagger only ever emits the 34 slugs
//     from TAGS_V2_FRONTEND.md (27 topics + 7 categories), so a strict
//     slug → label/emoji map is safe and anything else is ignored.
//
// ⚠️ This tree intentionally contains a few EXTRA slugs the tagger never emits
// (VIEWER_EXTRA_TAGS) — they exist so viewers can pick them in the vote dialog.
// They are valid viewer tags but will never appear in `tags_list_v2`. Keep them
// listed below so a future sync with the backend vocabulary doesn't "fix" them
// away by mistake.
//
// The app now uses v2 EVERYWHERE (pickers, interests, topic chips). The old v1
// interest list is retired — utils/interests.js keeps only the Hive read/write
// helpers plus displayTag, which falls back to this taxonomy.
import axios from 'axios';
import { CHECKER_URL } from './config';

export const TAG_CATEGORIES = [
  {
    slug: 'tech-science', label: 'Tech & Science', emoji: '🔬',
    topics: [
      { slug: 'technology', label: 'Technology', emoji: '💻' },
      { slug: 'education', label: 'Education', emoji: '🎓' },
      { slug: 'science', label: 'Science', emoji: '🧪' },
      { slug: 'programming', label: 'Programming', emoji: '⌨️' },
    ],
  },
  {
    slug: 'crypto-finance', label: 'Crypto & Finance', emoji: '💰',
    topics: [
      { slug: 'cryptocurrency', label: 'Cryptocurrency', emoji: '🪙' },
      { slug: 'finance', label: 'Finance', emoji: '📈' },
      { slug: 'business', label: 'Business', emoji: '💼' },
    ],
  },
  {
    slug: 'entertainment', label: 'Entertainment', emoji: '🎬',
    topics: [
      { slug: 'music', label: 'Music', emoji: '🎵' },
      { slug: 'gaming', label: 'Gaming', emoji: '🎮' },
      { slug: 'film-tv', label: 'Film & TV', emoji: '🎞️' },
      { slug: 'lifestyle', label: 'Lifestyle', emoji: '✨' },
      // Viewer-only addition (see VIEWER_EXTRA_TAGS below) — carried over from the
      // v1 interest list because people tag a lot of content as "vlog".
      { slug: 'vlog', label: 'Vlog', emoji: '🎥' },
      { slug: 'comedy', label: 'Comedy', emoji: '😂' },
      { slug: 'story-time', label: 'Story Time', emoji: '📖' },
      { slug: 'commercial', label: 'Commercial', emoji: '📺' },
    ],
  },
  {
    slug: 'arts-diy', label: 'Arts & DIY', emoji: '🎨',
    topics: [
      { slug: 'art', label: 'Art', emoji: '🖼️' },
      { slug: 'diy-crafts', label: 'DIY & Crafts', emoji: '🛠️' },
      { slug: 'photography', label: 'Photography', emoji: '📷' },
    ],
  },
  {
    slug: 'food-outdoor', label: 'Food & Outdoors', emoji: '🌿',
    topics: [
      { slug: 'nature', label: 'Nature', emoji: '🌲' },
      { slug: 'travel', label: 'Travel', emoji: '✈️' },
      { slug: 'food', label: 'Food', emoji: '🍜' },
      { slug: 'pets', label: 'Pets', emoji: '🐾' },
      { slug: 'gardening', label: 'Gardening', emoji: '🌱' },
    ],
  },
  {
    slug: 'sports-health', label: 'Sports & Health', emoji: '🏅',
    topics: [
      { slug: 'sports', label: 'Sports', emoji: '⚽' },
      { slug: 'health', label: 'Health', emoji: '🩺' },
      { slug: 'fitness', label: 'Fitness', emoji: '💪' },
    ],
  },
  {
    slug: 'life-society', label: 'Life & Society', emoji: '🌍',
    topics: [
      { slug: 'news', label: 'News', emoji: '📰' },
      { slug: 'spirituality', label: 'Spirituality', emoji: '🕊️' },
      { slug: 'politics', label: 'Politics', emoji: '🏛️' },
    ],
  },
];

/** Every topic, flattened (categories excluded) — for flat pickers like Interests. */
export const ALL_TOPICS = TAG_CATEGORIES.flatMap((c) =>
  c.topics.map((t) => ({ ...t, category: c.slug, categoryLabel: c.label })));

export const ALL_TOPIC_SLUGS = ALL_TOPICS.map((t) => t.slug);

/** Flat option list shaped like the retired v1 INTERESTS ({ id, label, emoji }),
 *  so flat pickers (Interests) can use the v2 vocabulary unchanged. */
export const TAG_OPTIONS = ALL_TOPICS.map((t) => ({
  id: t.slug, label: t.label, emoji: t.emoji, category: t.category,
}));

// Slugs the VIEWER can pick that the auto-tagger never emits. Everything else in
// the tree above mirrors the backend vocabulary exactly.
export const VIEWER_EXTRA_TAGS = new Set(['vlog']);

// slug → { slug, label, emoji, isCategory, category } for every pickable slug.
const BY_SLUG = new Map();
for (const cat of TAG_CATEGORIES) {
  BY_SLUG.set(cat.slug, { ...cat, isCategory: true, category: cat.slug });
  for (const topic of cat.topics) {
    BY_SLUG.set(topic.slug, { ...topic, isCategory: false, category: cat.slug });
  }
}

/** True for slugs the tagger can actually produce (i.e. excludes viewer extras). */
export const isAutoTaggerSlug = (slug) => BY_SLUG.has(slug) && !VIEWER_EXTRA_TAGS.has(slug);

/** Is this slug one of the 7 broad categories (rather than a topic)? */
export const isCategorySlug = (slug) => BY_SLUG.get(slug)?.isCategory === true;

/** Part of the closed vocabulary? Anything else is a bug — ignore it. */
export const isKnownTag = (slug) => BY_SLUG.has(slug);

/** Display label for a slug. Falls back to the raw slug so unknown values still render. */
export const getTagLabel = (slug) => BY_SLUG.get(slug)?.label || slug;

export const getTagEmoji = (slug) => BY_SLUG.get(slug)?.emoji || '';

/** The category slug a tag rolls up to (a category returns itself). */
export const getCategoryOf = (slug) => BY_SLUG.get(slug)?.category || null;

// Which picker the vote dialog shows depends on this lookup, so it has to be
// known BEFORE the dialog opens — otherwise the v1 tiles flash and swap. Results
// are cached per video (tags are derived data that only change on re-tagging) and
// in-flight requests are de-duped, so a prefetch + the dialog share one request.
const cache = new Map(); // "author/permlink" -> { tags, model }
const inflight = new Map();
const cacheKey = (author, permlink) => `${author}/${permlink}`;

/** Cached result, or undefined if we haven't looked this video up yet. Sync. */
export function getCachedTagsV2(author, permlink) {
  if (!author || !permlink) return undefined;
  return cache.get(cacheKey(author, permlink));
}

/**
 * The v2 tags the tagger assigned to a video, via the checker (which resolves the
 * hive→asset permlink mapping). Returns `{ tags, model, aiGenerated }`; `tags` is
 * [] when the video was never processed OR analysed with no confident result —
 * both are "untagged" for display. Never throws.
 *
 * `aiGenerated` comes from the same pipeline's AI-generation detection and is only
 * ever true when the checker says so explicitly: a video the detector has not
 * reached yet, and one that errored, both read false. It drives <AiBadge/>.
 */
export async function getVideoTagsV2(author, permlink) {
  if (!author || !permlink) return { tags: [], model: null, aiGenerated: false };
  const key = cacheKey(author, permlink);
  const hit = cache.get(key);
  if (hit) return hit;
  if (inflight.has(key)) return inflight.get(key);

  const req = (async () => {
    try {
      const res = await axios.get(
        `${CHECKER_URL}/transcription-tags/${encodeURIComponent(author)}/${encodeURIComponent(permlink)}`
      );
      const tags = Array.isArray(res.data?.tagsV2) ? res.data.tagsV2.filter(isKnownTag) : [];
      const out = {
        tags,
        model: res.data?.tagModelV2 || null,
        aiGenerated: res.data?.aiGenerated === true,
      };
      cache.set(key, out); // only cache real answers, so a failure can be retried
      return out;
    } catch {
      return { tags: [], model: null, aiGenerated: false };
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, req);
  return req;
}

/**
 * Warm the cache while the page is loading, so the vote dialog knows which picker
 * to draw the moment it opens. Fire-and-forget.
 */
export function prefetchVideoTagsV2(author, permlink) {
  if (!author || !permlink) return;
  const key = cacheKey(author, permlink);
  if (cache.has(key) || inflight.has(key)) return;
  getVideoTagsV2(author, permlink).catch(() => {});
}
