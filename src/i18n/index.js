import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { LANGUAGES, LANGUAGE_CODES, DEFAULT_LANGUAGE, getLanguageInfo } from './languages';

/**
 * Interface translations.
 *
 * Strings live in src/locales/<lang>/<area>.json. Each file becomes one top-level
 * key, so `src/locales/en/watch.json` → `t('watch.someKey')`. Splitting by area
 * keeps every file small enough to review in a pull request, which is how people
 * contribute translations (TRANSLATING.md).
 *
 * English is bundled into the app because it is the fallback for every missing
 * key. Every other language is a lazy chunk, loaded once when it is first chosen,
 * so a visitor only ever downloads the language they read.
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

async function loadLanguage(code) {
  if (code === DEFAULT_LANGUAGE || i18n.hasResourceBundle(code, 'translation')) return;
  const prefix = `../locales/${code}/`;
  const entries = Object.entries(others).filter(([p]) => p.startsWith(prefix));
  const loaded = await Promise.all(entries.map(async ([p, load]) => [p, await load()]));
  i18n.addResourceBundle(code, 'translation', bundle(Object.fromEntries(loaded)), true, true);
}

function readStored() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

// Best match for the browser's preferred languages: "pt-BR" → "pt", "zh-Hans-CN" → "zh".
export function detectBrowserLanguage() {
  const prefs = (typeof navigator !== 'undefined' && (navigator.languages || [navigator.language])) || [];
  for (const pref of prefs) {
    const base = String(pref || '').toLowerCase().split('-')[0];
    if (LANGUAGE_CODES.includes(base)) return base;
  }
  return DEFAULT_LANGUAGE;
}

function initialLanguage() {
  const stored = readStored();
  if (stored && LANGUAGE_CODES.includes(stored)) return stored;
  return detectBrowserLanguage();
}

function applyDocumentLanguage(code) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = code;
  document.documentElement.dir = getLanguageInfo(code)?.dir || 'ltr';
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
  react: { useSuspense: false },
});

i18n.on('languageChanged', applyDocumentLanguage);

/**
 * Switch the interface language. `remember` is false only for the automatic
 * first-visit choice, so following the browser never pins a language the person
 * did not pick.
 */
export async function setLanguage(code, { remember = true } = {}) {
  if (!LANGUAGE_CODES.includes(code)) code = DEFAULT_LANGUAGE;
  await loadLanguage(code);
  await i18n.changeLanguage(code);
  if (remember) {
    try { localStorage.setItem(STORAGE_KEY, code); } catch { /* storage disabled */ }
  }
}

/** Start in the stored or browser language. English renders until it has loaded. */
export function initLanguage() {
  const code = initialLanguage();
  applyDocumentLanguage(DEFAULT_LANGUAGE);
  if (code !== DEFAULT_LANGUAGE) {
    setLanguage(code, { remember: false }).catch(() => { /* stay in English */ });
  }
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
