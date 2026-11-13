import { resolveSnapsContainer } from './snapsContainer';

// Returns { author, permlink } for the newest @peak.snaps container. The
// lookup itself (multi-node, multi-API, retried) lives in snapsContainer.js.
export async function fetchLatestSnapsPost() {
  return resolveSnapsContainer();
}

export function buildOpenPodSnapBody(roomTitle, roomUrl, thumbnailUrl) {
  const thumbnail = thumbnailUrl ? `![${roomTitle || 'OpenPod'}](${thumbnailUrl})\n\n` : '';
  return `${thumbnail}🎙️ **${roomTitle || 'OpenPod Live'}**\n\nI just started an OpenPod — come join the conversation!\n\n${roomUrl}`;
}

export function buildOpenPodPermlink() {
  return `openpod-${Date.now()}`;
}

export function buildOpenPodSnapMetadata(roomName) {
  return {
    app: '3speak/openpod',
    format: 'markdown',
    tags: ['3speak', 'openpod', 'hive-181335'],
    type: 'openpod',
    room: roomName,
  };
}

/**
 * Where a visitor of `/openpods/<room>` belongs, or null to open the room here.
 *
 * `/openpods/<room>` is the streamer's own studio address, so it gets shared by
 * copying the address bar. A stream's VIEWERS belong on its watch page
 * (`/watch/<room>`, which hands a stream posted to Hive on to the post's page),
 * not in the studio. Group chats (conference rooms) have no watch page, and the
 * host stays in their studio.
 */
export function streamViewerPath(room, user) {
  if (!room || room.mode !== 'standalone' || !room.name || !room.host) return null;
  if (user && String(user).toLowerCase() === String(room.host).toLowerCase()) return null;
  return `/watch/${encodeURIComponent(room.name)}`;
}
