// What a video's share card is called. Shared by og-server.cjs (the page a
// crawler reads) and og-cards.cjs (the drawn 1200x630 image of a short), so the
// image and the page title never disagree. No deps.

// A short's `## Title` first line, or ''. Keep in step with src/utils/shortTitle.js.
function shortHeading(body) {
  const line = String(body || '').replace(/\r\n/g, '\n').split('\n').find((l) => l.trim());
  const m = line && line.trim().match(/^##(?!#)[ \t]*(.*)$/);
  if (!m) return '';
  const text = m[1]
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]+/g, '')
    .replace(/\s+#+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 100 ? `${text.slice(0, 99).trimEnd()}…` : text;
}

/**
 * The first line of a post that is real text: not the player link or an image,
 * at least three characters. Snaps put their caption there.
 */
function firstLine(body) {
  for (const line of String(body || '').split('\n')) {
    const text = line
      .replace(/<[^>]+>/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[#*_~`>|▶]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length >= 3 && !/^-+$/.test(text)) return text.length > 100 ? `${text.slice(0, 97).trim()}...` : text;
  }
  return '';
}

/**
 * A video's title from its Hive post and/or checker embed doc, '' when neither
 * names it. A short is a Hive REPLY (to a snaps/waves container), titled "RE:
 * Snaps Container // <date>". That says nothing about the short, so a reply's
 * own title only counts when nothing better exists: the caption the creator
 * wrote, i.e. the first line of the post.
 */
function videoTitle(post, embed) {
  const isReply = !!(post && post.parent_author);
  return (
    (post && !isReply && post.title) ||
    // A short's own title: the `## Title` first line the uploader writes (same
    // rule as src/utils/shortTitle.js). Ahead of the embed doc's titles, whose
    // embed_title can be the placeholder "Comment".
    (post && shortHeading(post.body)) ||
    (embed && (embed.hive_title || embed.embed_title)) ||
    (post && firstLine(post.body)) ||
    (embed && embed.originalFilename) ||
    ''
  );
}

/** `text` cut to at most `max` characters, at a word break where there is one, with an ellipsis. */
function clip(text, max) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  // A break in the last third only: one long word is cut where it is.
  const head = space > max * 0.66 ? cut.slice(0, space) : cut;
  return `${head.replace(/[\s.,;:!?…-]+$/, '')}…`;
}

/**
 * `desc` without `title` at its start. A short's caption usually opens with
 * the line the title came from, so a card would say it twice. Letters and
 * digits are compared, case and punctuation ignored.
 */
function withoutLeadingTitle(desc, title) {
  const d = String(desc || '');
  const want = String(title || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  if (!want) return d.trim();
  let i = 0;
  let matched = 0;
  for (; i < d.length && matched < want.length; i++) {
    const c = d[i].toLowerCase();
    if (!/[\p{L}\p{N}]/u.test(c)) continue;
    if (c !== want[matched]) return d.trim();
    matched++;
  }
  if (matched < want.length) return d.trim();
  return d.slice(i).replace(/^[\s.,;:!?…|\-–—]+/, '').trim();
}

// What a short's card says: a short title, and a description that does not
// repeat it (owner's call 2026-11-08: at most 50 and 100 characters).
const SHORT_TITLE_MAX = 50;
const SHORT_DESC_MAX = 100;

function shortCardText(title, description, author) {
  const rest = withoutLeadingTitle(description, title);
  return {
    title: clip(title, SHORT_TITLE_MAX),
    description: clip(rest || `A short by @${author} on 3Speak.`, SHORT_DESC_MAX),
  };
}

module.exports = { shortHeading, firstLine, videoTitle, clip, withoutLeadingTitle, shortCardText };
