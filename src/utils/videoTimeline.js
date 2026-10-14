/**
 * The video "timeline": chapters and link toasters a creator attaches to a
 * long-form video. Stored in the post's json_metadata, next to the rest of the
 * video block:
 *
 *   video: {
 *     ...,
 *     timeline_v: 1,
 *     chapters: [{ start: 0, title: 'Intro' }, { start: 95, title: 'Setup' }],
 *     links: [
 *       { at: 42,  dur: 8, kind: 'video',   author: 'alice', permlink: 'my-vid', title: 'My vid' },
 *       { at: 120, dur: 8, kind: 'profile', account: 'bob' },
 *       { at: 300, dur: 8, kind: 'url',     url: 'https://example.com/x', title: 'Example', site: 'example.com' },
 *     ],
 *   }
 *
 * 🚨 THE EMBED PLAYER READS THE SAME FORMAT (dev-player). Change it on both sides
 * or not at all.
 *
 * Everything that reads or writes it goes through this module, and it normalises
 * BOTH ways: on write, so a post never carries something the readers would drop,
 * and on read, because json_metadata is whatever the author's client signed and
 * nothing on chain checks it. Invalid items are dropped silently, never repaired
 * into something the creator did not ask for.
 *
 * Times are CONTENT seconds (the creator's own timeline; a stitched ad is not in
 * it), whole seconds.
 *
 * Chapters are ALSO written into the description as plain "0:00 Title" lines
 * (applyChaptersToDescription), so PeakD, Ecency and every other Hive frontend
 * show them too; the metadata copy is what 3Speak itself prefers.
 */
import { chapterFromLine, formatStamp, MIN_CHAPTERS, MIN_CHAPTER_SECONDS } from './timestamps';

export const TIMELINE_VERSION = 1;
export const TIMELINE_KEYS = ['timeline_v', 'chapters', 'links'];

export const MIN_META_CHAPTERS = 2;          // fewer than this is not a chapter list
export const MAX_CHAPTERS = 50;
export const CHAPTER_TITLE_MAX = 100;
export { MIN_CHAPTERS as MIN_DESCRIPTION_CHAPTERS, MIN_CHAPTER_SECONDS };

export const MAX_LINKS = 20;
export const LINK_DUR_MIN = 3;
export const LINK_DUR_MAX = 60;
export const LINK_DUR_DEFAULT = 8;
export const LINK_TITLE_MAX = 100;
export const LINK_SITE_MAX = 100;
export const LINK_URL_MAX = 500;
export const LINK_KINDS = ['video', 'profile', 'url'];

export const ACCOUNT_RE = /^[a-z][a-z0-9.-]{2,15}$/;
export const PERMLINK_RE = /^[a-z0-9-]{1,256}$/;

// (Not U+200C/U+200D: joiners hold emoji sequences and some scripts together.)
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001F\u007F\u200B\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

/** One line of plain text, control characters out, at most `max` characters. */
function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  const s = value.replace(CONTROL_RE, ' ').replace(/\s+/g, ' ').trim();
  const chars = Array.from(s);
  return chars.length > max ? chars.slice(0, max).join('').trim() : s;
}

/** A whole, non-negative second, or null. */
function toSecond(value) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

const knownDuration = (duration) => {
  const d = Number(duration);
  return Number.isFinite(d) && d > 0 ? d : 0;
};

/** An http(s) URL as a string, or null. No credentials, at most LINK_URL_MAX. */
export function cleanUrl(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw || raw.length > LINK_URL_MAX) return null;
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password || !u.hostname) return null;
  const href = u.href;
  return href.length > LINK_URL_MAX ? null : href;
}

/** "example.com" for a URL, or ''. */
export function siteOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

/**
 * Chapters as stored: [{ start, title }] ascending, the first at 0:00, at least
 * 5 seconds apart, 2 to 50 of them, every one titled. Anything else is [].
 * With a known duration, chapters at or past the end are dropped first.
 */
export function normalizeChapters(raw, { duration } = {}) {
  if (!Array.isArray(raw)) return [];
  const total = knownDuration(duration);
  const items = [];
  for (const c of raw) {
    if (!c || typeof c !== 'object') continue;
    const start = toSecond(c.start);
    const title = cleanText(c.title, CHAPTER_TITLE_MAX);
    if (start == null || !title) continue;
    if (total && start >= total) continue;
    items.push({ start, title });
  }
  items.sort((a, b) => a.start - b.start);
  const out = [];
  for (const c of items) {
    const prev = out[out.length - 1];
    if (prev && c.start - prev.start < MIN_CHAPTER_SECONDS) continue;
    out.push(c);
  }
  if (!out.length || out[0].start !== 0) return [];
  const capped = out.slice(0, MAX_CHAPTERS);
  return capped.length >= MIN_META_CHAPTERS ? capped : [];
}

