// The link between a Short made from an audiogram and its episode (the audio
// post it is a piece of). Kept apart from utils/audiogramShorts.js (which
// posts them and pulls in the upload code) so the Shorts page stays light.
//
// The episode is in the Short's json_metadata ('3speak'.audiogram = { author,
// permlink }): that holds even if the Short's text is edited later. The text
// carries it too, as a "🎧 Full episode: [title](https://3speak.tv/audio/a/p)"
// line, for other Hive front ends; the Shorts page drops that line and shows
// a card instead (components/AudiogramEpisodeLink).

export const EPISODE_LINE_ICON = '🎧';

const ACCOUNT = /^[a-z][a-z0-9.-]{2,15}$/;
const PERMLINK = /^[a-z0-9-]{1,255}$/;

/** The episode a Short is a piece of, from its json_metadata (object or string): { author, permlink } or null. */
export function audiogramOfMeta(meta) {
  let jm = meta;
  if (typeof jm === 'string') {
    try { jm = JSON.parse(jm || '{}'); } catch { return null; }
  }
  const a = jm?.['3speak']?.audiogram;
  if (!a || typeof a !== 'object') return null;
  const author = String(a.author || '').toLowerCase();
  const permlink = String(a.permlink || '').toLowerCase();
  return ACCOUNT.test(author) && PERMLINK.test(permlink) ? { author, permlink } : null;
}

/** The episode's page on 3speak.tv (in the app: a path). */
export const episodePath = ({ author, permlink }) => `/audio/${author}/${permlink}`;

/**
 * A Short's text without the "🎧 Full episode: [title](…/audio/…)" line (any
 * language of the label: it is the 🎧 and the link to an audio page that count).
 */
export function stripEpisodeLine(text) {
  if (!text) return text;
  return String(text)
    .replace(/^[^\S\n]*🎧[^\n]*\]\(https:\/\/3speak\.tv\/audio\/[^)\s]+\)[^\S\n]*$/gmu, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
