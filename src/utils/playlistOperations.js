import { customJsonWithAioha, broadcastWithAioha, getOperationUser } from '../hive-api/aioha';
import { KeyTypes } from '@aioha/aioha';
import { playlistTypeFields } from '../lib/playlistType';

const PLAYLIST_PREFIX = '3speak_playlist_';

/**
 * Create a new playlist
 * @param {string} name - Playlist name
 * @param {string} access - "public" or "private"
 * @param {string} playlistId - Optional custom playlist ID
 * @param {string[]} tags - Optional tags
 * @param {string|null} type - Optional 'video' or 'audio' (lib/playlistType.js); sent to the
 *                              indexer and mirrored into json_metadata
 * @param {object|null} extraMeta - Additional fields merged into json_metadata
 *                                  (e.g. { album: { credits, musicStyle } } for an audio album)
 * @param {string|null} audioKind - For audio: 'podcast' | 'music' | 'voice' | 'sounds'
 * @returns {Promise<object>} Result from Aioha
 */
export async function createPlaylist(name, access = 'public', playlistId = null, tags = [], type = null, extraMeta = null, audioKind = null) {
  const payload = {
    name,
    access,
  };

  if (playlistId) {
    payload.playlist_id = playlistId;
  }

  const meta = {};
  if (tags.length > 0) meta.tags = tags;
  if (type) {
    const tf = playlistTypeFields(type, audioKind);
    payload.type = tf.type;
    if (tf.type === 'audio') payload.audio_kind = tf.audio_kind;
    Object.assign(meta, tf.meta);
  }
  if (extraMeta && typeof extraMeta === 'object') Object.assign(meta, extraMeta);
  if (Object.keys(meta).length > 0) {
    payload.json_metadata = JSON.stringify(meta);
  }

  return customJsonWithAioha(
    KeyTypes.Posting,
    `${PLAYLIST_PREFIX}create`,
    JSON.stringify(payload),
    'Create Playlist'
  );
}

/**
 * Add a video to a playlist
 * @param {string} playlistId - Playlist ID
 * @param {string} author - Video author
 * @param {string} permlink - Video permlink
 * @param {number} position - Position in playlist
 * @returns {Promise<object>} Result from Aioha
 */
export async function addToPlaylist(playlistId, author, permlink, position = 0) {
  const payload = {
    playlist_id: playlistId,
    author,
    permlink,
    position,
  };

  return customJsonWithAioha(
    KeyTypes.Posting,
    `${PLAYLIST_PREFIX}add`,
    JSON.stringify(payload),
    'Add to Playlist'
  );
}

/**
 * Remove a video from a playlist
 * @param {string} playlistId - Playlist ID
 * @param {string} author - Video author
 * @param {string} permlink - Video permlink
 * @returns {Promise<object>} Result from Aioha
 */
export async function removeFromPlaylist(playlistId, author, permlink) {
  const payload = {
    playlist_id: playlistId,
    author,
    permlink,
  };

  return customJsonWithAioha(
    KeyTypes.Posting,
    `${PLAYLIST_PREFIX}remove`,
    JSON.stringify(payload),
    'Remove from Playlist'
  );
}

/**
 * Reorder a video in a playlist
 * @param {string} playlistId - Playlist ID
 * @param {string} author - Video author
 * @param {string} permlink - Video permlink
 * @param {number} newPosition - New position
 * @returns {Promise<object>} Result from Aioha
 */
export async function reorderInPlaylist(playlistId, author, permlink, newPosition) {
  const payload = {
    playlist_id: playlistId,
    author,
    permlink,
    new_position: newPosition,
  };

  return customJsonWithAioha(
    KeyTypes.Posting,
    `${PLAYLIST_PREFIX}reorder`,
    JSON.stringify(payload),
    'Reorder Playlist'
  );
}

/**
 * Update a playlist (thumbnail, metadata)
 * @param {string} playlistId - Playlist ID
 * @param {object} fields - Fields to update
 * @param {string} [fields.thumbnail] - Thumbnail URL
 * @param {object} [fields.metadata] - JSON metadata object
 * @param {string} [fields.type] - 'video' | 'audio'
 * @param {string} [fields.audio_kind] - audio kind, '' to clear
 * @returns {Promise<object>} Result from Aioha
 */
