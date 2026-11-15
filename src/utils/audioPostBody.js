// The body of an audio post, as the audio uploader writes it
// (components/AudioUploadModal/AudioUploadModal.jsx):
//
//   ![Title](coverUrl)              optional cover image
//
//   https://audio.3speak.tv/play?a=<permlink>
//
//   the show notes                  what the creator edits
//
//   ---                             optional sound credits
//   *Music: "Song" Artist (...)*    (utils/soundCredits.js)
//
// Editing a post changes the cover and the show notes and keeps the player
// line and the credits as they are. A body in some other shape (written by
// another app) is edited as a whole, so saving it never loses anything.

const PLAY_URL = /https?:\/\/audio\.3speak\.tv\/play\?a=/;

// The cover line, then the line holding the player link, at the very top.
const HEAD_RE = /^\s*(?:!\[([^\]]*)\]\(([^)\s]+)\)[ \t]*\n+)?([^\n]*)(?:\n+|$)/;
// The sound credits at the very end: a rule, then only *Sound: ...* / *Music: ...* lines.
const CREDITS_RE = /\n+-{3,}[ \t]*\n+(?:\*(?:Sound|Music): [^\n]*\*[ \t]*\n*)+$/;

/**
 * Split an audio post body.
 * @returns {{ hasHead: boolean, coverAlt: string, coverUrl: string, playLine: string, notes: string, credits: string }}
 *   `credits` keeps its own leading "---" rule (no leading newlines).
 */
export function splitAudioBody(body) {
  const src = typeof body === 'string' ? body.replace(/\r\n/g, '\n') : '';
  const none = { hasHead: false, coverAlt: '', coverUrl: '', playLine: '', notes: src.trim(), credits: '' };
  if (!src.trim()) return none;

  const head = src.match(HEAD_RE);
  if (!head || !PLAY_URL.test(head[3])) return none;
  const rest = src.slice(head[0].length);

  const tail = rest.match(CREDITS_RE);
  const credits = tail ? tail[0].replace(/^\n+/, '') : '';
  const notes = (tail ? rest.slice(0, tail.index) : rest).trim();

  return {
    hasHead: true,
    coverAlt: head[1] || '',
    coverUrl: head[2] || '',
    playLine: head[3].trim(),
    notes,
    credits,
  };
}

/**
 * Put an audio post body back together from the pieces of splitAudioBody, with
 * the edited notes and cover. An empty `coverUrl` writes no cover line.
 */
export function joinAudioBody({ hasHead, coverUrl, coverAlt, playLine, notes, credits }) {
  const text = String(notes || '').trim();
  if (!hasHead) return text;
  const alt = String(coverAlt || 'cover').replace(/[[\]]/g, '') || 'cover';
  const cover = coverUrl ? `![${alt}](${coverUrl})\n\n` : '';
  const main = `${cover}${playLine}${text ? `\n\n${text}` : ''}`;
  return credits ? `${main}\n\n${credits}` : main;
}
