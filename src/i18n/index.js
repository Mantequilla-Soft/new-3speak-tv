import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { LANGUAGES, LANGUAGE_CODES, DEFAULT_LANGUAGE } from './languages';
import { flatten, LANG_CODE_RE } from './rules';
import { reloadOnceForChunk } from '../utils/staleChunk';

/**
 * Interface translations.
 *
 * Strings live in src/locales/<lang>/<area>.json. Each file becomes one top-level
 * key, so `src/locales/en/watch.json` → `t('watch.<key>')`. Splitting by area
 * keeps every file small enough to review in a pull request, which is how people
 * contribute translations (TRANSLATING.md).
 *
 * English is bundled into the app because it is the fallback for every missing
 * key. Every other language is a lazy chunk, loaded once when it is first chosen,
 * so a visitor only ever downloads the language they read.
 *
 * On top of the bundled files sits the COMMUNITY OVERLAY: strings translators
 * saved in the in-app editor (/translate, server/i18n-editor.cjs). It is fetched
 * from /api/i18n/overlay/<lang> when a language loads and wins over the bundled
 * text, so a fix is live for everyone right away and reaches the files later
 * through a pull request. The overlay is optional: with the API down the app
 * simply shows the bundled text. Languages added in the editor ("community
 * languages") have no bundled files at all, only overlay, with English for the
 * rest; they come from /api/i18n/languages and join the picker when they arrive.
 *
 * In React use the hook:      const { t } = useTranslation();
 * Outside React (utils, toasts, stores) import `t` from here. It reads the CURRENT
 * language at call time, so never call it at module top level — a label computed
 * at import time is frozen in whatever language was active then.
 */

const STORAGE_KEY = '3speak_lang';

const english = import.meta.glob('../locales/en/*.json', { eager: true, import: 'default' });
const others = import.meta.glob(['../locales/*/*.json', '!../locales/en/*.json'], { import: 'default' });

const fileArea = (path) => path.split('/').pop().replace(/\.json$/, '');

function bundle(modules) {
  const out = {};
  for (const [path, data] of Object.entries(modules)) out[fileArea(path)] = data;
  return out;
}

// ---- Community overlay + community languages ------------------------------------

const API = import.meta.env.VITE_THREESPEAK_API || '/api';
const OVERLAY_KEY_RE = /^[\w-]+(\.[\w-]+)+$/;