export async function updatePlaylist(playlistId, fields = {}) {
  const payload = {
    playlist_id: playlistId,
  };

  if (fields.name !== undefined) {
    payload.name = fields.name;
  }
  if (fields.access !== undefined) {
    payload.access = fields.access;
  }
  if (fields.thumbnail !== undefined) {
    payload.thumbnail = fields.thumbnail;
  }
  if (fields.json_metadata !== undefined) {
    payload.json_metadata = fields.json_metadata;
  }
  if (fields.metadata !== undefined) {
    payload.metadata = fields.metadata;
  }
  if (fields.type !== undefined) {
    payload.type = fields.type;
  }
  if (fields.audio_kind !== undefined) {
    payload.audio_kind = fields.audio_kind;
  }

  return customJsonWithAioha(
    KeyTypes.Posting,
    `${PLAYLIST_PREFIX}update`,
    JSON.stringify(payload),
    'Update Playlist'
  );
}

/**
 * Delete a playlist
 * @param {string} playlistId - Playlist ID
 * @returns {Promise<object>} Result from Aioha
 */
export async function deletePlaylist(playlistId) {
  const payload = {
    playlist_id: playlistId,
  };

  return customJsonWithAioha(
    KeyTypes.Posting,
    `${PLAYLIST_PREFIX}delete`,
    JSON.stringify(payload),
    'Delete Playlist'
  );
}

/**
 * Create a playlist and add a video to it in a single transaction
 * @param {string} name - Playlist name
 * @param {string} access - "public" or "private"
 * @param {string} playlistId - Playlist ID
 * @param {string} author - Video author
 * @param {string} permlink - Video permlink
 * @returns {Promise<object>} Result from Aioha
 */
export async function createPlaylistAndAdd(name, access, playlistId, author, permlink, tags = [], typeChoice = null) {
  // These two ops are hand-assembled (they're batched into ONE transaction), so
  // they need the ButrAuth-aware username — aioha has no user for those sessions
  // and `[null]` auths come back as "Operation not allowed".
  const user = getOperationUser();
  if (!user) throw new Error('Not logged in');

  const createPayload = {
    name,
    access,
    playlist_id: playlistId,
  };

  const meta = {};
  if (tags.length > 0) meta.tags = tags;
  // typeChoice: { type: 'video' | 'audio', kind } from the create form
  if (typeChoice?.type) {
    const tf = playlistTypeFields(typeChoice.type, typeChoice.kind);
    createPayload.type = tf.type;
    if (tf.type === 'audio') createPayload.audio_kind = tf.audio_kind;
    Object.assign(meta, tf.meta);
  }
  if (Object.keys(meta).length > 0) {
    createPayload.json_metadata = JSON.stringify(meta);
  }

  const addPayload = {
    playlist_id: playlistId,
    author,
    permlink,
    position: 0,
  };

  const operations = [
    ['custom_json', {
      required_auths: [],
      required_posting_auths: [user],
      id: `${PLAYLIST_PREFIX}create`,
      json: JSON.stringify(createPayload),
    }],
    ['custom_json', {
      required_auths: [],
      required_posting_auths: [user],
      id: `${PLAYLIST_PREFIX}add`,
      json: JSON.stringify(addPayload),
    }],
  ];

  return broadcastWithAioha(operations, KeyTypes.Posting);
}

/**
 * Action types for change tracking
 */
export const PlaylistActionTypes = {
  REORDER: 'reorder',
  REMOVE: 'remove',
};

/**
 * Execute a batch of playlist changes in order
 * Each change is sent as a separate transaction to maintain order
 * @param {string} playlistId - Playlist ID
 * @param {Array} changes - Array of { type, author, permlink, newPosition? }
 * @param {Function} onProgress - Optional callback for progress updates
 * @returns {Promise<object>} Results summary
 */
export async function executePlaylistChanges(playlistId, changes, onProgress = null) {
  const results = {
    success: [],
    failed: [],
    total: changes.length,
  };

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];

    if (onProgress) {
      onProgress(i + 1, changes.length, change);
    }

    try {
      let result;

      switch (change.type) {
        case PlaylistActionTypes.REORDER:
          result = await reorderInPlaylist(
            playlistId,
            change.author,
            change.permlink,
            change.newPosition
          );
          break;

        case PlaylistActionTypes.REMOVE:
          result = await removeFromPlaylist(
            playlistId,
            change.author,
            change.permlink
          );
          break;

        default:
          throw new Error(`Unknown action type: ${change.type}`);
      }

      results.success.push({ ...change, result });
    } catch (error) {
      results.failed.push({ ...change, error: error.message });
    }
  }

  return results;
}
