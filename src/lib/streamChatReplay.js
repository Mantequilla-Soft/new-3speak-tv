import { getHiveClient } from '../utils/hiveNode';
import { getHangoutsEndpoints } from '../utils/hangoutsEndpoints';

/**
 * The live chat of a stream, for its VOD.
 *
 * useStreamChatMirror writes every signed-in chatter's line as a Hive comment
 * on the stream's post, with `parentTimestamp` (seconds into the stream) in its
 * json_metadata and a "said at [mm:ss](...) during the live stream" footer. The
 * VOD is published under the same author/permlink, so those comments are the
 * replay: read them, keep the mirrored ones, strip the footer, sort by time.
 * The polls the host ran come from the hangouts server (GET /rooms/:name/polls),
 * placed at the second they started.
 */

// The footer the mirror appends (see useStreamChatMirror).
const FOOTER = /\s*(?:<br\s*\/?>)?\s*<sup>\s*said at [^<]*?during the live stream\s*<\/sup>\s*$/i;

function meta(c) {
  if (!c?.json_metadata) return {};
  if (typeof c.json_metadata === 'object') return c.json_metadata;
  try { return JSON.parse(c.json_metadata) || {}; } catch { return {}; }
}

/** Mirrored live-chat lines out of a post's replies, oldest first. */
export function parseChatReplay(replies) {
  if (!Array.isArray(replies)) return [];
  const out = [];
  for (const c of replies) {
    const m = meta(c);
    const body = typeof c?.body === 'string' ? c.body : '';
    if (typeof m.parentTimestamp !== 'number' || !FOOTER.test(body)) continue;
    const text = body.replace(FOOTER, '').trim();
    if (!text) continue;
    out.push({
      id: `${c.author}/${c.permlink}`,
      user: c.author,
      text,
      offset: Math.max(0, Math.floor(m.parentTimestamp)),
      created: c.created || '',
    });
  }
  return out.sort((a, b) => (a.offset - b.offset) || String(a.created).localeCompare(String(b.created)));
}

export async function fetchChatReplay(author, permlink) {
  const replies = await getHiveClient().call('condenser_api', 'get_content_replies', [author, permlink]);
  return parseChatReplay(replies);
}

/**
 * Finished polls of a stream. The room may be gone and its server is not
 * recorded with the VOD, so every configured deployment is asked; the first
 * that knows the stream answers.
 */
export async function fetchStreamPolls(roomName, endpoints = getHangoutsEndpoints()) {
  for (const ep of endpoints) {
    try {
      const res = await fetch(`${ep.api}/rooms/${encodeURIComponent(roomName)}/polls`);
      if (!res.ok) continue;
      const body = await res.json();
      const polls = Array.isArray(body?.polls) ? body.polls.filter((p) => p && typeof p.question === 'string' && Array.isArray(p.options)) : [];
      if (polls.length) return polls;
    } catch { /* next deployment */ }
  }
  return [];
}

/** Chat lines and polls on one timeline. A poll with no stream time goes first. */
export function replayTimeline(lines, polls) {
  const items = [
    ...lines.map((l) => ({ type: 'chat', key: l.id, offset: l.offset, line: l })),
    ...polls.map((p) => ({ type: 'pollCard', key: `poll-${p.id}`, offset: typeof p.offset === 'number' ? p.offset : 0, poll: p })),
  ];
  return items.sort((a, b) => a.offset - b.offset);
}

/** Index of the last item at or before `time` (seconds), or -1. */
export function currentIndex(items, time) {
  let lo = 0;
  let hi = items.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid].offset <= time) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

/** The option a finished poll ended on: the resolved outcome, else the most votes. */
export function pollOutcome(p) {
  if (p.status === 'cancelled') return null;
  if (typeof p.winner === 'number') return p.winner;
  const score = (o) => (p.kind === 'prediction' ? (o.points || 0) : (o.votes || 0));
  let best = -1;
  let top = 0;
  p.options.forEach((o, i) => { if (score(o) > top) { top = score(o); best = i; } });
  return best >= 0 ? best : null;
}
