/**
 * Helpers for rendering Hive notifications.
 *
 * A notification's `url` field has one of these shapes:
 *   - "author/permlink"       → a post or comment
 *   - "@author"               → a profile
 *   - "trx:<id>"              → a transaction (no useful in-app route)
 */

/**
 * If the notification points to a post or comment (author/permlink form),
 * return "author/permlink". Otherwise null.
 */
export function getNotificationPostKey(notif) {
  if (!notif?.url) return null;
  const raw = notif.url;
  if (raw.startsWith('trx:')) return null;
  // Hive sometimes returns "@author/permlink", sometimes "author/permlink".
  // Profile-only URLs ("@author" with no slash) aren't posts.
  if (raw.startsWith('@') && !raw.includes('/')) return null;
  const normalized = raw.startsWith('@') ? raw.slice(1) : raw;
  const [author, permlink] = normalized.split('/');
  if (author && permlink) return `${author}/${permlink}`;
  return null;
}

/**
 * Parse the notification URL into an in-app route, preferring Watch for
 * 3Speak-style video permlinks (we just detect author/permlink and send them
 * to /watch — if it's not a video, Watch falls back to the Hive post renderer
 * via the profile page / blog content). Falls back to profile pages.
 *
 * We special-case mentions so they route to the *mentioner's* post, not the
 * user's own profile.
 */
export function getNotificationRoute(notif) {
  if (!notif || !notif.url) return null;
  const raw = notif.url;

  // @username profile
  if (raw.startsWith('@') && !raw.includes('/')) {
    return `/@${raw.slice(1)}`;
  }

  // trx:... — nothing to link to
  if (raw.startsWith('trx:')) return null;

  // author/permlink — route to the universal post view, which redirects
  // to /watch if this turns out to be a 3Speak video post.
  // Strip leading "@" if present (Hive sometimes returns "@author/permlink").
  const normalized = raw.startsWith('@') ? raw.slice(1) : raw;
  const [author, permlink] = normalized.split('/');
  if (author && permlink) {
    return `/post/${author}/${permlink}`;
  }

  // Bare author (fallback)
  if (author) return `/@${author}`;

  return null;
}

/**
 * Extract the "actor" (the account that triggered the notification) from the
 * notification message. Hive's `msg` always starts with "@username " + verb.
 */
export function getNotificationActor(notif) {
  if (!notif?.msg) return null;
  const m = notif.msg.match(/^@([a-z0-9.-]+)/i);
  return m ? m[1] : null;
}

const TYPE_LABELS = {
  reply: 'replied',
  reply_comment: 'replied',
  mention: 'mentioned you',
  vote: 'upvoted',
  follow: 'followed you',
  reblog: 'reblogged',
  transfer: 'sent you',
  delegate_vests: 'delegated HP to you',
  receive_vesting: 'sent you HP',
  powerdown: 'started a power down',
  subscribe: 'subscribed',
  pin_post: 'pinned your post',
  unpin_post: 'unpinned your post',
};

export function getNotificationTypeLabel(type) {
  return TYPE_LABELS[type] || type || 'did something';
}

/**
 * Tidy the notification text Hive hands us.
 *
 * `bridge.account_notifications` builds `msg` from a raw count with no
 * pluralisation, so a mention of nobody else arrives as
 * "@alice mentioned you and 0 others" and one other as "... and 1 others".
 * Verified straight off the API, so this is upstream text, not ours to fix at
 * the source: drop the clause when there is nobody else, and singularise it
 * when there is exactly one. Any other count is already correct and untouched.
 */
export function formatNotificationMsg(msg) {
  if (typeof msg !== 'string' || !msg) return msg;
  return msg
    .replace(/\s+and\s+0\s+others\b/i, '')
    .replace(/\s+and\s+1\s+others\b/i, ' and 1 other');
}

/** Short relative time like "5m", "3h", "2d". */
export function formatNotifTime(dateString) {
  if (!dateString) return '';
  // Hive returns UTC timestamps without a timezone suffix
  const date = new Date(dateString + (dateString.endsWith('Z') ? '' : 'Z'));
  const diffSec = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (diffSec < 60) return `${diffSec}s`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 30) return `${diffD}d`;
  const diffMo = Math.floor(diffD / 30);
  if (diffMo < 12) return `${diffMo}mo`;
  return `${Math.floor(diffMo / 12)}y`;
}
