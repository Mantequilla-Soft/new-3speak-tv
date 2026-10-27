// A short's title.
//
// Shorts are Hive COMMENTS, which carry no title of their own, so 3Speak used to
// make one up from the caption (the opening of the body). Since 2026-10-27 the
// shorts uploader asks for a title and writes it as a `## Title` line at the very
// top of the post, which every Hive app renders as a heading. When the first line
// of the body is that heading, it IS the short's title everywhere on 3Speak, and
// the caption is the rest of the body. Older shorts, and shorts posted from other
// apps, have no such line and keep the old caption-derived titles.
//
// server/og-server.cjs reads the same line for share cards; keep the two in step.

export const SHORT_TITLE_MAX = 100;

// Exactly two #: a `#` or `###` first line is the creator's own markdown, not ours.
const HEADING_RE = /^##(?!#)[ \t]*(.*)$/;

// Inline markdown and HTML out, one line, capped.
function cleanTitle(text) {
  const t = String(text || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]+/g, '')
    .replace(/\s+#+\s*$/, '') // closing hashes: "## Title ##"
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > SHORT_TITLE_MAX ? `${t.slice(0, SHORT_TITLE_MAX - 1).trimEnd()}…` : t;
}

/**
 * Split a short's body into its `## Title` heading and the rest.
 * No heading (or an empty one) → { heading: '', rest: body } unchanged.
 */
export function splitShortHeading(body) {
  const src = String(body || '').replace(/\r\n/g, '\n');
  const lines = src.split('\n');
  const i = lines.findIndex((l) => l.trim());
  const m = i >= 0 ? lines[i].trim().match(HEADING_RE) : null;
  const heading = m ? cleanTitle(m[1]) : '';
  if (!heading) return { heading: '', rest: src };
  return { heading, rest: lines.slice(i + 1).join('\n').replace(/^\s*\n/, '') };
}

/** The `## Title` heading of a short's body, or '' when it has none. */
export const shortHeading = (body) => splitShortHeading(body).heading;

/** What the uploader and the edit dialog write: the title as a heading on top of the body. */
export function withShortHeading(title, body) {
  const t = cleanTitle(String(title || '').replace(/^#+\s*/, ''));
  const rest = String(body || '').replace(/^\s+/, '');
  return t ? `## ${t}\n\n${rest}` : rest;
}
