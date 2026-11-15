/**
 * Sounds: the audio a Short uses, its page (/sound/:id, page/SoundPage.jsx) and
 * "Use this sound".
 *
 * The checker indexes which Short uses which sound (3speakchecks
 * services/soundIndex.js) and answers GET /sounds/:id and /sounds/trending.
 * Ids are shared with it (utils/soundIds.js there; keep the two in step):
 *   lib-<slug>                 a song from the editor's music library
 *   short_<author>_<permlink>  the original audio of a Hive post (the Hive
 *                              author/permlink, not the upload's asset permlink)
 *   ext-<10 hex>               another credited song, named by title + artist
 *
 * A Short made with "Use this sound" credits it like a 3Speak library sound
 * (utils/soundCredits.js): `source: '3speak'` + the original creator's
 * `account`, so publishing gives them the locked 5% beneficiary, and its
 * `json_metadata.video.sound` carries the sound's `id` and page `url`.
 */
import { CHECKER_URL } from '../utils/config';

const SOUND_ID = /^(lib-[a-z0-9][a-z0-9-]{0,79}|short_[a-z][a-z0-9.-]{1,14}[a-z0-9]_[a-z0-9-]{1,255}|ext-[0-9a-f]{10})$/;
const ACCOUNT = /^[a-z][a-z0-9.-]{1,14}[a-z0-9]$/;
const PERMLINK = /^[a-z0-9-]{1,255}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
const PAGE_URL = /^https?:\/\/(?:www\.)?3speak\.tv\/sound\/([^/?#]+)/i;
export const SOUND_PAGE_ORIGIN = 'https://3speak.tv';

export const isSoundId = (id) => typeof id === 'string' && id.length <= 300 && SOUND_ID.test(id);

/** The id of a post's own audio, or null. */
export function shortSoundId(author, permlink) {
  const a = String(author || '').toLowerCase().replace(/^@/, '');
  const p = String(permlink || '').toLowerCase();
  return ACCOUNT.test(a) && PERMLINK.test(p) ? `short_${a}_${p}` : null;
}

/** { kind, author?, permlink?, slug? } for a valid id, else null. */
export function parseSoundId(id) {
  if (!isSoundId(id)) return null;
  if (id.startsWith('lib-')) return { kind: 'library', slug: id.slice(4) };
  if (id.startsWith('ext-')) return { kind: 'external' };
  const rest = id.slice('short_'.length);
  const cut = rest.indexOf('_');
  return { kind: 'short', author: rest.slice(0, cut), permlink: rest.slice(cut + 1) };
}

/**
 * The id of the sound a post's `json_metadata.video.sound` names, or null when it
 * names none (then the post uses its own audio, shortSoundId). An older post that
 * only names a song by title has no id here: the checker resolves those.
 */
export function soundIdOfSound(sound) {
  if (!sound || typeof sound !== 'object' || !sound.title) return null;
  const raw = typeof sound.id === 'string' ? sound.id.trim().toLowerCase() : '';
  if (isSoundId(raw)) return raw;
  const page = PAGE_URL.exec(String(sound.url || ''));
  if (page) {
    let fromUrl;
    try { fromUrl = decodeURIComponent(page[1]).toLowerCase(); } catch { fromUrl = ''; }
    if (isSoundId(fromUrl)) return fromUrl;
  }
  return null;
}

/**
 * The sound page of a Short, or null: its song's page when it names one, else
 * the page of its own audio. Needs the Hive post (a Short that is not on Hive
 * has no page).
 */
export function soundPathOf({ sound, author, hivePermlink } = {}) {
  const named = soundIdOfSound(sound);
  if (named) return `/sound/${named}`;
  // A song credited by name only (before sound ids): no page to point at.
  if (sound && typeof sound === 'object' && sound.title) return null;
  const own = shortSoundId(author, hivePermlink);
  return own ? `/sound/${own}` : null;
}

/** The id a library credit (editor music library, `id` = library id) goes under. */
export function libraryCreditSoundId(credit) {
  const raw = typeof credit?.id === 'string' ? credit.id.trim().toLowerCase() : '';
  if (isSoundId(raw)) return raw;
  return credit?.source !== '3speak' && SLUG.test(raw) ? `lib-${raw}` : null;
}

// ─── The checker ──────────────────────────────────────────────────────────────

const API = `${CHECKER_URL}/sounds`;

async function getJson(url) {
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`sounds ${res.status}`);
  return res.json();
}

/** { sound, original, uses, shorts, page, totalPages } or null (no such sound). */
export function fetchSound(id, { sort = 'new', page = 1, limit = 24 } = {}) {
  if (!isSoundId(id)) return Promise.resolve(null);
  const q = new URLSearchParams({ sort, page: String(page), limit: String(limit) });
  return getJson(`${API}/${encodeURIComponent(id)}?${q}`);
}

/** [{ id, kind, title, artist, uses, original? }] most used lately. */
export async function fetchTrendingSounds(limit = 12) {
  const data = await getJson(`${API}/trending?limit=${limit}`);
  return Array.isArray(data?.sounds) ? data.sounds : [];
}

// ─── Using a sound ────────────────────────────────────────────────────────────

/**
 * The music credit for a sound (the shape the editor sends as `musicCredits`,
 * utils/soundCredits.js sanitizeMusicCredits). A Short's audio is a 3Speak sound
 * of its creator: the publish step gives them the 5% split. null when the sound
 * cannot be credited (no title, or a Short sound without a valid creator).
 */
export function soundCredit(sound) {
  const parsed = parseSoundId(sound?.id);
  if (!parsed) return null;
  const page = `${SOUND_PAGE_ORIGIN}/sound/${sound.id}`;
  if (parsed.kind === 'short') {
    return {
      id: sound.id,
      title: String(sound.title || '').slice(0, 100) || `@${parsed.author}`,
      artist: `@${parsed.author}`,
      source: '3speak',
      account: parsed.author,
      sourceUrl: page,
    };
  }
  if (!sound.title) return null;
  return {
    id: sound.id,
    title: String(sound.title).slice(0, 100),
    artist: String(sound.artist || '').slice(0, 100),
    source: sound.source || null,
    sourceUrl: sound.url || page,
    license: sound.license || null,
    ...(sound.account ? { account: sound.account } : {}),
  };
}
