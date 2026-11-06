/**
 * What a playlist is: `video` or `audio`, and for audio one of AUDIO_KINDS.
 *
 * Where it lives: the playlists indexer (3speak-playlists) keeps a top-level
 * `type` ('video' | 'audio') and `audio_kind`. Every playlist made before the
 * owner could pick a type was stored as `video` by default, so a top-level
 * `video` on its own says nothing. The site therefore also writes the choice
 * into `json_metadata.type` / `json_metadata.audio_kind`, and only those (or a
 * top-level `audio` / `audio_kind`) count as the owner's own choice. Album
 * uploads have written `json_metadata.type: 'audio'` all along.
 *
 * With no choice stored, the type is worked out from the items: all audio is
 * an audio playlist, and the kind is what most tracks are.
 */

export const AUDIO_KINDS = ['podcast', 'music', 'voice', 'sounds'];

const isKind = (k) => AUDIO_KINDS.includes(k);

/** An audio upload's category (AudioUploadModal track types) as a playlist kind. */
export function trackCategoryToKind(category) {
  switch (category) {
    case 'song':
    case 'music':
      return 'music';
    case 'voice_message':
    case 'voice':
      return 'voice';
    case 'podcast':
    case 'interview':
    case 'audiobook':
      return 'podcast';
    default:
      return 'sounds';
  }
}

/** The most common kind among audio categories, ties going to the earlier kind in AUDIO_KINDS. */
export function kindFromCategories(categories) {
  const counts = new Map();
  for (const c of categories) {
    const k = trackCategoryToKind(c);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let best = null;
  for (const k of AUDIO_KINDS) {
    if ((counts.get(k) || 0) > (best ? counts.get(best) : 0)) best = k;
  }
  return best;
}

function parseJsonMeta(m) {
  if (!m) return {};
  if (typeof m === 'object') return Array.isArray(m) ? {} : m;
  try {
    let v = JSON.parse(m);
    // Some writers encoded it twice.
    if (typeof v === 'string') v = JSON.parse(v);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** The type and kind the owner chose, or nulls when they never chose one. */
export function storedPlaylistType(playlist) {
  if (!playlist) return { type: null, kind: null };
  const jm = parseJsonMeta(playlist.json_metadata);
  const kind = isKind(playlist.audio_kind) ? playlist.audio_kind : isKind(jm.audio_kind) ? jm.audio_kind : null;
  let type = null;
  if (jm.type === 'video' || jm.type === 'audio') type = jm.type;
  else if (playlist.type === 'audio' || kind) type = 'audio';
  return { type, kind: type === 'audio' ? kind : null };
}

/**
 * The type and kind to show a playlist as.
 * @param {object} playlist  as the playlists API returns it
 * @param {Array<{isAudio?: boolean, category?: string}>|null} items  the loaded
 *        items, or null while they load
 * @returns {{type: 'video'|'audio'|null, kind: string|null, chosen: boolean}}
 *        type is null only while nothing is stored and the items are not in yet
 */
export function resolvePlaylistType(playlist, items) {
  const stored = storedPlaylistType(playlist);
  const audioCategories = (items || []).filter((i) => i.isAudio).map((i) => i.category);
  let type = stored.type;
  if (!type && items) {
    type = items.length > 0 && items.every((i) => i.isAudio) ? 'audio' : 'video';
  }
  let kind = stored.kind;
  if (type === 'audio' && !kind) kind = kindFromCategories(audioCategories) || 'podcast';
  return { type, kind: type === 'audio' ? kind : null, chosen: !!stored.type };
}

/**
 * Fields for a playlist create / update op: the top-level ones the indexer
 * reads, and the json_metadata ones that mark the choice as the owner's.
 */
export function playlistTypeFields(type, kind) {
  if (type !== 'audio') return { type: 'video', audio_kind: '', meta: { type: 'video' } };
  const k = isKind(kind) ? kind : 'podcast';
  return { type: 'audio', audio_kind: k, meta: { type: 'audio', audio_kind: k } };
}
