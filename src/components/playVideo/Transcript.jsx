import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MdClose, MdContentCopy, MdKeyboardArrowDown, MdKeyboardArrowUp, MdSchedule, MdSearch,
} from 'react-icons/md';
import {
  listSubtitleLanguages,
  loadSubtitleCues,
  pickSubtitleLang,
} from '../../hooks/useSubtitles';
import { useTranslation } from 'react-i18next';
import './Transcript.scss';

/**
 * The video's spoken words, under the description.
 *
 * Two audiences. A viewer gets a way to read a talk they can't listen to, to
 * find the one bit they came for, and to jump straight to it. A search engine
 * gets the only real text a video page has: titles and descriptions are a
 * sentence each, while a transcript is the whole thing, which is what makes a
 * watch page findable by a phrase someone actually said.
 *
 * The crawler half is served by the prerender sidecar, not by this component:
 * Googlebot and bingbot are routed to og-server.cjs for /watch and never
 * execute the SPA, so the text they index is the server-rendered copy. This one
 * is purely for the person watching.
 *
 * `embedded` drops the panel's own heading and show/hide button, for when it
 * sits inside the watch tabs and the tab bar is already the chrome.
 *
 * The cues come from the same fetch + cache the on-video captions use, but the
 * language here is chosen independently: reading along is not the same choice
 * as turning captions on, and neither should switch the other.
 */

const AUTOSCROLL_PAUSE_MS = 6000;
const COPY_TIMES_KEY = '3speak-transcript-copy-times';

const stamp = (seconds) => {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
};

// Case- and accent-insensitive: "cafe" finds "Café". Folding a character can
// change its length (NFD splits "é" in two), so each folded character remembers
// where it came from in the original, for the highlight.
const fold = (text) => {
  let out = '';
  const map = [];
  const src = String(text);
  for (let i = 0; i < src.length; i += 1) {
    const f = src[i].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    for (let k = 0; k < f.length; k += 1) { out += f[k]; map.push(i); }
  }
  return { out, map };
};

