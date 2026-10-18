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
 * Chapters and links are ALSO written into the description, under "Video
 * Chapters" and "Video Links" headings (applyTimelineToDescription), each
 * chapter time linked to that moment on 3speak.tv, so PeakD, Ecency and every
 * other Hive frontend show them too; the metadata copy is what 3Speak itself
 * prefers.
 */
import { chapterFromLine, formatStamp, watchTimeUrl, MIN_CHAPTERS, MIN_CHAPTER_SECONDS } from './timestamps';

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

// ── The timeline sections written into a description ─────────────────────
//
//   #### Video Chapters
//
//   - [0:00](https://3speak.tv/watch?v=a/p) Intro
//   - [1:05](https://3speak.tv/watch?v=a/p&t=65) Setup
//
//   #### Video Links
//   [@bob on 3Speak.tv](https://3speak.tv/@bob)
//   [My vid by @alice](https://3speak.tv/watch?v=alice/my-vid)
//   [Example page](https://example.com/x)
//
// Written for PeakD, Ecency and every other Hive frontend, which never see the
// metadata. On 3Speak's own watch page BlogContent turns links to the same video
// back into in-page seeks, and chapterFromLine reads a linked line like a plain one.

const SITE = 'https://3speak.tv';
const CHAPTERS_HEADING = '#### Video Chapters';
const LINKS_HEADING = '#### Video Links';
const CHAPTERS_HEADING_RE = /^\s*#{1,6}\s*Video Chapters\s*:?\s*$/i;
const LINKS_HEADING_RE = /^\s*#{1,6}\s*Video Links\s*:?\s*$/i;
// One markdown link on its own line, maybe bulleted (an escaped "\]" in the label).
const LINK_LINE_RE = /^\s*(?:[-*+•]\s+)?\[(?:\\.|[^\]\\])*\]\([^)\s]+\)\s*$/;

// Link labels are the creator's titles: keep them from closing the link early.
const mdLabel = (s) => String(s).replace(/([\\[\]])/g, '\\$1');
const mdUrl = (u) => String(u).replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\s/g, '%20');

const chapterUrl = (author, permlink, start) => (start > 0
  ? watchTimeUrl(author, permlink, start)
  : `${SITE}/watch?v=${author}/${permlink}`);

/**
 * The chapter section: heading + "- 0:00 Intro" list. With the post's author and
 * permlink each time links to that moment on 3speak.tv; without them (the post
 * doesn't exist yet) the times stay plain. [] when the chapters are not a list
 * every Hive frontend would accept (at least three, from 0:00).
 */
export function chapterBlock(chapters, { author, permlink } = {}) {
  const norm = normalizeChapters(chapters);
  if (norm.length < MIN_CHAPTERS) return [];
  return [CHAPTERS_HEADING, '', ...norm.map((c) => {
    const stamp = formatStamp(c.start);
    const time = author && permlink ? `[${stamp}](${chapterUrl(author, permlink, c.start)})` : stamp;
    return `- ${time} ${c.title}`;
  })];
}

/** One link as a description line, or null. */
function linkLine(l) {
  if (l.kind === 'profile') return `[@${l.account} on 3Speak.tv](${SITE}/@${l.account})`;
  if (l.kind === 'video') {
    const label = l.title ? `${l.title} by @${l.author}` : `A video by @${l.author}`;
    return `[${mdLabel(label)}](${SITE}/watch?v=${l.author}/${l.permlink})`;
  }
  if (l.kind === 'url') return `[${mdLabel(l.title || l.site || l.url)}](${mdUrl(l.url)})`;
  return null;
}

