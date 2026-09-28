import { useState, useEffect, useCallback } from 'react';
import { TRANSLATE_API_URL, CHECKER_URL } from '../utils/config';
import { parseSrt } from '../utils/srtParser';

const SUBTITLE_LANG_KEY = '3speak-subtitle-lang';
const SUBTITLE_STYLE_KEY = '3speak-subtitle-style';

// The CDN is fronted by a specific hot-pinning node — content not yet
// propagated to IT 500s ("block was not found locally") even though
// ipfs.3speak.tv already serves it fine. Try the CDN first (fast, direct);
// on failure go through OUR OWN backend rather than fetching ipfs.3speak.tv
// straight from the browser — that gateway sends `access-control-allow-origin`
// TWICE on every response, which every real browser rejects outright
// ("Failed to fetch", confirmed live) even though the value itself is fine.
// The proxy fetches server-to-server (no CORS involved) and re-serves it
// with a single, correct header via our own cors() middleware.
async function fetchSrtWithFallback(cid) {
  try {
    const res = await fetch(`https://hotipfs-3speak-1.b-cdn.net/ipfs/${cid}`);
    if (res.ok) return await res.text();
  } catch { /* fall through to the proxy */ }

  const res = await fetch(`${CHECKER_URL}/subtitle-proxy/${cid}`);
  if (!res.ok) throw new Error(`subtitle-proxy responded ${res.status}`);
  return await res.text();
}

const DEFAULT_STYLE = {
  fontSize: 'medium',
  color: '#ffffff',
  bgOpacity: 0.7,
  fontFamily: 'sans-serif',
  borderWidth: 0,
  borderColor: '#000000',
};

function loadStyle() {
  try {
    const stored = localStorage.getItem(SUBTITLE_STYLE_KEY);
    if (stored) return { ...DEFAULT_STYLE, ...JSON.parse(stored) };
  } catch {}
  return DEFAULT_STYLE;
}

// Module-level caches. Both hold PROMISES, so a hover preview that warms a video
// and the hook that renders it a moment later share one request, not two.
// A failed request is dropped from the cache so the next attempt retries.
const languageListCache = {}; // "author/permlink" → Promise<[{ lang, cid }]>
const subtitleCache = {}; // "author/permlink/lang" → Promise<cues[]>

/**
 * The language list for a video, or [] when it has no subtitles.
 * Shared with the transcript panel, which needs the same list but must NOT
 * drive the on-video overlay (that follows the viewer's own CC choice).
 */
