/**
 * The watch page's keyboard (YouTube style), as pure helpers so the handler in
 * PlayVideo stays a switch and the rules can be tested on their own.
 *
 * The page listens on the document, so these work wherever focus is on the page,
 * except while typing (inputs, textareas, selects, contenteditable) and while a
 * dialog owns the keyboard. A focused slider handles its own arrows first
 * (lib/sliderKeys.js) and the page then leaves them alone.
 */

/** Typing somewhere: no player shortcut may fire. */
export function isTypingTarget(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  // A checkbox or a button takes no text, so keys still belong to the page. A
  // range input (the volume slider) keeps its own arrows: it counts as typing.
  const type = String(el.type || 'text').toLowerCase();
  return !['checkbox', 'radio', 'button', 'submit', 'reset'].includes(type);
}

export const VOLUME_STEP = 0.05;

/** The volume after ArrowUp (+1) or ArrowDown (-1); a muted player starts from 0. */
export function volumeAfter(volume, muted, dir) {
  const from = muted ? 0 : (Number.isFinite(volume) ? volume : 1);
  const to = Math.round((from + dir * VOLUME_STEP) * 100) / 100;
  return Math.min(1, Math.max(0, to));
}

/**
 * Do ArrowUp / ArrowDown set the volume? Only while the player is what the viewer
 * is at: focus in it (`wrap`, the player's box), or on the page itself with the
 * player at least half on screen (always in fullscreen). Reading the comments
 * further down, the arrows scroll as always. While channel surfing they belong to
 * the surf bar (channel up / down), so never then.
 */
export function arrowsSetVolume(target, wrap, { surfing = false, fullscreen = false, viewportHeight = 0 } = {}) {
  if (surfing) return false;
  if (wrap && target && wrap.contains(target)) return true;
  const onPage = !target || target === document.body || target === document.documentElement;
  if (!onPage) return false;
  if (fullscreen) return true;
  if (!wrap) return false;
  const r = wrap.getBoundingClientRect();
  const seen = Math.min(r.bottom, viewportHeight) - Math.max(r.top, 0);
  return r.height > 0 && seen / r.height >= 0.5;
}

/** "0" to "9": that tenth of the video, in seconds. Null for any other key. */
export function percentSeekTarget(key, duration) {
  if (!/^[0-9]$/.test(key) || !(duration > 0)) return null;
  return (Number(key) / 10) * duration;
}

/**
 * "C": captions on or off. Off when a language is showing; otherwise the one
 * picked last time, else the interface language, else the first there is.
 * Returns the language to select, null for off, or undefined when there are none.
 */
export function captionToggleTarget(languages, selected, { remembered = null, uiLang = null } = {}) {
  if (selected) return null;
  const list = (languages || []).map((l) => l?.lang).filter(Boolean);
  if (!list.length) return undefined;
  const base = (code) => String(code || '').toLowerCase().split('-')[0];
  return list.find((l) => l === remembered)
    || list.find((l) => base(l) === base(uiLang))
    || list[0];
}

/**
 * What the "?" sheet lists, in order. `keys` are shown as key caps; `label` is a
 * playerKeys.* translation key.
 */
export const PLAYER_SHORTCUTS = [
  { keys: ['k', 'Space'], label: 'playerKeys.list.playPause' },
  { keys: ['j'], label: 'playerKeys.list.back10' },
  { keys: ['l'], label: 'playerKeys.list.forward10' },
  { keys: ['←', '→'], label: 'playerKeys.list.arrows' },
  { keys: [',', '.'], label: 'playerKeys.list.frame' },
  { keys: ['0', '…', '9'], label: 'playerKeys.list.percent' },
  { keys: ['↑', '↓'], label: 'playerKeys.list.volume' },
  { keys: ['m'], label: 'playerKeys.list.mute' },
  { keys: ['c'], label: 'playerKeys.list.captions' },
  { keys: ['f'], label: 'playerKeys.list.fullscreen' },
  { keys: ['t'], label: 'playerKeys.list.theater', wideOnly: true },
  { keys: ['s'], label: 'playerKeys.list.save' },
  { keys: ['Shift', 's'], label: 'playerKeys.list.share', combo: true },
  { keys: ['?'], label: 'playerKeys.list.help' },
];

// The watch page's theater (wide) mode, remembered in this browser.
export const THEATER_STORAGE_KEY = '3speak-watch-theater';

export function readTheater() {
  try { return localStorage.getItem(THEATER_STORAGE_KEY) === '1'; } catch { return false; }
}

export function saveTheater(on) {
  try {
    if (on) localStorage.setItem(THEATER_STORAGE_KEY, '1');
    else localStorage.removeItem(THEATER_STORAGE_KEY);
  } catch { /* storage off: it lasts for this page only */ }
}
