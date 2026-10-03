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
import { t as translate } from '../i18n';

export const TAG_CATEGORIES = [
  {
    slug: 'tech-science', labelKey: 'tags.labels.tech-science', emoji: '🔬',
    topics: [
      { slug: 'technology', labelKey: 'tags.labels.technology', emoji: '💻' },
      { slug: 'education', labelKey: 'tags.labels.education', emoji: '🎓' },
      { slug: 'science', labelKey: 'tags.labels.science', emoji: '🧪' },
      { slug: 'programming', labelKey: 'tags.labels.programming', emoji: '⌨️' },
    ],
  },
  {
    slug: 'crypto-finance', labelKey: 'tags.labels.crypto-finance', emoji: '💰',
    topics: [
      { slug: 'cryptocurrency', labelKey: 'tags.labels.cryptocurrency', emoji: '🪙' },
      { slug: 'finance', labelKey: 'tags.labels.finance', emoji: '📈' },
      { slug: 'business', labelKey: 'tags.labels.business', emoji: '💼' },
    ],
  },
  {
    slug: 'entertainment', labelKey: 'tags.labels.entertainment', emoji: '🎬',
    topics: [
      { slug: 'music', labelKey: 'tags.labels.music', emoji: '🎵' },
      { slug: 'gaming', labelKey: 'tags.labels.gaming', emoji: '🎮' },
      { slug: 'film-tv', labelKey: 'tags.labels.film-tv', emoji: '🎞️' },
      { slug: 'lifestyle', labelKey: 'tags.labels.lifestyle', emoji: '✨' },
      // Viewer-only addition (see VIEWER_EXTRA_TAGS below) — carried over from the
      // v1 interest list because people tag a lot of content as "vlog".
      { slug: 'vlog', labelKey: 'tags.labels.vlog', emoji: '🎥' },
      { slug: 'comedy', labelKey: 'tags.labels.comedy', emoji: '😂' },
      { slug: 'story-time', labelKey: 'tags.labels.story-time', emoji: '📖' },
      { slug: 'commercial', labelKey: 'tags.labels.commercial', emoji: '📺' },
    ],
  },
  {
    slug: 'arts-diy', labelKey: 'tags.labels.arts-diy', emoji: '🎨',
    topics: [
      { slug: 'art', labelKey: 'tags.labels.art', emoji: '🖼️' },
      { slug: 'diy-crafts', labelKey: 'tags.labels.diy-crafts', emoji: '🛠️' },
      { slug: 'photography', labelKey: 'tags.labels.photography', emoji: '📷' },
    ],
  },
  {
    slug: 'food-outdoor', labelKey: 'tags.labels.food-outdoor', emoji: '🌿',
    topics: [
      { slug: 'nature', labelKey: 'tags.labels.nature', emoji: '🌲' },
      { slug: 'travel', labelKey: 'tags.labels.travel', emoji: '✈️' },
      { slug: 'food', labelKey: 'tags.labels.food', emoji: '🍜' },
      { slug: 'pets', labelKey: 'tags.labels.pets', emoji: '🐾' },
      { slug: 'gardening', labelKey: 'tags.labels.gardening', emoji: '🌱' },
    ],
  },
  {
    slug: 'sports-health', labelKey: 'tags.labels.sports-health', emoji: '🏅',
    topics: [
      { slug: 'sports', labelKey: 'tags.labels.sports', emoji: '⚽' },
      { slug: 'health', labelKey: 'tags.labels.health', emoji: '🩺' },
      { slug: 'fitness', labelKey: 'tags.labels.fitness', emoji: '💪' },
    ],
  },
  {
    slug: 'life-society', labelKey: 'tags.labels.life-society', emoji: '🌍',
    topics: [
      { slug: 'news', labelKey: 'tags.labels.news', emoji: '📰' },
      { slug: 'spirituality', labelKey: 'tags.labels.spirituality', emoji: '🕊️' },
      { slug: 'politics', labelKey: 'tags.labels.politics', emoji: '🏛️' },
    ],
  },
];

/** Every topic, flattened (categories excluded) — for flat pickers like Interests. */
export const ALL_TOPICS = TAG_CATEGORIES.flatMap((c) =>
  c.topics.map((t) => ({ ...t, category: c.slug, categoryLabelKey: c.labelKey })));

export const ALL_TOPIC_SLUGS = ALL_TOPICS.map((t) => t.slug);

/** Flat option list shaped like the retired v1 INTERESTS ({ id, labelKey, emoji }),
 *  so flat pickers (Interests) can use the v2 vocabulary unchanged. */
export const TAG_OPTIONS = ALL_TOPICS.map((t) => ({
  id: t.slug, labelKey: t.labelKey, emoji: t.emoji, category: t.category,
}));

// Slugs the VIEWER can pick that the auto-tagger never emits. Everything else in
// the tree above mirrors the backend vocabulary exactly.
export const VIEWER_EXTRA_TAGS = new Set(['vlog']);

// slug → { slug, labelKey, emoji, isCategory, category } for every pickable slug.
// Labels are i18n KEYS (translate at render: t(x.labelKey)); slugs are on-chain data.
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
export const getTagLabel = (slug) => {
  const key = BY_SLUG.get(slug)?.labelKey;
  return key ? translate(key) : slug;
};

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