export function listSubtitleLanguages(author, permlink) {
  if (!author || !permlink || author === 'unknown') return Promise.resolve([]);
  const key = `${author}/${permlink}`;
  if (!languageListCache[key]) {
    languageListCache[key] = fetch(`${TRANSLATE_API_URL}/subtitles/${author}/${permlink}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`subtitles list responded ${res.status}`);
        const data = await res.json();
        return Array.isArray(data) ? data : [];
      })
      .catch(() => {
        delete languageListCache[key];
        return [];
      });
  }
  return languageListCache[key];
}

/**
 * Parsed cues for one language entry ({ lang, cid }), memoised per video+lang.
 * Both the overlay and the transcript read through this, so a viewer who turns
 * captions on after reading the transcript pays no second fetch.
 */
export function loadSubtitleCues(author, permlink, langEntry) {
  if (!langEntry?.cid) return Promise.resolve([]);
  const cacheKey = `${author}/${permlink}/${langEntry.lang}`;
  if (!subtitleCache[cacheKey]) {
    subtitleCache[cacheKey] = fetchSrtWithFallback(langEntry.cid)
      .then(parseSrt)
      .catch((err) => {
        delete subtitleCache[cacheKey];
        throw err;
      });
  }
  return subtitleCache[cacheKey];
}

// The viewer's languages from the browser, which follows the device language on
// phones and usually on desktop too. "de-AT" also offers "de", since subtitle
// entries use bare codes.
function browserLanguages() {
  const raw = typeof navigator === 'undefined'
    ? []
    : (navigator.languages?.length ? navigator.languages : [navigator.language]);
  const out = [];
  for (const tag of raw) {
    if (!tag) continue;
    const full = tag.toLowerCase();
    const base = full.split('-')[0];
    if (!out.includes(full)) out.push(full);
    if (!out.includes(base)) out.push(base);
  }
  return out;
}

/**
 * Which subtitle language to show from `available` ([{ lang, cid }]):
 * the viewer's saved CC choice, then their device language, then English.
 * Returns null when none of those exist, unless `anyAsLastResort` is set
 * (the transcript would rather show some language than nothing).
 */
export function pickSubtitleLang(available, { anyAsLastResort = false } = {}) {
  if (!available?.length) return null;
  const has = (lang) => available.some((l) => l.lang.toLowerCase() === lang);
  let stored = null;
  try { stored = localStorage.getItem(SUBTITLE_LANG_KEY); } catch { /* private mode */ }
  if (stored && has(stored.toLowerCase())) return available.find((l) => l.lang.toLowerCase() === stored.toLowerCase()).lang;
  for (const lang of [...browserLanguages(), 'en']) {
    if (has(lang)) return available.find((l) => l.lang.toLowerCase() === lang).lang;
  }
  return anyAsLastResort ? available[0].lang : null;
}

/**
 * Starts fetching the captions a preview of this video would show, so they are
 * ready by the time it plays. Fire-and-forget.
 */
export function prefetchSubtitles(author, permlink) {
  listSubtitleLanguages(author, permlink).then((list) => {
    const lang = pickSubtitleLang(list);
    if (lang) loadSubtitleCues(author, permlink, list.find((l) => l.lang === lang)).catch(() => {});
  });
}

export { SUBTITLE_LANG_KEY };

/**
 * Hook for managing subtitle state on a video.
 * @param {string} author - Video author
 * @param {string} permlink - Video permlink
 * @param {object} [opts]
 * @param {boolean} [opts.autoSelect] - show captions even when the viewer never
 *   turned CC on (e.g. the muted hover preview), without saving that as a choice
 */
export default function useSubtitles(author, permlink, { autoSelect = false } = {}) {
  const [availableLanguages, setAvailableLanguages] = useState(null);
  const [selectedLang, setSelectedLang] = useState(null);
  const [cues, setCues] = useState([]);
  const [loading, setLoading] = useState(false);

  // Fetch available subtitles when author/permlink changes
  useEffect(() => {
    if (!author || !permlink || author === 'unknown') {
      setAvailableLanguages(null);
      setSelectedLang(null);
      setCues([]);
      return;
    }

    let cancelled = false;
    setAvailableLanguages(null);
    setSelectedLang(null);
    setCues([]);

    listSubtitleLanguages(author, permlink).then((data) => {
      if (cancelled) return;
      if (data.length === 0) {
        setAvailableLanguages(null);
        return;
      }
      setAvailableLanguages(data);

      // Captions come on by themselves only for a viewer who turned CC on before
      // (a saved choice exists), or when `autoSelect` is set. The language is
      // their saved one, else their device language, else English.
      // setSelectedLang here does NOT persist a choice.
      let stored = null;
      try { stored = localStorage.getItem(SUBTITLE_LANG_KEY); } catch { /* private mode */ }
      if (autoSelect || stored) setSelectedLang(pickSubtitleLang(data));
    });

    return () => { cancelled = true; };
  }, [author, permlink, autoSelect]);

  // Fetch + parse SRT when selectedLang changes
  useEffect(() => {
    if (!selectedLang || !availableLanguages) {
      setCues([]);
      return;
    }

    const langEntry = availableLanguages.find(l => l.lang === selectedLang);
    if (!langEntry) {
      setCues([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const parsed = await loadSubtitleCues(author, permlink, langEntry);
        if (cancelled) return;
        setCues(parsed);
      } catch (err) {
        console.error('[useSubtitles] Failed to fetch SRT:', err);
        if (!cancelled) setCues([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [selectedLang, availableLanguages, author, permlink]);

  // Language selection handler (persists to localStorage)
  const selectLanguage = useCallback((lang) => {
    setSelectedLang(lang);
    if (lang) {
      localStorage.setItem(SUBTITLE_LANG_KEY, lang);
    } else {
      localStorage.removeItem(SUBTITLE_LANG_KEY);
    }
  }, []);

  // Subtitle style (fontSize, color, bgOpacity)
  const [subtitleStyle, setSubtitleStyle] = useState(loadStyle);

  const updateStyle = useCallback((partial) => {
    setSubtitleStyle(prev => {
      const next = { ...prev, ...partial };
      localStorage.setItem(SUBTITLE_STYLE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return {
    availableLanguages,
    selectedLang,
    selectLanguage,
    cues,
    loading,
    subtitleStyle,
    updateStyle,
  };
}
