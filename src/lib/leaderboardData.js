// Leaderboard data layer — talks to the checker's /leaderboard endpoints, which
// serve the pre-aggregated `leaderboard` collection (one row per window+user,
// carrying all five metrics).
import { CHECKER_URL } from '../utils/config';
import { t, formatNumber } from '../i18n';

// labelKey / blurbKey are i18n keys: translate at render (t(m.labelKey)).

export const WINDOWS = [
  { id: '7d', labelKey: 'misc.leaderboard.windows.7d' },
  { id: '30d', labelKey: 'misc.leaderboard.windows.30d' },
  { id: '365d', labelKey: 'misc.leaderboard.windows.365d' },
  { id: 'all', labelKey: 'misc.leaderboard.windows.all' },
];

// `watch` metrics are only tracked from the checker's WATCH_TRACKED_SINCE date;
// the board response flags that per metric via partial_watch_data.
export const METRICS = [
  { id: 'video_uploads', labelKey: 'misc.leaderboard.metrics.video_uploads', unit: 'count', group: 'Video', blurbKey: 'misc.leaderboard.blurbs.video_uploads' },
  { id: 'short_uploads', labelKey: 'misc.leaderboard.metrics.short_uploads', unit: 'count', group: 'Video', blurbKey: 'misc.leaderboard.blurbs.short_uploads' },
  { id: 'video_watch_secs', labelKey: 'misc.leaderboard.metrics.video_watch_secs', unit: 'duration', group: 'Video', blurbKey: 'misc.leaderboard.blurbs.video_watch_secs' },
  { id: 'short_watch_secs', labelKey: 'misc.leaderboard.metrics.short_watch_secs', unit: 'duration', group: 'Video', blurbKey: 'misc.leaderboard.blurbs.short_watch_secs' },
  { id: 'tags_given', labelKey: 'misc.leaderboard.metrics.tags_given', unit: 'count', group: 'Video', blurbKey: 'misc.leaderboard.blurbs.tags_given' },
  // Livestream + boosts. Populated once the stream service calls the checker's
  // /stream-stats/* endpoints; until then these boards read empty (all zeros).
  { id: 'streams', labelKey: 'misc.leaderboard.metrics.streams', unit: 'count', group: 'Streaming', blurbKey: 'misc.leaderboard.blurbs.streams' },
  { id: 'stream_secs', labelKey: 'misc.leaderboard.metrics.stream_secs', unit: 'duration', group: 'Streaming', blurbKey: 'misc.leaderboard.blurbs.stream_secs' },
  { id: 'stream_peak_viewers', labelKey: 'misc.leaderboard.metrics.stream_peak_viewers', unit: 'count', group: 'Streaming', blurbKey: 'misc.leaderboard.blurbs.stream_peak_viewers' },
  { id: 'stream_viewers', labelKey: 'misc.leaderboard.metrics.stream_viewers', unit: 'count', group: 'Streaming', blurbKey: 'misc.leaderboard.blurbs.stream_viewers' },
  { id: 'boosts_received', labelKey: 'misc.leaderboard.metrics.boosts_received', unit: 'count', group: 'Streaming', blurbKey: 'misc.leaderboard.blurbs.boosts_received' },
  { id: 'boost_amount_received', labelKey: 'misc.leaderboard.metrics.boost_amount_received', unit: 'amount', group: 'Streaming', blurbKey: 'misc.leaderboard.blurbs.boost_amount_received' },
  { id: 'boosts_given', labelKey: 'misc.leaderboard.metrics.boosts_given', unit: 'count', group: 'Streaming', blurbKey: 'misc.leaderboard.blurbs.boosts_given' },
  { id: 'boost_amount_given', labelKey: 'misc.leaderboard.metrics.boost_amount_given', unit: 'amount', group: 'Streaming', blurbKey: 'misc.leaderboard.blurbs.boost_amount_given' },
];

// Metric groups, in tab order. Drives the grouped metric selector on the board.
export const METRIC_GROUPS = ['Video', 'Streaming'];
// Group ids above are compared against METRICS[].group; display via these keys.
export const METRIC_GROUP_LABEL_KEYS = {
  Video: 'misc.leaderboard.groups.video',
  Streaming: 'misc.leaderboard.groups.streaming',
};

// The metric tabs are the SAME list whether or not a topic is selected — the
// labels must never change under the user. The four content metrics exist on
// both the overall board and the per-topic boards (same field names), so picking
// a topic just re-points the query, it doesn't redefine the choices.
//
// `tags_given` is the exception: tags aren't tracked per topic, so when it's the
// selected metric there is no topic board to show and the topic row hides.
const TOPIC_CAPABLE = new Set([
  'video_uploads',
  'short_uploads',
  'video_watch_secs',
  'short_watch_secs',
]);

export function metricSupportsTopics(id) {
  return TOPIC_CAPABLE.has(id);
}

export const DEFAULT_WINDOW = '7d';
export const DEFAULT_METRIC = 'video_uploads';

export function metricById(id) {
  return METRICS.find((m) => m.id === id) || METRICS[0];
}

async function get(path) {
  const r = await fetch(`${CHECKER_URL}${path}`);
  if (!r.ok) throw new Error(`leaderboard ${path} → ${r.status}`);
  const data = await r.json();
  if (data && data.success === false) throw new Error(data.error || 'leaderboard error');
  return data;
}

