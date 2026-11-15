/**
 * Comment inbox: the comments people left for a creator across all their posts
 * (checker POST /creator-inbox, from HafSQL), each flagged answered / question /
 * firstTime / supporter / done. "Done" is kept on the checker per creator
 * (POST /creator-inbox/done), so it follows them to every device.
 *
 * Both calls carry the session vouch the podcast progress already holds
 * (lib/podcastProgress.js sessionVouch).
 */
import { CHECKER_URL } from '../utils/config';
import { sessionVouch } from './podcastProgress';

const API = `${CHECKER_URL}/creator-inbox`;

async function post(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`comment inbox ${path || '/'}: ${res.status}`);
  return res.json();
}

/** { days, items } for the signed-in creator. */
export async function fetchCommentInbox(user) {
  const v = await sessionVouch(user);
  if (!v) throw new Error('not signed in');
  const data = await post('', { user, signature: v.signature, timestamp: v.timestamp });
  return { days: data.days || 90, items: Array.isArray(data.items) ? data.items : [] };
}

/** Mark one comment done (or not, for Undo). */
export async function setCommentDone(user, author, permlink, done = true) {
  const v = await sessionVouch(user);
  if (!v) throw new Error('not signed in');
  return post('/done', { user, signature: v.signature, timestamp: v.timestamp, author, permlink, done });
}

export const INBOX_VIEWS = ['unanswered', 'all', 'done'];
export const INBOX_FLAGS = ['question', 'firstTime', 'supporter'];

/**
 * What the inbox shows: `view` unanswered (not replied to, not done; the
 * default), all (everything not done) or done; then every picked flag must hold.
 */
export function filterInbox(items, { view = 'unanswered', flags = [] } = {}) {
  return (items || []).filter((it) => {
    if (view === 'done' ? !it.done : it.done) return false;
    if (view === 'unanswered' && it.answered) return false;
    return flags.every((f) => it[f]);
  });
}

/** How many of each flag the current view holds (the chips' counts). */
export function flagCounts(items, view) {
  const base = filterInbox(items, { view });
  return Object.fromEntries(INBOX_FLAGS.map((f) => [f, base.filter((it) => it[f]).length]));
}