async function fetchJson(url, { timeoutMs = 4000, ...init } = {}) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, { ...init, signal: ctrl?.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null; // the site must work with the API down
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Saved community strings for a language, flat ({ "watch.title": "…" }), or null. */
export async function fetchOverlay(code, { fresh = false } = {}) {
  if (code === DEFAULT_LANGUAGE || !LANG_CODE_RE.test(code)) return null;
  // Short timeout: switching language waits for this, and it is only an extra.
  const data = await fetchJson(`${API}/i18n/overlay/${encodeURIComponent(code)}`, { timeoutMs: 2500, ...(fresh ? { cache: 'no-store' } : {}) });
  return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
}

/** Lay flat overlay strings over whatever the language already has. */
export function applyOverlay(code, flat) {
  if (!flat || code === DEFAULT_LANGUAGE) return;
  const clean = {};
  for (const [k, v] of Object.entries(flat)) {
    if (typeof v === 'string' && v && OVERLAY_KEY_RE.test(k)) clean[k] = v;
  }
  if (Object.keys(clean).length) i18n.addResources(code, 'translation', clean);
}

let community = [];
let allLanguages = LANGUAGES;
const languageListeners = new Set();

/** Bundled + community languages. Stable reference until the list changes. */
export const getAllLanguages = () => allLanguages;
export const subscribeLanguages = (fn) => {
  languageListeners.add(fn);
  return () => languageListeners.delete(fn);
};
export const findLanguage = (code) => allLanguages.find((l) => l.code === code);
const isKnownLanguage = (code) => allLanguages.some((l) => l.code === code);

// i18next drops languages missing from supportedLngs, so a community language
// has to be added there before it can be switched to.
function allowLanguage(code) {
  const lists = new Set([i18n.options?.supportedLngs, i18n.services?.languageUtils?.supportedLngs]);
  for (const list of lists) if (Array.isArray(list) && !list.includes(code)) list.push(code);
}

export function registerCommunityLanguages(list) {
  if (!Array.isArray(list)) return;
  const known = new Set(allLanguages.map((l) => l.code));
  const added = [];
  for (const l of list) {
    if (!l || typeof l.code !== 'string' || !LANG_CODE_RE.test(l.code) || known.has(l.code)) continue;
    known.add(l.code);
    added.push({
      code: l.code,
      native: String(l.native || l.code).slice(0, 40),
      english: String(l.english || l.code).slice(0, 40),
      ...(l.dir === 'rtl' ? { dir: 'rtl' } : {}),
      community: true,
    });
    allowLanguage(l.code);
  }
  if (!added.length) return;
  community = [...community, ...added];
  allLanguages = [...LANGUAGES, ...community];
  languageListeners.forEach((fn) => fn());
}

let communityPromise = null;
/** Fetch community-added languages once per page load. Never rejects. */
export function loadCommunityLanguages() {
  communityPromise ||= fetchJson(`${API}/i18n/languages`).then(registerCommunityLanguages);
  return communityPromise;
}

// Each area file loads on its own: one that fails costs only that area (English
// shows there), never the whole language. They fail almost only when a deploy
// replaced the files while this tab, or its service worker, still runs the old
// build, so the first failure reloads onto the current build. Never rejects.
async function loadBundled(code) {
  const prefix = `../locales/${code}/`;
  const entries = Object.entries(others).filter(([p]) => p.startsWith(prefix));
  const failed = [];
  const loaded = await Promise.all(entries.map(async ([p, load]) => {
    try {
      return [p, await load()];
    } catch {
      failed.push(fileArea(p));
      return null;
    }
  }));
  if (failed.length) {
    console.warn(`[i18n] ${code}: ${failed.length} file(s) failed to load: ${failed.join(', ')}`);
    if (await reloadOnceForChunk(`locale:${code}`)) await new Promise(() => {}); // navigating away
  }
  return bundle(Object.fromEntries(loaded.filter(Boolean)));
}

/** The bundled text of a language, flat, WITHOUT the overlay (for the editor). */
export async function loadBundledFlat(code) {
  if (code === DEFAULT_LANGUAGE) return flatten(bundle(english));
  return flatten(await loadBundled(code));
}

/** English, nested by area, exactly as bundled (for the editor). */
export const getEnglishResources = () => bundle(english);

const loadedLanguages = new Set();
async function loadLanguage(code) {
  if (code === DEFAULT_LANGUAGE || loadedLanguages.has(code)) return;
  // The editor overlay never blocks a language: it is fetched alongside and laid on
  // top when it arrives (react re-renders on 'added', see init). Only a language
  // with no bundled files at all (community-only) waits for it, since the overlay
  // IS that language. loadBundled never rejects, so the overlay is laid on top even
  // when some bundled files are missing.
  const overlay = fetchOverlay(code);
  const files = await loadBundled(code);
  i18n.addResourceBundle(code, 'translation', files, true, true);
  loadedLanguages.add(code);
  if (Object.keys(files).length) overlay.then((o) => applyOverlay(code, o));
  else applyOverlay(code, await overlay);
}

/**
 * Apply saved editor changes in this tab right away: a string sets the text, null
 * drops the override and puts the bundled text back (or English, if none).
 */
export function applyLiveChanges(code, changes, bundledFlat = {}) {
  if (code === DEFAULT_LANGUAGE) return;
  const sets = {};
  const data = i18n.store?.data?.[code]?.translation;
  for (const [key, value] of Object.entries(changes)) {
    if (!OVERLAY_KEY_RE.test(key)) continue;
    if (typeof value === 'string') sets[key] = value;
    else if (typeof bundledFlat[key] === 'string') sets[key] = bundledFlat[key];
    else if (data) {
      const parts = key.split('.');
      let node = data;
      for (const p of parts.slice(0, -1)) node = node && Object.prototype.hasOwnProperty.call(node, p) ? node[p] : null;
      if (node && typeof node === 'object') delete node[parts[parts.length - 1]];
    }
  }
  if (Object.keys(sets).length) i18n.addResources(code, 'translation', sets);
  // react-i18next re-renders on languageChanged, not on added resources.
  if (i18n.language === code) i18n.changeLanguage(code);
}

function readStored() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

// Best match for the browser's preferred languages: "pt-BR" → "pt", "zh-Hans-CN" → "zh".
export function detectBrowserLanguage() {
  const prefs = (typeof navigator !== 'undefined' && (navigator.languages || [navigator.language])) || [];
  for (const pref of prefs) {
    let base = String(pref || '').toLowerCase().split('-')[0];
    if (base === 'tl') base = 'fil'; // browsers report Filipino as either
    if (LANGUAGE_CODES.includes(base)) return base;
  }
  return DEFAULT_LANGUAGE;
}

function initialLanguage() {
  const stored = readStored();
  // A community language is only known once /api/i18n/languages answers, so a
  // well-formed stored code is kept and resolved in setLanguage.
  if (stored && (LANGUAGE_CODES.includes(stored) || LANG_CODE_RE.test(stored))) return stored;
  return detectBrowserLanguage();
}

function applyDocumentLanguage(code) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = code;
  document.documentElement.dir = findLanguage(code)?.dir || 'ltr';
}

