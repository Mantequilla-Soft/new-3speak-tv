import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { establishWalletSession } from '../hive-api/aioha';
import { CHECKER_URL } from '../utils/config';
import { GRID_COLUMNS, clampSpan } from './profileLayoutGrid';

export * from './profileLayoutGrid';

// 🧩 The order and settings of the sections on a channel's Overview tab.
//
// Stored in Mongo by our own API (server/profile-layout.cjs), which caches reads
// and only lets a verified owner write. No stored layout = DEFAULT_SECTIONS, so
// a creator who never opens the editor keeps today's Overview exactly.

// Must stay in step with TYPES in server/profile-layout.cjs.
//   count:     [min, max, default] entries shown
//   view:      default 'row' (sideways rail) or 'grid' (wrapping rows)
//   title:     the heading can be renamed
//   multi:     may be added more than once (one per playlist)
//   size:      [options..., default] (the trailer's player width)
//   flags:     on/off switches and their defaults
// Every section also has a `span`: its width in GRID_COLUMNS, default the full
// row (see ./profileLayoutGrid.js). `links` has a `side`: a sticky column on
// the left or right of the grid, or 'none' = a section in the grid.
export const LINKS_SIDES = ['right', 'left', 'none'];
export const SECTION_DEFS = {
  trailer: {
    labelKey: 'profile.layout.types.trailer',
    size: ['sm', 'md', 'lg', 'full', 'md'],
    flags: { showInfo: true, showSnap: true },
  },
  live: { labelKey: 'profile.layout.types.live' },
  videos: { labelKey: 'profile.overview.videos', count: [1, 20, 20], view: 'row', title: true },
  shorts: { labelKey: 'profile.overview.shorts', count: [1, 20, 20], view: 'row', title: true },
  audio: { labelKey: 'profile.overview.audio', count: [1, 40, 6], view: 'row', title: true },
  audioPlaylists: { labelKey: 'profile.layout.types.audioPlaylists', count: [1, 24, 6], view: 'row', title: true },
  community: { labelKey: 'profile.overview.community', count: [1, 20, 6], view: 'row', title: true },
  playlistRails: { labelKey: 'profile.layout.types.playlistRails', count: [1, 20, 10], view: 'row', playlists: [1, 10, 5] },
  playlist: { labelKey: 'profile.layout.types.playlist', count: [1, 20, 10], view: 'row', title: true, multi: true },
  playlists: { labelKey: 'profile.overview.playlists', count: [1, 50, 6], view: 'row', title: true },
  links: { labelKey: 'profile.layout.types.links', side: 'right' },
};

// Today's Overview, in today's order. Audio playlists are new, so they start
// switched off for everyone rather than appearing on every profile at once.
export const DEFAULT_SECTIONS = [
  { id: 'trailer', type: 'trailer' },
  { id: 'live', type: 'live' },
  { id: 'videos', type: 'videos' },
  { id: 'shorts', type: 'shorts' },
  { id: 'audio', type: 'audio' },
  { id: 'community', type: 'community' },
  { id: 'playlistrails', type: 'playlistRails' },
  { id: 'playlists', type: 'playlists' },
  { id: 'audioplaylists', type: 'audioPlaylists', hidden: true },
  { id: 'links', type: 'links' },
];

/** A section's settings with every default filled in. */
export function withDefaults(section) {
  const def = SECTION_DEFS[section.type] || {};
  return {
    ...section,
    hidden: section.hidden === true,
    ...(def.count ? { count: section.count ?? def.count[2] } : {}),
    ...(def.view ? { view: section.view || def.view } : {}),
    ...(def.playlists ? { playlists: section.playlists ?? def.playlists[2] } : {}),
    ...(def.side ? { side: LINKS_SIDES.includes(section.side) ? section.side : def.side } : {}),
    ...(def.size ? { size: def.size.slice(0, -1).includes(section.size) ? section.size : def.size.at(-1) } : {}),
    ...Object.fromEntries(Object.entries(def.flags || {}).map(([k, d]) => [k, typeof section[k] === 'boolean' ? section[k] : d])),
    span: clampSpan(section.span ?? GRID_COLUMNS),
    stack: section.stack === true,
  };
}

