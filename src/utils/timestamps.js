/**
 * Timestamps written in a video's description or its comments ("the fix is at
 * 4:12") become links that seek the player, and a LIST of them in the
 * description becomes chapters on the timeline, the way YouTube does both.
 *
 * Everything is in CONTENT seconds: the creator's own timeline, not the file's
 * (a stitched ad makes the file longer). Callers hand in the content duration
 * and seek through the same onSeek the progress bar uses.
 */

// m:ss, mm:ss or h:mm:ss. Not glued to other digits, colons or dots (so a ratio
// like 1:2:3:4 or a version 1.12:30 is left alone), and not a clock time with
// am/pm after it.
const STAMP_SRC = String.raw`(?<![\d:.])(?:(\d{1,2}):)?(\d{1,2}):([0-5]\d)(?![\d:]|\s?[ap]\.?m\b)`;
const STAMP_TEST = new RegExp(STAMP_SRC, 'i');

const toSeconds = (h, m, s) => {
  const hours = h ? Number(h) : 0;
  const mins = Number(m);
  // With an hour part the minutes must be a real minute; without one, 75:30 is
  // a fine way to write an hour and a quarter.
  if (h && mins > 59) return null;
  return hours * 3600 + mins * 60 + Number(s);
};

/** "1:02:03" → 3723, or null when it isn't a timestamp. */
export function parseStamp(text) {
  const m = new RegExp(`^\\s*${STAMP_SRC}\\s*$`, 'i').exec(String(text || ''));
  return m ? toSeconds(m[1], m[2], m[3]) : null;
}

export function formatStamp(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

// Text inside these is never turned into a seek link: an existing link already
// goes somewhere, and code is code.
const SKIP_TAGS = new Set(['A', 'CODE', 'PRE', 'SCRIPT', 'STYLE', 'TEXTAREA', 'BUTTON']);

// The watch page re-renders on every playhead tick and the comment list renders
// each body again each time, so the DOM walk is cached on (duration, html).
const cache = new Map();
const CACHE_MAX = 400;

/**
 * Wrap every timestamp in `html` that falls inside the video in
 * `<a class="ts-link" data-seek="N">`. A time past the end (or any time while
 * the duration is still unknown) stays plain text, so a link never promises a
 * moment the video doesn't have.
 */
export function linkifyTimestamps(html, duration) {
  if (!html || typeof document === 'undefined') return html || '';
  const limit = Math.floor(Number(duration) || 0);
  if (limit <= 0 || !STAMP_TEST.test(html)) return html;

  const key = `${limit}|${html}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      for (let p = node.parentNode; p && p !== tpl.content; p = p.parentNode) {
        if (SKIP_TAGS.has(p.nodeName)) return NodeFilter.FILTER_REJECT;
      }
      return STAMP_TEST.test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);

  let changed = false;
  for (const node of nodes) {
    const text = node.nodeValue;
    const re = new RegExp(STAMP_SRC, 'gi');
    const frag = document.createDocumentFragment();
    let last = 0;
    let linked = false;
    let m;
    while ((m = re.exec(text))) {
      const sec = toSeconds(m[1], m[2], m[3]);
      if (sec == null || sec > limit) continue;
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const a = document.createElement('a');
      a.className = 'ts-link';
      a.href = `#t=${sec}`;
      a.dataset.seek = String(sec);
      a.textContent = m[0];
      frag.appendChild(a);
      last = m.index + m[0].length;
      linked = true;
    }
    if (!linked) continue;
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(frag, node);
    changed = true;
  }

  const out = changed ? tpl.innerHTML : html;
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, out);
  return out;
}

/**
 * Click handler for a block of rendered text: a click on a timestamp link seeks
 * instead of navigating. Returns true when it handled the click.
 */
export function handleTimestampClick(e, onSeek) {
  const a = e.target?.closest?.('a.ts-link[data-seek]');
  if (!a || !onSeek) return false;
  e.preventDefault();
  e.stopPropagation();
  onSeek(Number(a.dataset.seek));
  return true;
}