/** One link as stored, or null when it isn't valid. */
export function normalizeLink(l, { duration } = {}) {
  if (!l || typeof l !== 'object') return null;
  const at = toSecond(l.at);
  if (at == null) return null;
  const total = knownDuration(duration);
  if (total && at >= total) return null;
  const durN = Math.round(Number(l.dur));
  const dur = Number.isFinite(durN) && durN > 0
    ? Math.min(LINK_DUR_MAX, Math.max(LINK_DUR_MIN, durN))
    : LINK_DUR_DEFAULT;
  const title = cleanText(l.title, LINK_TITLE_MAX);

  if (l.kind === 'video') {
    const author = typeof l.author === 'string' ? l.author.trim().toLowerCase().replace(/^@/, '') : '';
    const permlink = typeof l.permlink === 'string' ? l.permlink.trim() : '';
    if (!ACCOUNT_RE.test(author) || !PERMLINK_RE.test(permlink)) return null;
    return { at, dur, kind: 'video', author, permlink, ...(title ? { title } : {}) };
  }
  if (l.kind === 'profile') {
    const account = typeof l.account === 'string' ? l.account.trim().toLowerCase().replace(/^@/, '') : '';
    if (!ACCOUNT_RE.test(account)) return null;
    return { at, dur, kind: 'profile', account };
  }
  if (l.kind === 'url') {
    const url = cleanUrl(l.url);
    if (!url) return null;
    const site = cleanText(l.site, LINK_SITE_MAX) || cleanText(siteOf(url), LINK_SITE_MAX);
    return { at, dur, kind: 'url', url, ...(title ? { title } : {}), ...(site ? { site } : {}) };
  }
  return null;
}

/** Links as stored: valid ones only, sorted by `at`, at most 20. */
export function normalizeLinks(raw, opts = {}) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const l of raw) {
    const n = normalizeLink(l, opts);
    if (n) out.push(n);
  }
  // Stable: two links at the same second keep the creator's order.
  return out
    .map((l, i) => [l, i])
    .sort((a, b) => a[0].at - b[0].at || a[1] - b[1])
    .map(([l]) => l)
    .slice(0, MAX_LINKS);
}

/**
 * A post's `video` block with the timeline written in (or taken out, when there
 * is nothing left). Keys other than the timeline's are kept as they are.
 */
export function withTimeline(video, chapters, links, opts = {}) {
  const base = { ...(video && typeof video === 'object' ? video : {}) };
  for (const k of TIMELINE_KEYS) delete base[k];
  const ch = normalizeChapters(chapters, opts);
  const ln = normalizeLinks(links, opts);
  if (!ch.length && !ln.length) return base;
  return {
    ...base,
    timeline_v: TIMELINE_VERSION,
    ...(ch.length ? { chapters: ch } : {}),
    ...(ln.length ? { links: ln } : {}),
  };
}

/** Just the timeline keys, for spreading into a new `video` block. */
export function timelineMeta(chapters, links, opts = {}) {
  return withTimeline({}, chapters, links, opts);
}

/** json_metadata (string or object) → its parsed object, or {}. */
export function parseJsonMetadata(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : {};
  } catch { return {}; }
}

/**
 * The timeline of a post, read from its json_metadata and normalised again.
 * { chapters: [{start,title}], links: [...], present } — `present` says the
 * post carries a timeline at all (timeline_v set).
 */
export function readTimeline(jsonMetadata, opts = {}) {
  const meta = parseJsonMetadata(jsonMetadata);
  const video = meta?.video;
  if (!video || typeof video !== 'object' || !(Number(video.timeline_v) >= 1)) {
    return { chapters: [], links: [], present: false };
  }
  return {
    chapters: normalizeChapters(video.chapters, opts),
    links: normalizeLinks(video.links, opts),
    present: true,
  };
}

/**
 * Stored chapters → what the player's controls draw: [{ start, end, title }],
 * `end` being the next start (or the duration). [] until the duration is known.
 */
export function chaptersWithEnds(chapters, duration) {
  const total = knownDuration(duration);
  if (!total) return [];
  const inside = normalizeChapters(chapters, { duration: total });
  return inside.map((c, i) => ({
    start: c.start,
    end: i + 1 < inside.length ? inside[i + 1].start : total,
    title: c.title,
  }));
}

// ── The chapter block in a description ───────────────────────────────────

const splitLines = (text) => String(text || '').replace(/\r\n?/g, '\n').split('\n');