function highlight(text, needle) {
  if (!needle) return text;
  const { out, map } = fold(text);
  const parts = [];
  let from = 0;
  let last = 0;
  for (;;) {
    const at = out.indexOf(needle, from);
    if (at < 0) break;
    const start = map[at];
    const end = (map[at + needle.length - 1] ?? start) + 1;
    if (start > last) parts.push(text.slice(last, start));
    parts.push(<mark key={start}>{text.slice(start, end)}</mark>);
    last = end;
    from = at + needle.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export default function Transcript({ author, permlink, currentTime = 0, onSeek, embedded = false }) {
  const { t } = useTranslation();
  const [languages, setLanguages] = useState([]);
  const [lang, setLang] = useState(null);
  const [cues, setCues] = useState([]);
  const [loadingLang, setLoadingLang] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  // Set once the reader picks a language themselves. From then on that choice
  // is final: it loads, or they are told it didn't. Only the automatic first
  // pick may quietly fall through to another language.
  const userPickedRef = useRef(false);
  const [expanded, setExpanded] = useState(embedded);
  const [copied, setCopied] = useState(false);
  // Copying is done for two different reasons and they want different text:
  // quoting a moment ("he says it at 4:12") needs the times, feeding the words
  // to something else does not. Remembered, because a given reader almost
  // always wants the same one every time.
  const [withTimes, setWithTimes] = useState(() => {
    try { return localStorage.getItem(COPY_TIMES_KEY) !== '0'; } catch { return true; }
  });

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef(null);

  const listRef = useRef(null);
  const lastUserScrollRef = useRef(0);
  // A line clicked in the search results, to scroll to once the full list is back.
  const revealRef = useRef(-1);

  // Which languages exist for this video.
  useEffect(() => {
    let alive = true;
    setLanguages([]); setLang(null); setCues([]);
    setLoadFailed(false);
    userPickedRef.current = false;
    listSubtitleLanguages(author, permlink).then((list) => {
      if (!alive || !list.length) return;
      setLanguages(list);
      // Prefer the viewer's caption language, then their device language, then
      // English, then whatever exists.
      setLang(pickSubtitleLang(list, { anyAsLastResort: true }));
    });
    return () => { alive = false; };
  }, [author, permlink]);

  // The lines themselves. A subtitle file lives on IPFS and any single one can
  // be temporarily unfetchable (the hot CDN 500s for content it hasn't pinned
  // yet, and the fallback gateway is not always healthy either). A video with
  // eight translations shouldn't show no transcript because the preferred one
  // is the unlucky file, so the rest are tried in turn.
  //
  // 🚨 But NOT after the reader picked a language from the menu. Falling through
  // then swapped their choice for English and set the menu back, which reads as
  // "the language menu does nothing". A picked language loads, or the panel
  // says it couldn't (keeping the lines it had) and offers a retry.
  useEffect(() => {
    if (!lang || !languages.length) return undefined;
    let alive = true;
    const picked = userPickedRef.current;
    setLoadingLang(true);
    setLoadFailed(false);
    (async () => {
      const preferred = languages.find((l) => l.lang === lang);
      const ordered = picked
        ? [preferred].filter(Boolean)
        : [preferred, ...languages.filter((l) => l.lang !== lang)].filter(Boolean);
      for (const entry of ordered) {
        try {
          const parsed = await loadSubtitleCues(author, permlink, entry);
          if (!alive) return;
          if (parsed.length) {
            setCues(parsed);
            setLoadingLang(false);
            // Say which language is actually on screen.
            if (entry.lang !== lang) setLang(entry.lang);
            return;
          }
        } catch { /* unfetchable right now — try the next language */ }
      }
      if (!alive) return;
      setLoadingLang(false);
      if (picked) setLoadFailed(true);
      else setCues([]);
    })();
    return () => { alive = false; };
  }, [lang, languages, author, permlink, retryKey]);

  const activeIndex = useMemo(() => {
    if (!cues.length) return -1;
    // Cues are in order, so the last one that has started is the current one.
    let lo = 0; let hi = cues.length - 1; let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cues[mid].start <= currentTime) { found = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    if (found < 0) return -1;
    return currentTime <= cues[found].end + 0.5 ? found : -1;
  }, [cues, currentTime]);

  const needle = useMemo(() => fold(query.trim()).out, [query]);
  // Cue indexes that match, in order. Indexes, not cues, so a result keeps the
  // position it has in the full transcript.
  const matches = useMemo(() => {
    if (!needle) return null;
    const hits = [];
    cues.forEach((c, i) => { if (fold(c.text).out.includes(needle)) hits.push(i); });
    return hits;
  }, [cues, needle]);

  // Follow along, unless the reader is scrolling the panel themselves or
  // looking at search results.
  useEffect(() => {
    if (!expanded || activeIndex < 0 || matches) return;
    if (Date.now() - lastUserScrollRef.current < AUTOSCROLL_PAUSE_MS) return;
    const el = listRef.current?.querySelector(`[data-cue="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, expanded, matches]);

  // After jumping from a search result, show that line in the full transcript.
  useEffect(() => {
    if (matches || revealRef.current < 0) return;
    const el = listRef.current?.querySelector(`[data-cue="${revealRef.current}"]`);
    revealRef.current = -1;
    el?.scrollIntoView({ block: 'center' });
  }, [matches]);

  useEffect(() => { if (searchOpen) searchRef.current?.focus(); }, [searchOpen]);
  // A new video starts with no search.
  useEffect(() => { setSearchOpen(false); setQuery(''); }, [author, permlink]);

  const closeSearch = useCallback(() => { setSearchOpen(false); setQuery(''); }, []);

  const pick = useCallback((i) => {
    onSeek?.(cues[i].start);
    if (matches) {
      // Hand the reader back the whole transcript, at the line they picked, so
      // they can read on from there.
      revealRef.current = i;
      lastUserScrollRef.current = Date.now();
      closeSearch();
    }
  }, [cues, matches, onSeek, closeSearch]);

  const toggleTimes = useCallback(() => {
    setWithTimes((v) => {
      try { localStorage.setItem(COPY_TIMES_KEY, v ? '0' : '1'); } catch { /* private mode */ }
      return !v;
    });
  }, []);

  const copy = useCallback(async () => {
    // One cue per line. A cue's own text may be wrapped across two lines, but
    // that is a caption-rendering detail, not a break in the sentence, so it
    // gets flattened back to a space.
    const text = cues
      .map((c) => {
        const line = String(c.text).replace(/\s*\n\s*/g, ' ').trim();
        return withTimes ? `[${stamp(c.start)}] ${line}` : line;
      })
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked — nothing useful to say */ }
  }, [cues, withTimes]);

  if (!cues.length) return null;

  return (
    <section className={`transcript${expanded ? ' expanded' : ''}${embedded ? ' embedded' : ''}`}>
      <div className="transcript-head">
        {embedded ? null : <h3>{t('comments.transcript.title')}</h3>}
        <div className="transcript-actions">
          <button
            type="button"
            className={`transcript-search-btn${searchOpen ? ' active' : ''}`}
            onClick={() => (searchOpen ? closeSearch() : (setSearchOpen(true), setExpanded(true)))}
            aria-pressed={searchOpen}
            aria-label={t('comments.transcript.search')}
            title={t('comments.transcript.search')}
          >
            <MdSearch size={16} />
          </button>
          {languages.length > 1 && (
            <select
              className="transcript-lang"
              value={lang || ''}
              onChange={(e) => { userPickedRef.current = true; setLang(e.target.value); }}
              aria-label={t('comments.transcript.languageAria')}
            >
              {languages.map((l) => <option key={l.lang} value={l.lang}>{l.label || l.lang}</option>)}
            </select>
          )}
          <button
            type="button"
            className={`transcript-times${withTimes ? ' active' : ''}`}
            onClick={toggleTimes}
            aria-pressed={withTimes}
            title={withTimes ? t('comments.transcript.copyingWithTimes') : t('comments.transcript.copyingTextOnly')}
          >
            <MdSchedule size={15} /> <span className="transcript-times-label">{t('comments.transcript.timecodes')}</span>
          </button>
          <button
            type="button"
            className="transcript-copy"
            onClick={copy}
            title={withTimes ? t('comments.transcript.copyWithTimes') : t('comments.transcript.copyText')}
          >
            <MdContentCopy size={15} /> {copied ? t('common.actions.copied') : t('common.actions.copy')}
          </button>
        </div>
      </div>

      {searchOpen && (
        <div className="transcript-search">
          <MdSearch size={16} className="transcript-search-icon" aria-hidden="true" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') closeSearch();
              if (e.key === 'Enter' && matches?.length) pick(matches[0]);
            }}
            placeholder={t('comments.transcript.searchPlaceholder')}
            aria-label={t('comments.transcript.search')}
          />
          {matches && (
            <span className="transcript-search-count" aria-live="polite">
              {t('comments.transcript.searchResults', { count: matches.length })}
            </span>
          )}
          <button
            type="button"
            className="transcript-search-close"
            onClick={closeSearch}
            aria-label={t('comments.transcript.closeSearch')}
            title={t('comments.transcript.closeSearch')}
          >
            <MdClose size={16} />
          </button>
        </div>
      )}

      {loadFailed && (
        <div className="transcript-load-failed" role="status">
          <span>{t('comments.transcript.languageLoadFailed')}</span>
          <button type="button" onClick={() => setRetryKey((k) => k + 1)}>
            {t('common.actions.retry')}
          </button>
        </div>
      )}

      <div
        className={`transcript-body${loadingLang ? ' loading' : ''}`}
        ref={listRef}
        onScroll={() => { lastUserScrollRef.current = Date.now(); }}
      >
        {(matches || cues.map((_, i) => i)).map((i) => {
          const cue = cues[i];
          return (
            <button
              key={`${cue.start}-${i}`}
              type="button"
              data-cue={i}
              className={`transcript-line${i === activeIndex ? ' active' : ''}`}
              onClick={() => pick(i)}
              title={t('comments.transcript.jumpTo', { time: stamp(cue.start) })}
            >
              <span className="transcript-time">{stamp(cue.start)}</span>
              <span className="transcript-text">{matches ? highlight(cue.text, needle) : cue.text}</span>
            </button>
          );
        })}
        {matches && !matches.length && (
          <div className="transcript-search-empty">{t('comments.transcript.searchNoResults')}</div>
        )}
      </div>

      {embedded ? null : (
        <button type="button" className="transcript-toggle" onClick={() => setExpanded((v) => !v)}>
          {expanded
            ? <><MdKeyboardArrowUp size={18} /> {t('comments.transcript.hide')}</>
            : <><MdKeyboardArrowDown size={18} /> {cues.length ? t('comments.transcript.showWithCount', { count: cues.length }) : t('comments.transcript.show')}</>}
        </button>
      )}
    </section>
  );
}