/** The link section: heading + one line per link target (repeats listed once). [] for none. */
export function linkBlock(links) {
  const seen = new Set();
  const lines = [];
  for (const l of normalizeLinks(links)) {
    const line = linkLine(l);
    if (!line || seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
  }
  return lines.length ? [LINKS_HEADING, ...lines] : [];
}

/** Line range of the chapter list (with its heading, if it has one), or null. */
function findChapterSection(lines) {
  const block = findChapterBlock(lines.join('\n'));
  if (!block) return null;
  let from = block.from;
  let i = from - 1;
  while (i >= 0 && !lines[i].trim()) i -= 1;
  if (i >= 0 && CHAPTERS_HEADING_RE.test(lines[i])) from = i;
  return { from, to: block.to };
}

/** Line range of a "Video Links" heading and the link lines under it, or null. */
function findLinkSection(lines) {
  const from = lines.findIndex((l) => LINKS_HEADING_RE.test(l));
  if (from < 0) return null;
  let to = from;
  for (let i = from + 1; i < lines.length; i += 1) {
    if (!lines[i].trim()) continue;
    if (!LINK_LINE_RE.test(lines[i])) break;
    to = i;
  }
  return { from, to };
}

/** `lines` with `block` added at the end, one blank line between. */
function appendBlock(lines, block) {
  const out = [...lines];
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out.length ? [...out, '', ...block] : [...block];
}

/** Runs of blank lines down to one, none at either end. */
function tidyLines(lines) {
  const out = [];
  for (const l of lines) {
    if (!l.trim() && (!out.length || !out[out.length - 1].trim())) continue;
    out.push(l);
  }
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out;
}

/**
 * The description with its timeline sections rewritten from `chapters` and
 * `links`. The chapter section replaces the existing chapter list where it
 * stands (a list typed without a heading too), or is appended; with too few
 * chapters for a list, an existing one is left as written. The link section
 * follows the chapters (or replaces the old one where it stands, or is
 * appended), and goes away when there are no links.
 *
 * `post` ({ author, permlink }) links each chapter time to that moment on
 * 3speak.tv, so a reader on PeakD or Ecency lands right on the chapter.
 */
export function applyTimelineToDescription(description, { chapters, links } = {}, post = {}) {
  const text = typeof description === 'string' ? description : '';
  const chBlock = chapterBlock(chapters, post);
  const lkBlock = linkBlock(links);
  let lines = splitLines(text);
  const oldLinks = findLinkSection(lines);
  if (!chBlock.length && !lkBlock.length && !oldLinks) return text;

  if (chBlock.length) {
    const found = findChapterSection(lines);
    if (found) lines.splice(found.from, found.to - found.from + 1, ...chBlock);
    else lines = appendBlock(lines, chBlock);
  }

  let at = null;
  const staleLinks = findLinkSection(lines);
  if (staleLinks) {
    lines.splice(staleLinks.from, staleLinks.to - staleLinks.from + 1);
    at = staleLinks.from;
  }
  if (lkBlock.length) {
    const ch = findChapterSection(lines);
    if (ch) at = ch.to + 1;
    if (at == null) lines = appendBlock(lines, lkBlock);
    else lines.splice(at, 0, '', ...lkBlock, '');
  }
  return tidyLines(lines).join('\n');
}

// A section after a "---" that 3Speak itself wrote: the remix credit, sound
// credits, the "Watch on 3speak.tv" footer (and the legacy "[3Speak]" one), and
// the creator banner image under it (3speak.tv/banners/<user>.png).
const SYSTEM_LINE_RE = /^\s*(?:(?:▶|\uFE0F|\s)*\[\s*(?:Watch on 3speak\.tv|Watch on 3Speak|3Speak)\s*\]\(|\*(?:Based on a video by|Sound:|Music:)|\[!\[[^\]]*\]\(https:\/\/3speak\.tv\/banners\/)/i;
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
 * applyTimelineToDescription for a whole post body (the edit dialog edits the
 * body, footer included): the sections go above 3Speak's own trailing sections
 * rather than after the "Watch on" link.
 */
export function applyTimelineToBody(body, timeline, post = {}) {
  const text = typeof body === 'string' ? body : '';
  const { main, tail } = splitSystemTail(text);
  const withBlocks = applyTimelineToDescription(main, timeline, post);
  if (withBlocks === main) return text;
  return tail.trim() ? `${withBlocks}\n\n${tail.replace(/^\s+/, '')}` : withBlocks;
}

/** The links whose toaster is on screen at content second `t`. */
export function activeLinksAt(links, t) {
  if (!Array.isArray(links) || !Number.isFinite(t)) return [];
  return links.filter((l) => t >= l.at && t < l.at + l.dur);
}