/**
 * The chapter list in a description, found the way parseChapters finds it: the
 * longest run of consecutive lines that each carry a timestamp, ascending, blank
 * lines allowed in between, at least MIN_CHAPTERS long. Times are not checked
 * against a duration here, so a block is recognised (and replaced) as written.
 *
 * Returns { from, to, chapters } as line indexes (inclusive), or null.
 */
export function findChapterBlock(text) {
  const lines = splitLines(text);
  let best = null;
  let run = null;
  const flush = () => {
    if (run && (!best || run.chapters.length > best.chapters.length)) best = run;
    run = null;
  };
  lines.forEach((raw, i) => {
    if (!raw.trim()) return;
    const ch = chapterFromLine(raw);
    if (!ch) { flush(); return; }
    if (run && ch.start <= run.chapters[run.chapters.length - 1].start) flush();
    if (!run) run = { from: i, to: i, chapters: [] };
    run.chapters.push(ch);
    run.to = i;
  });
  flush();
  return best && best.chapters.length >= MIN_CHAPTERS ? best : null;
}

/**
 * Chapters for the editor, read from a description's chapter block: [{start,title}]
 * as written (titles may be empty, the first may not be at 0:00), or [].
 */
export function chaptersFromText(text) {
  const block = findChapterBlock(text);
  if (!block) return [];
  return block.chapters.map((c) => ({ start: c.start, title: cleanText(c.title, CHAPTER_TITLE_MAX) }));
}

/** The plain block written into descriptions: "0:00 Intro" lines. */
export function chapterBlock(chapters) {
  return chapters.map((c) => `${formatStamp(c.start)} ${c.title}`).join('\n');
}

/**
 * The description with its chapter block rewritten from `chapters`.
 *
 * Only when the chapters make a list every Hive frontend would accept (at least
 * three, from 0:00): then an existing block is replaced where it stands, or a new
 * one appended. Otherwise the description is returned untouched.
 *
 * Plain lines on purpose, never [0:00](link): 3Speak's renderer turns timestamp
 * links into navigation, and PeakD and Ecency detect chapters from the text.
 */
export function applyChaptersToDescription(description, chapters) {
  const text = typeof description === 'string' ? description : '';
  const norm = normalizeChapters(chapters);
  if (norm.length < MIN_CHAPTERS) return text;
  const blockLines = chapterBlock(norm).split('\n');
  const found = findChapterBlock(text);
  if (found) {
    const lines = splitLines(text);
    lines.splice(found.from, found.to - found.from + 1, ...blockLines);
    return lines.join('\n');
  }
  const head = text.replace(/\s+$/, '');
  return head ? `${head}\n\n${blockLines.join('\n')}` : blockLines.join('\n');
}

// A section after a "---" that 3Speak itself wrote: the remix credit, sound
// credits, the "Watch on 3speak.tv" footer (and the legacy "[3Speak]" one).
const SYSTEM_LINE_RE = /^\s*(?:(?:▶|\uFE0F|\s)*\[\s*(?:Watch on 3speak\.tv|Watch on 3Speak|3Speak)\s*\]\(|\*(?:Based on a video by|Sound:|Music:))/i;
const RULE_RE = /^\s*-{3,}\s*$/;

/**
 * Split a full post body into what the creator wrote and the trailing sections
 * 3Speak appends (separated by "---"), so a new chapter block lands above them.
 */
export function splitSystemTail(body) {
  const lines = splitLines(body);
  let cut = lines.length;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (!RULE_RE.test(lines[i])) continue;
    const section = lines.slice(i + 1, cut).filter((l) => l.trim());
    if (!section.length || !section.every((l) => SYSTEM_LINE_RE.test(l))) break;
    cut = i;
  }
  return {
    main: lines.slice(0, cut).join('\n'),
    tail: lines.slice(cut).join('\n'),
  };
}

/**
 * applyChaptersToDescription for a whole post body (the edit dialog edits the
 * body, footer included): an existing block is replaced in place, a new one goes
 * above 3Speak's own trailing sections rather than after the "Watch on" link.
 */
export function applyChaptersToBody(body, chapters) {
  const text = typeof body === 'string' ? body : '';
  if (normalizeChapters(chapters).length < MIN_CHAPTERS) return text;
  if (findChapterBlock(text)) return applyChaptersToDescription(text, chapters);
  const { main, tail } = splitSystemTail(text);
  const withBlock = applyChaptersToDescription(main, chapters);
  return tail.trim() ? `${withBlock}\n\n${tail.replace(/^\s+/, '')}` : withBlock;
}

/** The links whose toaster is on screen at content second `t`. */
export function activeLinksAt(links, t) {
  if (!Array.isArray(links) || !Number.isFinite(t)) return [];
  return links.filter((l) => t >= l.at && t < l.at + l.dur);
}