// One ranked board. Returns { entries: [{ rank, user, ...all five metrics }], … }.
export function fetchLeaderboard({ window = DEFAULT_WINDOW, metric = DEFAULT_METRIC, limit = 50, page = 1 } = {}) {
  return get(`/leaderboard?window=${window}&metric=${metric}&limit=${limit}&page=${page}`);
}

// A creator's stat line + rank per metric. Users with no activity in a rolling
// window have no row at all, so the checker reports them as zeros with null
// ranks rather than 404 — callers can render the result unconditionally.
export function fetchUserLeaderboardStats(username, window = DEFAULT_WINDOW) {
  return get(`/leaderboard/user/${encodeURIComponent(username)}?window=${window}`);
}

// The 16 topics the tagger assigns. Rarely changes, so it's cached hard.
export function fetchTopics() {
  return get('/leaderboard/topics');
}

// One topic's board. Same window/paging contract and the same metric field names
// as the main board, so only the collection behind it differs.
export function fetchTopicLeaderboard({ topic, window = DEFAULT_WINDOW, metric = DEFAULT_METRIC, limit = 50, page = 1 }) {
  return get(`/leaderboard/topic?topic=${encodeURIComponent(topic)}&window=${window}&metric=${metric}&limit=${limit}&page=${page}`);
}

// Profile badges: the user's best standing per metric across all windows,
// already tiered by the checker (#1 / Top 3 / Top 10 / Top 50 / Top 100).
export function fetchLeaderboardBadges(username) {
  return get(`/leaderboard/badges/${encodeURIComponent(username)}`);
}

// Badges sit in a crowded profile header next to the follower count and social
// links, so the label stays terse ("#1 Videos") and the icon carries the topic.
// The full sentence lives in the hover title.
// Only overrides — anything not listed falls back to the metric's own label in
// METRICS above. These five are shortened because the board label is too long
// for a header chip ("Video watch time" → "Watched").
// Values are i18n keys.
const BADGE_NOUNS = {
  video_uploads: 'misc.leaderboard.badgeNouns.video_uploads',
  short_uploads: 'misc.leaderboard.badgeNouns.short_uploads',
  video_watch_secs: 'misc.leaderboard.badgeNouns.video_watch_secs',
  short_watch_secs: 'misc.leaderboard.badgeNouns.short_watch_secs',
  tags_given: 'misc.leaderboard.badgeNouns.tags_given',
};

// "Top 100" is too easy to earn to be worth a badge (a few uploads gets you
// there on a quiet window), so profiles only show Top 50 and better.
const BADGE_TIERS = ['top1', 'top3', 'top10', 'top50'];
export const MAX_PROFILE_BADGES = 3;

// A rank means nothing while a board is nearly empty: the streaming boards are
// new, so #1 on them was worth 1 stream and 4 peak viewers — three such chips
// pushed a creator's real Videos/Shorts standings off the profile (only
// MAX_PROFILE_BADGES fit). A badge has to clear a floor of actual activity
// before it earns header space. The video metrics have organic scale already
// and stay unthresholded.
const MIN_BADGE_VALUE = {
  streams: 5,
  stream_secs: 3600,          // an hour live, total
  stream_peak_viewers: 10,
  stream_viewers: 25,
  boosts_received: 5,
  boost_amount_received: 10,
  boosts_given: 5,
  boost_amount_given: 10,
};

export function badgeLabel(badge) {
  // Fall back to the metric's board label, NOT the raw id — a metric added to
  // the checker without a noun here used to render as "#1 stream_peak_viewers".
  const metric = METRICS.find((m) => m.id === badge.metric);
  const noun = BADGE_NOUNS[badge.metric] ? t(BADGE_NOUNS[badge.metric]) : metric ? t(metric.labelKey) : badge.metric;
  return t('misc.leaderboard.badgeLabel', { tier: badge.tier_label, noun });
}

export function badgeTitle(badge) {
  const w = WINDOWS.find((x) => x.id === badge.window);
  // The *InSentence keys are the mid-sentence forms (lower case in English, but a
  // translator decides: German keeps nouns capitalised). Never lowercase in code.
  const what = t(`misc.leaderboard.blurbsInSentence.${metricById(badge.metric).id}`);
  if (badge.window === 'all') return t('misc.leaderboard.badgeTitleAllTime', { rank: badge.rank, what });
  const windowLabel = w ? t(`misc.leaderboard.windowsInSentence.${w.id}`) : badge.window;
  return t('misc.leaderboard.badgeTitleWindow', { rank: badge.rank, what, window: windowLabel });
}

// Strongest first, capped — a profile shows a highlight reel, not a résumé.
export function visibleBadges(badges) {
  return (badges || [])
    .filter((b) => BADGE_TIERS.includes(b.tier))
    .filter((b) => Number(b.value || 0) >= (MIN_BADGE_VALUE[b.metric] || 0))
    .slice(0, MAX_PROFILE_BADGES);
}

// Compact duration for watch-time columns: 4h 12m / 12m 30s / 45s.
export function formatDuration(secs) {
  const s = Math.max(0, Math.round(secs || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return t('misc.duration.hoursMinutes', { h, m });
  if (m > 0) return t('misc.duration.minutesSeconds', { m, s: sec });
  return t('misc.duration.seconds', { s: sec });
}

export function formatMetric(value, unit) {
  if (unit === 'duration') return formatDuration(value);
  return formatNumber(value);
}
