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

module.exports = { shortHeading, firstLine, videoTitle };