/**
 * The stored layout, made safe to render: unknown types dropped, and any single
 * section type the creator's saved layout predates appended switched OFF (so a
 * new kind of section never lands on a profile the owner arranged by hand).
 */
export function normalizeLayout(sections) {
  if (!Array.isArray(sections)) return DEFAULT_SECTIONS.map(withDefaults);
  const out = sections.filter((s) => s && SECTION_DEFS[s.type]).map(withDefaults);
  const have = new Set(out.map((s) => s.type));
  DEFAULT_SECTIONS.forEach((d) => {
    if (!SECTION_DEFS[d.type].multi && !have.has(d.type)) out.push(withDefaults({ ...d, hidden: true }));
  });
  return out;
}

// ── the phone layout ────────────────────────────────────────────────────────
// Phones show one column. Their order, visibility and per-section settings can
// differ from the desktop's (`mobile` in the stored layout); without one, they
// follow the desktop layout in reading order. The links page never shows on a
// phone (its header has the Links button instead).

// Settings a phone keeps of its own; everything else comes from the desktop
// section (its type, its playlist...).
const MOBILE_FIELDS = ['hidden', 'count', 'view', 'title', 'playlists', 'showInfo'];

/**
 * The phone's sections: the stored mobile entries that still exist on the
 * desktop, with their own settings, then any desktop section they predate (as
 * on the desktop). `stored` null = the desktop's order and settings.
 */
export function mobileSections(desktop, stored) {
  const pool = desktop.filter((s) => s.type !== 'links');
  if (!Array.isArray(stored)) return pool.map((s) => ({ ...s, stack: false, span: GRID_COLUMNS }));
  const byId = new Map(pool.map((s) => [s.id, s]));
  const seen = new Set();
  const out = [];
  stored.forEach((m) => {
    const d = byId.get(m?.id);
    if (!d || seen.has(d.id)) return;
    seen.add(d.id);
    const own = Object.fromEntries(MOBILE_FIELDS.filter((k) => k in m).map((k) => [k, m[k]]));
    out.push(withDefaults({ ...d, ...own, stack: false, span: GRID_COLUMNS }));
  });
  pool.forEach((d) => { if (!seen.has(d.id)) out.push({ ...d, stack: false, span: GRID_COLUMNS }); });
  return out;
}

/** Move `activeId` above (top) or below (bottom) `overId` in a single column. */
export function moveInColumn(list, activeId, overId, side) {
  const active = list.find((s) => s.id === activeId);
  if (!active || activeId === overId) return list;
  const rest = list.filter((s) => s.id !== activeId);
  const at = rest.findIndex((s) => s.id === overId) + (side === 'bottom' ? 1 : 0);
  rest.splice(at < 0 ? rest.length : at, 0, active);
  return rest;
}

export function newSectionId(type) {
  return `${type.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function fetchProfileLayout(user) {
  const res = await fetch(`/api/profile-layout/${encodeURIComponent(String(user).toLowerCase())}`);
  if (!res.ok) throw new Error(`layout ${res.status}`);
  const data = await res.json();
  return data.layout || null;
}

export function useProfileLayout(user) {
  return useQuery({
    queryKey: ['profile-layout', String(user || '').toLowerCase()],
    queryFn: () => fetchProfileLayout(user),
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

// Writes go with the session cookie. No session yet (401): HiveSigner gets one
// silently, a wallet login signs once, then the write is tried again. Same
// rules as the editor drafts session (utils/editorDraftSession.js).
async function ownerRequest(method, user, body) {
  const send = () => fetch('/api/profile-layout', {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: String(user).toLowerCase(), ...body }),
  });
  let res = await send();
  if (res.status === 401) {
    try { await establishWalletSession(user); } catch { /* declined or failed */ }
    res = await send();
  }
  if (!res.ok) {
    const err = new Error(res.status === 401 ? 'sign-in-needed' : `layout ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return (await res.json()).layout || null;
}

