import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MdContentCopy, MdKeyboardArrowDown, MdKeyboardArrowUp, MdSchedule,
} from 'react-icons/md';
import {
  listSubtitleLanguages,
  loadSubtitleCues,
  pickSubtitleLang,
} from '../../hooks/useSubtitles';
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

export default function Transcript({ author, permlink, currentTime = 0, onSeek, embedded = false }) {
  const [languages, setLanguages] = useState([]);
  const [lang, setLang] = useState(null);
  const [cues, setCues] = useState([]);
  const [expanded, setExpanded] = useState(embedded);
  const [copied, setCopied] = useState(false);
  // Copying is done for two different reasons and they want different text:
  // quoting a moment ("he says it at 4:12") needs the times, feeding the words
  // to something else does not. Remembered, because a given reader almost
  // always wants the same one every time.
  const [withTimes, setWithTimes] = useState(() => {
    try { return localStorage.getItem(COPY_TIMES_KEY) !== '0'; } catch { return true; }
  });

  const listRef = useRef(null);
  const lastUserScrollRef = useRef(0);

  // Which languages exist for this video.
  useEffect(() => {
    let alive = true;
    setLanguages([]); setLang(null); setCues([]);
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
  useEffect(() => {
    if (!lang || !languages.length) return undefined;
    let alive = true;
    (async () => {
      const preferred = languages.find((l) => l.lang === lang);
      const ordered = [preferred, ...languages.filter((l) => l.lang !== lang)].filter(Boolean);
      for (const entry of ordered) {
        try {
          const parsed = await loadSubtitleCues(author, permlink, entry);
          if (!alive) return;
          if (parsed.length) {
            setCues(parsed);
            // Say which language is actually on screen.
            if (entry.lang !== lang) setLang(entry.lang);
            return;
          }
        } catch { /* unfetchable right now — try the next language */ }
      }
      if (alive) setCues([]);
    })();
    return () => { alive = false; };
  }, [lang, languages, author, permlink]);

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

  // Follow along, unless the reader is scrolling the panel themselves.
  useEffect(() => {
    if (!expanded || activeIndex < 0) return;
    if (Date.now() - lastUserScrollRef.current < AUTOSCROLL_PAUSE_MS) return;
    const el = listRef.current?.querySelector(`[data-cue="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, expanded]);

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
        {embedded ? null : <h3>Transcript</h3>}
        <div className="transcript-actions">
          {languages.length > 1 && (
            <select
              className="transcript-lang"
              value={lang || ''}
              onChange={(e) => setLang(e.target.value)}
              aria-label="Transcript language"
            >
              {languages.map((l) => <option key={l.lang} value={l.lang}>{l.label || l.lang}</option>)}
            </select>
          )}
          <button
            type="button"
            className={`transcript-times${withTimes ? ' active' : ''}`}
            onClick={toggleTimes}
            aria-pressed={withTimes}
            title={withTimes ? 'Copying with timecodes' : 'Copying text only'}
          >
            <MdSchedule size={15} /> <span className="transcript-times-label">Timecodes</span>
          </button>
          <button
            type="button"
            className="transcript-copy"
            onClick={copy}
            title={withTimes ? 'Copy transcript with timecodes' : 'Copy transcript text'}
          >
            <MdContentCopy size={15} /> {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      <div
        className="transcript-body"
        ref={listRef}
        onScroll={() => { lastUserScrollRef.current = Date.now(); }}
      >
        {cues.map((cue, i) => (
          <button
            key={`${cue.start}-${i}`}
            type="button"
            data-cue={i}
            className={`transcript-line${i === activeIndex ? ' active' : ''}`}
            onClick={() => onSeek?.(cue.start)}
            title={`Jump to ${stamp(cue.start)}`}
          >
            <span className="transcript-time">{stamp(cue.start)}</span>
            <span className="transcript-text">{cue.text}</span>
          </button>
        ))}
      </div>

      {embedded ? null : (
        <button type="button" className="transcript-toggle" onClick={() => setExpanded((v) => !v)}>
          {expanded
            ? <><MdKeyboardArrowUp size={18} /> Hide transcript</>
            : <><MdKeyboardArrowDown size={18} /> Show transcript{cues.length ? ` (${cues.length} lines)` : ''}</>}
        </button>
      )}
    </section>
  );
}