// Markdown and HTML decoration a chapter line may carry: **0:00** Intro,
// [0:00](https://…?t=0) Intro, <a href=…>0:00</a> Intro.
const plainLine = (line) => String(line)
  .replace(/<[^>]+>/g, '')
  .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/[*_`~]+/g, '')
  .replace(/&nbsp;/g, ' ')
  .trim();

// Bullet or numbering in front of a list line: "- ", "* ", "• ", "1. ", "1) ".
const BULLET_RE = /^(?:[-*+•▶►▸→]\s*|\d{1,3}[.)]\s+)?/;
// Separator between the time and the title, either side: "0:00 - Intro", "Intro | 0:00".
const SEP_RE = /^[\s\-–—:|·.)\]]+|[\s\-–—:|·.([]+$/g;

function chapterFromLine(raw) {
  const line = plainLine(raw).replace(BULLET_RE, '');
  if (!line) return null;
  // Time first ("0:00 Intro"), or time last ("Intro 0:00", "Intro (0:00)").
  let m = new RegExp(`^\\(?\\[?${STAMP_SRC}\\]?\\)?(.*)$`, 'i').exec(line);
  if (m) {
    const start = toSeconds(m[1], m[2], m[3]);
    return start == null ? null : { start, title: m[4].replace(SEP_RE, '').trim() };
  }
  m = new RegExp(`^(.*?)\\(?\\[?${STAMP_SRC}\\]?\\)?$`, 'i').exec(line);
  if (m && m[1].trim()) {
    const start = toSeconds(m[2], m[3], m[4]);
    return start == null ? null : { start, title: m[1].replace(SEP_RE, '').trim() };
  }
  return null;
}

const MIN_CHAPTERS = 3;
const MIN_CHAPTER_SECONDS = 5;

/**
 * Chapters from a description, YouTube style: a run of at least three
 * consecutive lines that each start (or end) with a timestamp, in ascending
 * order. Times past the end of the video are dropped. If the list doesn't start
 * at 0:00 an untitled first chapter covers the gap, so every second of the
 * timeline belongs to one.
 *
 * Returns [{ start, end, title }] in content seconds, or [] when there is no
 * such list or the duration is not known yet.
 */
export function parseChapters(body, duration) {
  const total = Number(duration) || 0;
  if (!body || total <= 0) return [];

  // Rendered post bodies sometimes arrive with <br> instead of newlines.
  const lines = String(body).replace(/<br\s*\/?>/gi, '\n').split(/\r?\n/);
  let best = [];
  let run = [];
  const flush = () => { if (run.length > best.length) best = run; run = []; };
  for (const raw of lines) {
    if (!raw.trim()) continue; // a blank line between list items doesn't break the list
    const ch = chapterFromLine(raw);
    if (!ch) { flush(); continue; }
    if (run.length && ch.start <= run[run.length - 1].start) flush();
    run.push(ch);
  }
  flush();

  const inside = best.filter((c) => c.start < total);
  if (inside.length < MIN_CHAPTERS) return [];
  if (inside[0].start > 0) inside.unshift({ start: 0, title: '' });

  const chapters = inside.map((c, i) => ({
    start: c.start,
    end: i + 1 < inside.length ? inside[i + 1].start : total,
    title: c.title,
  }));
  // A chapter shorter than a few seconds is a typo or a timestamp that wasn't
  // meant as a chapter; merge it into the one before rather than draw a sliver.
  const merged = [];
  for (const c of chapters) {
    const prev = merged[merged.length - 1];
    if (prev && c.end - c.start < MIN_CHAPTER_SECONDS) { prev.end = c.end; continue; }
    merged.push({ ...c });
  }
  return merged.length >= 2 ? merged : [];
}

/** The chapter that contains `time`, or null. */
export function chapterAt(chapters, time) {
  if (!chapters?.length) return null;
  for (let i = chapters.length - 1; i >= 0; i -= 1) {
    if (time >= chapters[i].start) return chapters[i];
  }
  return chapters[0];
}

// ── Timestamps in the comments people write ──────────────────────────────
//
// A comment is a Hive post, read by every Hive frontend, and on PeakD or Ecency
// a bare "4:12" is just text. So when a comment is posted, each timestamp that
// falls inside the video is stored as a real link to that moment on 3Speak:
// [4:12](https://3speak.tv/watch?v=author/permlink&t=252). On 3Speak itself
// the comment renderer turns such links back into the in-page seek link, so it
// looks and behaves exactly like a typed timestamp.

const SITE = 'https://3speak.tv';

export function watchTimeUrl(author, permlink, seconds) {
  return `${SITE}/watch?v=${author}/${permlink}&t=${Math.floor(seconds)}`;
}

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Stretches of markdown a timestamp must not be linked inside: fenced and inline
// code, existing links and images (label AND target), raw HTML tags and bare URLs.
const PROTECTED_RE = /```[\s\S]*?```|`[^`\n]*`|!?\[[^\]]*\]\([^)]*\)|<[^>\n]+>|https?:\/\/\S+/g;

/** Turn the timestamps in a comment's markdown into 3Speak links to that moment. */
export function linkTimestampsInMarkdown(text, { author, permlink, duration }) {
  const limit = Math.floor(Number(duration) || 0);
  if (!text || !author || !permlink || limit <= 0 || !STAMP_TEST.test(text)) return text || '';
  const linkPlain = (chunk) => chunk.replace(new RegExp(STAMP_SRC, 'gi'), (m, h, mm, ss) => {
    const sec = toSeconds(h, mm, ss);
    return sec == null || sec > limit ? m : `[${m}](${watchTimeUrl(author, permlink, sec)})`;
  });
  let out = '';
  let last = 0;
  for (const m of text.matchAll(PROTECTED_RE)) {
    out += linkPlain(text.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return out + linkPlain(text.slice(last));
}

/**
 * The reverse, for the edit box: [4:12](3speak link to THIS video) back to a
 * plain 4:12, so the author edits their words and not link syntax. A link to a
 * moment in another video is left as it is.
 */
export function unlinkTimestampsInMarkdown(text, { author, permlink }) {
  if (!text || !author || !permlink) return text || '';
  const re = new RegExp(
    String.raw`\[((?:\d{1,2}:)?\d{1,2}:[0-5]\d)\]\(https?:\/\/(?:[\w-]+\.)?3speak\.tv\/watch\?v=${escapeRe(author)}\/${escapeRe(permlink)}(?:&[^)\s]*)?\)`,
    'g',
  );
  return text.replace(re, '$1');
}
