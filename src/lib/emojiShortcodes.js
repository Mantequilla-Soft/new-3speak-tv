// `:shortcode:` emoji typing, shared by the chat composer (Chat/EmojiTextInput)
// and the comment boxes (hooks/useEmojiShortcodes):
//  - ":" after a space or at the start opens a list of emojis,
//  - ":fi" filters it, ↑/↓ move, Enter/Tab insert, Esc closes,
//  - a closing ":" (":fire:") turns the word into the emoji right away.
// Pure functions on (text, cursor), so both UIs behave the same.
import { search as searchEmoji, get as getEmoji } from 'node-emoji';

// Common emojis shown the moment ":" is typed (before a query is entered).
export const POPULAR_EMOJIS = ['joy', 'heart', 'fire', '+1', 'pray', 'tada', '100', 'eyes', 'sob', 'rocket']
  .map((name) => ({ name, emoji: getEmoji(name) }))
  .filter((e) => e.emoji);

const OPEN_RE = /(?:^|\s):([a-z0-9_+-]*)$/i;
const CLOSE_RE = /(:([a-z0-9_+-]+):)$/i;
const MAX_ITEMS = 8;

// node-emoji's search has no ranking (":fire" listed the firefighters before 🔥),
// so: the exact name, then names starting with the query (shortest first), then a
// word inside the name ("_fi"), then anything containing it.
function rank(name, q) {
  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  if (name.includes(`_${q}`)) return 2;
  return 3;
}

// node-emoji turns a string query into a RegExp as is, so ":+" threw ("Nothing
// to repeat"). Escaped, it matches "+1" literally.
function search(q) {
  try {
    return searchEmoji(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } catch {
    return [];
  }
}

// The list to show for the text before the cursor, or null (no open ":word").
export function emojiSuggestions(value, cursor) {
  const m = value.slice(0, cursor).match(OPEN_RE);
  if (!m) return null;
  const q = m[1].toLowerCase();
  const items = q.length === 0
    ? POPULAR_EMOJIS
    : search(q)
      .map((e, i) => ({ e, r: rank(e.name, q), i }))
      .sort((a, b) => a.r - b.r || (a.r === 1 ? a.e.name.length - b.e.name.length : 0) || a.i - b.i)
      .slice(0, MAX_ITEMS)
      .map(({ e }) => e);
  return items.length ? items : null;
}

// A ":word:" just closed at the cursor that names an emoji → { value, cursor } with
// the emoji in its place; null otherwise (":not-an-emoji:" stays as typed).
export function convertClosedShortcode(value, cursor) {
  const closed = value.slice(0, cursor).match(CLOSE_RE);
  if (!closed) return null;
  const em = getEmoji(closed[2]);
  if (!em) return null;
  const start = cursor - closed[1].length;
  return { value: value.slice(0, start) + em + value.slice(cursor), cursor: start + em.length };
}

// The open ":word" at the cursor replaced by the picked emoji and a space.
export function insertPickedEmoji(value, cursor, emoji) {
  const m = value.slice(0, cursor).match(OPEN_RE);
  if (!m) return null;
  const colonIdx = cursor - (m[1].length + 1);
  const insert = `${emoji} `;
  return { value: value.slice(0, colonIdx) + insert + value.slice(cursor), cursor: colonIdx + insert.length };
}