i18n.use(initReactI18next).init({
  resources: { [DEFAULT_LANGUAGE]: { translation: bundle(english) } },
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: LANGUAGE_CODES,
  // React already escapes what it renders.
  interpolation: { escapeValue: false },
  // A missing key in a half-finished translation falls back to English, never to
  // an empty string.
  returnEmptyString: false,
  // 'added': strings that arrive later (the editor overlay) re-render what is on screen.
  react: { useSuspense: false, bindI18nStore: 'added' },
});

i18n.on('languageChanged', applyDocumentLanguage);

/**
 * Switch the interface language. `remember` is false only for the automatic
 * first-visit choice, so following the browser never pins a language the person
 * did not pick.
 */
export async function setLanguage(code, { remember = true } = {}) {
  if (!isKnownLanguage(code) && typeof code === 'string' && LANG_CODE_RE.test(code)) {
    await loadCommunityLanguages();
  }
  if (!isKnownLanguage(code)) code = DEFAULT_LANGUAGE;
  await loadLanguage(code);
  await i18n.changeLanguage(code);
  if (remember) {
    try { localStorage.setItem(STORAGE_KEY, code); } catch { /* storage disabled */ }
  }
}

/**
 * Start in the stored or browser language. Resolves once that language is ready
 * (immediately for English); main.jsx holds the first render on it, capped, so a
 * non-English visitor never sees an English first frame.
 */
export function initLanguage() {
  const code = initialLanguage();
  applyDocumentLanguage(DEFAULT_LANGUAGE);
  loadCommunityLanguages();
  if (code === DEFAULT_LANGUAGE) return Promise.resolve();
  return setLanguage(code, { remember: false }).catch(() => { /* stay in English */ });
}

export const getLanguage = () => i18n.resolvedLanguage || i18n.language || DEFAULT_LANGUAGE;

export const t = (...args) => i18n.t(...args);

// ---- Locale-aware formatting -------------------------------------------------

const rtfCache = {};
const rtf = (style) => {
  const key = `${getLanguage()}:${style}`;
  return (rtfCache[key] ||= new Intl.RelativeTimeFormat(getLanguage(), { numeric: 'auto', style }));
};

const UNITS = [
  ['year', 31536000], ['month', 2592000], ['week', 604800],
  ['day', 86400], ['hour', 3600], ['minute', 60],
];

/**
 * "3 days ago" / "hace 3 días" / "vor 3 Tagen". `style: 'narrow'` gives the compact
 * form used on cards ("3d ago" in English). Anything under a minute reads "now".
 */
export function formatTimeAgo(date, { style = 'long' } = {}) {
  const ms = date instanceof Date ? date.getTime() : new Date(date).getTime();
  if (Number.isNaN(ms)) return '';
  const seconds = Math.round((ms - Date.now()) / 1000);
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return rtf(style).format(Math.trunc(seconds / size), unit);
  }
  return i18n.t('common.time.justNow');
}

/** Calendar days only: "today", "yesterday", "2 weeks ago". */
export function formatDaysAgo(date) {
  const ms = new Date(date).getTime();
  if (Number.isNaN(ms)) return '';
  const days = Math.floor((Date.now() - ms) / 86400000);
  if (days <= 0) return rtf('long').format(0, 'day');
  if (days < 7) return rtf('long').format(-days, 'day');
  if (days < 35) return rtf('long').format(-Math.floor(days / 7), 'week');
  if (days < 365) return rtf('long').format(-Math.floor(days / 30), 'month');
  return rtf('long').format(-Math.floor(days / 365), 'year');
}

/** 1234 → "1,234" / "1.234"; `compact` → "1.2K" / "1,2 mil". */
export function formatNumber(n, { compact = false, ...opts } = {}) {
  const num = Number(n) || 0;
  return new Intl.NumberFormat(getLanguage(), compact
    ? { notation: 'compact', maximumFractionDigits: 1, ...opts }
    : opts).format(num);
}

export function formatDate(date, opts = { dateStyle: 'medium' }) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(getLanguage(), opts).format(d);
}

export { LANGUAGES };
export default i18n;