// Defaults are not stored: a value equal to its default is left out, so a later
// change of default still reaches sections the creator never touched.
function compact(section) {
  const def = SECTION_DEFS[section.type] || {};
  const s = { id: section.id, type: section.type };
  if (section.hidden) s.hidden = true;
  if (def.count && section.count !== def.count[2]) s.count = section.count;
  if (def.view && section.view !== def.view) s.view = section.view;
  if (def.title && section.title?.trim()) s.title = section.title.trim();
  if (def.playlists && section.playlists !== def.playlists[2]) s.playlists = section.playlists;
  if (def.side && section.side !== def.side) s.side = section.side;
  if (def.size && section.size !== def.size.at(-1)) s.size = section.size;
  Object.entries(def.flags || {}).forEach(([k, d]) => { if (section[k] !== d) s[k] = section[k]; });
  if (section.span != null && section.span !== GRID_COLUMNS) s.span = section.span;
  if (section.stack) s.stack = true;
  if (section.playlistId) s.playlistId = section.playlistId;
  return s;
}

// The phone layout keeps only what a single column can use (server: sanitizeMobile).
const MOBILE_ONLY_DESKTOP = ['span', 'stack', 'side', 'size', 'showSnap'];
function compactMobile(section) {
  const s = compact(section);
  MOBILE_ONLY_DESKTOP.forEach((k) => { delete s[k]; });
  return s;
}

// `mobile` null = phones follow the desktop layout.
export const saveProfileLayout = (user, sections, mobile = null) =>
  ownerRequest('PUT', user, {
    sections: sections.map(compact),
    mobile: mobile ? mobile.map(compactMobile) : null,
  });

export const resetProfileLayout = (user) => ownerRequest('DELETE', user, {});

// ── data the layout's sections need that the profile page doesn't fetch ──────

// The playlists a profile may show: public, not Watch Later, not empty.
export const isShowablePlaylist = (p) => p?.access === 'public' && p.name !== 'Watch Later' && p.items?.length > 0;

/**
 * A creator's albums and audio playlists: their playlists that hold music (the
 * checker decides that from embed-audio), albums first, then playlists of other
 * people's tracks. `user` null = not needed, no request.
 */
export function useProfileAudioPlaylists(user) {
  return useQuery({
    queryKey: ['profile-audio-playlists', String(user || '').toLowerCase()],
    queryFn: async () => {
      const { data } = await axios.get(`${CHECKER_URL}/audio/playlists?owner=${encodeURIComponent(user)}&limit=24`);
      const me = String(user).toLowerCase();
      const artist = (data?.by_artist || []).map((p) => ({ ...p, _kind: 'artist' }));
      const listeners = (data?.by_listeners || []).map((p) => ({ ...p, _kind: 'listener' }));
      // Filtered here as well: a checker without ?owner= answers with everyone's.
      return [...artist, ...listeners].filter((p) => String(p.owner).toLowerCase() === me);
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

// The edit-mode tour (ProfileLayoutTour) opens by itself once per browser.
const TOUR_SEEN_KEY = '3speak_layout_tour_seen';
export const layoutTourSeen = () => {
  try { return localStorage.getItem(TOUR_SEEN_KEY) === '1'; } catch { return true; }   // no storage: don't nag
};
export const markLayoutTourSeen = () => {
  try { localStorage.setItem(TOUR_SEEN_KEY, '1'); } catch { /* private mode */ }
};

// "Customize profile" sits in the profile header; the editor lives in the
// Overview tab. The header asks through here, and the flag covers the case
// where the Overview is not mounted yet (the click switched to it).
export const LAYOUT_EDIT_EVENT = 'profile-layout:customize';
let editRequested = false;
export function requestLayoutEdit() {
  editRequested = true;
  window.dispatchEvent(new Event(LAYOUT_EDIT_EVENT));
}
export function takeLayoutEditRequest() {
  const asked = editRequested;
  editRequested = false;
  return asked;
}
