import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { Clock, Film, Link2, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import TimelineToasters from '../playVideo/TimelineToasters';
import AccountImg from '../HiveAvatar/AccountImg';
import { fetchLinkMeta, parseOne } from '../Chat/chatLinks';
import { CHECKER_URL } from '../../utils/config';
import { fixVideoThumbnail, fallbackImg } from '../../utils/fixThumbnails';
import { formatStamp, parseStamp, chapterAt } from '../../utils/timestamps';
import {
  ACCOUNT_RE, LINK_DUR_DEFAULT, LINK_DUR_MAX, LINK_DUR_MIN, MAX_CHAPTERS, MAX_LINKS,
  MIN_CHAPTER_SECONDS, CHAPTER_TITLE_MAX, activeLinksAt, cleanUrl, normalizeLink, siteOf,
} from '../../utils/videoTimeline';
import './TimelineEditor.scss';

/*
 * The timeline editor: chapters and link toasters for one video, with a live
 * preview. Used by the upload wizard (Timeline step) and the Edit video dialog.
 *
 * The lists it edits are plain arrays the caller owns. Items carry an editing-only
 * `_k` key (and `_thumb` for a picked video); utils/videoTimeline drops both, and
 * anything else invalid, when the timeline is written into a post. Times are whole
 * content seconds.
 */

const UNFURL_API = `${import.meta.env.VITE_THREESPEAK_API || '/api'}/spotlight/unfurl`;

let keySeq = 0;
export const newTimelineKey = () => `k${Date.now().toString(36)}${(keySeq += 1)}`;
/** The same list with an editing key on every item that lacks one. */
export const withTimelineKeys = (list) => (Array.isArray(list) ? list : [])
  .map((item) => (item && item._k ? item : { ...item, _k: newTimelineKey() }));

const byStart = (a, b) => a.start - b.start;
const byAt = (a, b) => a.at - b.at;

/**
 * What is wrong with a chapter list, as `upload.timeline.chapters.*` keys. Empty
 * means it is fine (or empty). The caller decides whether to block on it.
 */
export function chapterIssues(list, duration = 0) {
  const out = [];
  if (!Array.isArray(list) || !list.length) return out;
  const sorted = [...list].sort(byStart);
  if (sorted[0].start !== 0) out.push('errFirst');
  if (sorted.some((c, i) => i > 0 && c.start - sorted[i - 1].start < MIN_CHAPTER_SECONDS)) out.push('errMinGap');
  if (sorted.some((c) => !String(c.title || '').trim())) out.push('errTitle');
  if (duration > 0 && sorted.some((c) => c.start >= duration)) out.push('errEnd');
  if (sorted.length === 1) out.push('errTooFew');
  return out;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** "1:23", "83" or "1:02:03" → seconds, or null. */
function readTime(text) {
  const s = String(text || '').trim();
  if (/^\d{1,6}$/.test(s)) return Number(s);
  return parseStamp(s);
}

/** A time typed as m:ss. Commits on blur or Enter; nonsense goes back to the old value. */
function TimeField({ value, onCommit, max = 0, label, className = '', onFocus }) {
  const [text, setText] = useState(formatStamp(value));
  useEffect(() => { setText(formatStamp(value)); }, [value]);
  const commit = () => {
    const sec = readTime(text);
    if (sec == null) { setText(formatStamp(value)); return; }
    const next = max > 0 ? clamp(sec, 0, Math.max(0, Math.floor(max) - 1)) : Math.max(0, sec);
    setText(formatStamp(next));
    if (next !== value) onCommit(next);
  };
  return (
    <input
      type="text"
      inputMode="numeric"
      className={`tle-time ${className}`}
      value={text}
      aria-label={label}
      onFocus={onFocus}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
    />
  );
}

/** One link as a row: picture, title, kind. Light/dark aware (unlike the toaster). */
function LinkSummary({ link }) {
  const { t } = useTranslation();
  if (link.kind === 'video') {
    return (
      <span className="tle-link-sum">
        {link._thumb
          ? <img className="tle-link-sum__thumb" src={link._thumb} alt="" onError={(e) => { e.currentTarget.src = fallbackImg; }} />
          : <span className="tle-link-sum__icon"><Film size={16} /></span>}
        <span className="tle-link-sum__text">
          <span className="tle-link-sum__title">{link.title || `${link.author}/${link.permlink}`}</span>
          <span className="tle-link-sum__sub">{t('watch.timeline.video')} · @{link.author}</span>
        </span>
      </span>
    );
  }
  if (link.kind === 'profile') {
    return (
      <span className="tle-link-sum">
        <AccountImg className="tle-link-sum__avatar" account={link.account} alt="" />
        <span className="tle-link-sum__text">
          <span className="tle-link-sum__title">@{link.account}</span>
          <span className="tle-link-sum__sub">{t('watch.timeline.profile')}</span>
        </span>
      </span>
    );
  }
  return (
    <span className="tle-link-sum">
      <span className="tle-link-sum__icon"><Link2 size={16} /></span>
      <span className="tle-link-sum__text">
        <span className="tle-link-sum__title">{link.title || link.site || link.url}</span>
        <span className="tle-link-sum__sub">{t('watch.timeline.link')} · {link.site || siteOf(link.url)}</span>
      </span>
    </span>
  );
}

// ── Resolving what the creator pasted or picked ─────────────────────────────

async function unfurl(url) {
  try {
    const res = await fetch(UNFURL_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

const videoFromMeta = (m) => ({
  kind: 'video',
  author: m.author,
  permlink: m.permlink,
  title: m.title || '',
  _thumb: m.thumbnail ? fixVideoThumbnail({ thumbnail: m.thumbnail }) : null,
});

/** Pasted text → a link target ({kind,…} without at/dur). Throws an error key. */
async function resolvePasted(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  const handle = /^@([a-z][a-z0-9.-]{2,15})$/i.exec(s);
  if (handle) {
    const p = await fetchLinkMeta({ kind: 'profile', author: handle[1].toLowerCase() });
    if (!p) throw new Error('noAccount');
    return { kind: 'profile', account: p.author };
  }
  let candidate = s;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(candidate) && /^[\w-]+(\.[\w-]+)+(?:[/?#]|$)/.test(candidate)) {
    candidate = `https://${candidate}`;
  }
  const url = cleanUrl(candidate);
  if (!url) throw new Error('badUrl');

  // A 3Speak or Hive link: a video opens in the app, so does a profile.
  const hive = parseOne(url);
  if (hive?.kind === 'post') {
    const m = await fetchLinkMeta({ kind: 'post', author: hive.author.toLowerCase(), permlink: hive.permlink });
    if (m && m.kind === 'post' && m.isVideo) return videoFromMeta(m);
  } else if (hive?.kind === 'profile') {
    const p = await fetchLinkMeta({ kind: 'profile', author: hive.author.toLowerCase() });
    if (p) return { kind: 'profile', account: p.author };
  }

  // Anything else: unfurled ONCE, here, and the title and site stored with it,
  // so no viewer's browser ever fetches the page.
  const card = await unfurl(url);
  return {
    kind: 'url',
    url,
    title: (card?.title || '').trim(),
    site: (card?.siteName || '').trim() || siteOf(url),
  };
}

function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** Search results from the checker for the video / profile pickers. */
function useCheckerSearch(type, query) {
  const q = useDebounced(query.trim(), 350);
  const [state, setState] = useState({ q: '', loading: false, results: [] });
  useEffect(() => {
    if (q.length < 2) { setState({ q, loading: false, results: [] }); return undefined; }
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    axios.get(`${CHECKER_URL}/search`, { params: { q, type, limit: 8 } })
      .then((res) => { if (alive) setState({ q, loading: false, results: res.data?.results || [] }); })
      .catch(() => { if (alive) setState({ q, loading: false, results: [] }); });
    return () => { alive = false; };
  }, [type, q]);
  return state;
}

/** The add/edit link form: a bottom sheet on phones, a dialog elsewhere. */
function LinkSheet({ initial, defaultAt, duration, onSave, onClose }) {
  const { t } = useTranslation();
  const editing = !!initial;
  const [tab, setTab] = useState(() => {
    if (initial?.kind === 'video') return 'video';
    if (initial?.kind === 'profile') return 'profile';
    return 'link';
  });
  const [target, setTarget] = useState(initial ? { ...initial } : null);
  const [pasted, setPasted] = useState(initial?.kind === 'url' ? initial.url : '');
  const [query, setQuery] = useState('');
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState('');
  const [at, setAt] = useState(initial ? initial.at : defaultAt);
  const [dur, setDur] = useState(initial ? initial.dur : LINK_DUR_DEFAULT);
  const resolveSeq = useRef(0);
  // The text last resolved. Blur fires again when the creator reaches for Add,
  // and resolving the same text twice would disable the button under the click.
  const resolvedText = useRef(initial?.kind === 'url' ? initial.url : null);

  const videoSearch = useCheckerSearch('video', tab === 'video' ? query : '');
  const userSearch = useCheckerSearch('user', tab === 'profile' ? query : '');

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const resolve = async (text) => {
    if (text.trim() === resolvedText.current) return;
    resolvedText.current = text.trim();
    const seq = (resolveSeq.current += 1);
    setError('');
    if (!text.trim()) { setTarget(null); return; }
    setResolving(true);
    try {
      const got = await resolvePasted(text);
      if (seq === resolveSeq.current) setTarget(got);
    } catch (e) {
      if (seq === resolveSeq.current) {
        resolvedText.current = null;   // Enter may try again
        setTarget(null);
        setError(e?.message === 'noAccount' ? 'noAccount' : 'badUrl');
      }
    } finally {
      if (seq === resolveSeq.current) setResolving(false);
    }
  };

  const durNum = Math.round(Number(dur));
  const durOk = Number.isFinite(durNum) && durNum >= LINK_DUR_MIN && durNum <= LINK_DUR_MAX;
  const canSave = !!target && !resolving && durOk;

  const save = () => {
    if (!canSave) return;
    const { _k, _thumb, ...rest } = target;
    const n = normalizeLink({ ...rest, at, dur: durNum });
    if (!n) { setError('badUrl'); return; }
    onSave({ ...n, _k: initial?._k || newTimelineKey(), ...(target._thumb ? { _thumb: target._thumb } : {}) });
  };

  const pickTab = (next) => {
    if (next === tab) return;
    setTab(next);
    setError('');
    setQuery('');
  };

  const results = tab === 'video' ? videoSearch : userSearch;

  return createPortal(
    <div className="tle-sheet-backdrop" onClick={onClose}>
      <div
        className="tle-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={editing ? t('upload.timeline.form.editTitle') : t('upload.timeline.form.addTitle')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="tle-sheet__head">
          <h4>{editing ? t('upload.timeline.form.editTitle') : t('upload.timeline.form.addTitle')}</h4>
          <button type="button" className="tle-icon-btn" onClick={onClose} aria-label={t('common.actions.close')}>
            <X size={18} />
          </button>
        </div>

        <div className="tle-tabs" role="tablist">
          {[
            ['link', t('upload.timeline.form.tabLink')],
            ['video', t('upload.timeline.form.tabVideo')],
            ['profile', t('upload.timeline.form.tabProfile')],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={`tle-tab${tab === key ? ' is-active' : ''}`}
              onClick={() => pickTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'link' && (
          <div className="tle-field">
            <input
              type="text"
              className="tle-input"
              value={pasted}
              autoFocus
              placeholder={t('upload.timeline.form.urlPlaceholder')}
              onChange={(e) => setPasted(e.target.value)}
              onBlur={() => resolve(pasted)}
              onPaste={(e) => {
                const text = e.clipboardData?.getData('text') || '';
                if (text) { e.preventDefault(); setPasted(text.trim()); resolve(text); }
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); resolve(pasted); } }}
            />
            <p className="tle-hint">{t('upload.timeline.form.urlHint')}</p>
          </div>
        )}

        {tab !== 'link' && (
          <div className="tle-field">
            <div className="tle-search">
              <Search size={16} />
              <input
                type="search"
                className="tle-input"
                value={query}
                autoFocus
                placeholder={tab === 'video' ? t('upload.timeline.form.searchVideo') : t('upload.timeline.form.searchProfile')}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            {query.trim().length >= 2 && (
              <ul className="tle-results">
                {results.loading && !results.results.length && (
                  <li className="tle-results__note">{t('upload.timeline.form.searching')}</li>
                )}
                {!results.loading && !results.results.length && results.q === query.trim() && (
                  <li className="tle-results__note">{t('upload.timeline.form.noResults')}</li>
                )}
                {tab === 'video' && results.results.filter((r) => r.author && r.permlink).map((r) => (
                  <li key={`${r.author}/${r.permlink}`}>
                    <button
                      type="button"
                      className="tle-result"
                      onClick={() => {
                        setTarget({
                          kind: 'video', author: r.author, permlink: r.permlink, title: r.title || '',
                          _thumb: fixVideoThumbnail(r),
                        });
                        setQuery('');
                      }}
                    >
                      <img className="tle-link-sum__thumb" src={fixVideoThumbnail(r)} alt="" loading="lazy" onError={(e) => { e.currentTarget.src = fallbackImg; }} />
                      <span className="tle-link-sum__text">
                        <span className="tle-link-sum__title">{r.title}</span>
                        <span className="tle-link-sum__sub">@{r.author}</span>
                      </span>
                    </button>
                  </li>
                ))}
                {tab === 'profile' && results.results.filter((r) => ACCOUNT_RE.test(r.username || '')).map((r) => (
                  <li key={r.username}>
                    <button
                      type="button"
                      className="tle-result"
                      onClick={() => { setTarget({ kind: 'profile', account: r.username }); setQuery(''); }}
                    >
                      <AccountImg className="tle-link-sum__avatar" account={r.username} alt="" loading="lazy" />
                      <span className="tle-link-sum__text">
                        <span className="tle-link-sum__title">{r.display_name || r.username}</span>
                        <span className="tle-link-sum__sub">@{r.username}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {resolving && <p className="tle-hint">{t('upload.timeline.form.checking')}</p>}
        {error && <p className="tle-issue">{t(`upload.timeline.form.${error}`)}</p>}

        {target && !resolving && (
          <div className="tle-picked">
            <LinkSummary link={target} />
          </div>
        )}

        <div className="tle-sheet__times">
          <label className="tle-labelled">
            <span>{t('upload.timeline.links.showsAt')}</span>
            <span className="tle-inline">
              <TimeField value={at} max={duration} onCommit={setAt} label={t('upload.timeline.links.showsAt')} />
              <button
                type="button"
                className="tle-icon-btn"
                title={t('upload.timeline.setNow')}
                aria-label={t('upload.timeline.setNow')}
                onClick={() => setAt(Math.floor(defaultAt))}
              >
                <Clock size={16} />
              </button>
            </span>
          </label>
          <label className="tle-labelled">
            <span>{t('upload.timeline.links.onScreen')}</span>
            <span className="tle-inline">
              <input
                type="number"
                className={`tle-input tle-input--dur${durOk ? '' : ' is-invalid'}`}
                min={LINK_DUR_MIN}
                max={LINK_DUR_MAX}
                step={1}
                value={dur}
                onChange={(e) => setDur(e.target.value)}
                onBlur={() => { if (!durOk) setDur(clamp(Number.isFinite(durNum) ? durNum : LINK_DUR_DEFAULT, LINK_DUR_MIN, LINK_DUR_MAX)); }}
              />
              <span className="tle-unit">{t('upload.timeline.links.secondsUnit')}</span>
            </span>
          </label>
        </div>

        <div className="tle-sheet__actions">
          <button type="button" className="tle-btn tle-btn--secondary" onClick={onClose}>
            {t('common.actions.cancel')}
          </button>
          <button type="button" className="tle-btn tle-btn--primary" disabled={!canSave} onClick={save}>
            {editing ? t('common.actions.save') : t('upload.timeline.form.addButton')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── The editor ───────────────────────────────────────────────────────────────

const LANE_H = 22;

/** Greedy lanes so overlapping links stack instead of hiding each other. */
function laneLinks(links, duration) {
  const lanes = [];
  const minSpan = duration > 0 ? duration * 0.02 : 1;   // a marker is never thinner than ~2% to the eye
  return links.map((l) => {
    const end = l.at + Math.max(l.dur, minSpan);
    let lane = lanes.findIndex((laneEnd) => laneEnd <= l.at);
    if (lane === -1) { lane = lanes.length; lanes.push(end); } else lanes[lane] = end;
    return { link: l, lane };
  });
}

export default function TimelineEditor({
  src = null,
  hls = false,
  poster = null,
  duration: durationHint = 0,
  chapters,
  links,
  onChaptersChange,
  onLinksChange,
  compact = false,
}) {
  const { t } = useTranslation();
  const videoRef = useRef(null);
  const trackRef = useRef(null);
  const dragRef = useRef(null);
  const rowRefs = useRef(new Map());
  const titleRefs = useRef(new Map());
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [mediaDuration, setMediaDuration] = useState(0);
  const [mediaError, setMediaError] = useState(false);
  const [selected, setSelected] = useState(null);       // { type: 'chapter'|'link', key }
  const [sheet, setSheet] = useState(null);             // { key|null }
  const [focusKey, setFocusKey] = useState(null);

  const chapterList = useMemo(() => [...(chapters || [])].sort(byStart), [chapters]);
  const linkList = useMemo(() => [...(links || [])].sort(byAt), [links]);

  const hint = Number(durationHint);
  const duration = mediaDuration > 0
    ? mediaDuration
    : (Number.isFinite(hint) && hint > 0 ? hint : 0);
  const canPlay = !!src && !mediaError;

  // ── media ────────────────────────────────────────────────────────────────
  useEffect(() => { setMediaError(false); setMediaDuration(0); setCurrentTime(0); }, [src]);

  // A published video is an HLS manifest. Safari plays that from a src; everyone
  // else needs hls.js, imported only when the dialog actually asks for it.
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !src || !hls) return undefined;
    let h = null;
    let cancelled = false;
    import('hls.js')
      .then(({ default: Hls }) => {
        if (cancelled) return;
        if (Hls.isSupported()) {
          h = new Hls({ maxBufferLength: 20 });
          h.on(Hls.Events.ERROR, (_e, data) => { if (data?.fatal) setMediaError(true); });
          h.loadSource(src);
          h.attachMedia(el);
        } else if (el.canPlayType('application/vnd.apple.mpegurl')) {
          el.src = src;
        } else {
          setMediaError(true);
        }
      })
      .catch(() => { if (!cancelled) setMediaError(true); });
    return () => { cancelled = true; if (h) h.destroy(); };
  }, [src, hls]);

  const readDuration = () => {
    const d = videoRef.current?.duration;
    // A camera recording (WebM) can report Infinity: keep the caller's figure then.
    if (Number.isFinite(d) && d > 0) setMediaDuration(d);
  };

  const seek = useCallback((sec) => {
    const tSec = Math.max(0, duration > 0 ? Math.min(sec, duration) : sec);
    setCurrentTime(tSec);
    const el = videoRef.current;
    if (el && canPlay) {
      try { el.currentTime = tSec; } catch { /* not seekable yet */ }
    }
  }, [duration, canPlay]);

  // ── selection ────────────────────────────────────────────────────────────
  const select = useCallback((type, key, { seekTo = true, scroll = false } = {}) => {
    setSelected({ type, key });
    if (seekTo) {
      const item = type === 'chapter'
        ? (chapters || []).find((c) => c._k === key)
        : (links || []).find((l) => l._k === key);
      if (item) seek(type === 'chapter' ? item.start : item.at);
    }
    if (scroll) {
      requestAnimationFrame(() => rowRefs.current.get(`${type}:${key}`)?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }));
    }
  }, [chapters, links, seek]);

  useEffect(() => {
    if (!focusKey) return;
    titleRefs.current.get(focusKey)?.focus();
    setFocusKey(null);
  }, [focusKey, chapters]);

  // ── edits ────────────────────────────────────────────────────────────────
  const setChapters = (next) => onChaptersChange([...next].sort(byStart));
  const setLinks = (next) => onLinksChange([...next].sort(byAt));
  const patchChapter = (key, patch) => setChapters(chapterList.map((c) => (c._k === key ? { ...c, ...patch } : c)));
  const patchLink = (key, patch) => setLinks(linkList.map((l) => (l._k === key ? { ...l, ...patch } : l)));

  const now = Math.floor(currentTime);
  const addChapter = () => {
    if (chapterList.length >= MAX_CHAPTERS) return;
    const additions = [];
    // The first chapter always starts at 0:00, so the first press adds it too.
    if (!chapterList.length && now >= MIN_CHAPTER_SECONDS) additions.push({ _k: newTimelineKey(), start: 0, title: '' });
    const at = !chapterList.length && now < MIN_CHAPTER_SECONDS ? 0 : now;
    const taken = chapterList.some((c) => c.start === at);
    const fresh = { _k: newTimelineKey(), start: taken ? at + 1 : at, title: '' };
    additions.push(fresh);
    setChapters([...chapterList, ...additions]);
    setSelected({ type: 'chapter', key: fresh._k });
    setFocusKey(additions[0]._k);
  };
  const removeChapter = (key) => {
    setChapters(chapterList.filter((c) => c._k !== key));
    if (selected?.key === key) setSelected(null);
  };
  const removeLink = (key) => {
    setLinks(linkList.filter((l) => l._k !== key));
    if (selected?.key === key) setSelected(null);
  };
  const saveLink = (link) => {
    const exists = linkList.some((l) => l._k === link._k);
    setLinks(exists ? linkList.map((l) => (l._k === link._k ? link : l)) : [...linkList, link]);
    setSheet(null);
    setSelected({ type: 'link', key: link._k });
    seek(link.at);
  };

  // ── the track: tap to seek, drag to scrub, drag a marker or an edge to retime ──
  const timeAtX = (clientX) => {
    const r = trackRef.current?.getBoundingClientRect();
    if (!r || !r.width || !(duration > 0)) return 0;
    return clamp(((clientX - r.left) / r.width) * duration, 0, duration);
  };

  const onTrackDown = (e) => {
    if (!(duration > 0) || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const el = e.target.closest('[data-tl]');
    const kind = el?.dataset.tl || 'seek';
    const key = el?.dataset.key || null;
    const tSec = timeAtX(e.clientX);
    const d = { kind, key, x: e.clientX, moved: false, offset: 0, id: e.pointerId };
    if (kind === 'link') {
      const l = linkList.find((x) => x._k === key);
      d.offset = l ? tSec - l.at : 0;
    }
    dragRef.current = d;
    try { trackRef.current.setPointerCapture(e.pointerId); } catch { /* fine without */ }
    if (kind === 'seek') seek(tSec);
    e.preventDefault();
  };

  const onTrackMove = (e) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    if (!d.moved && Math.abs(e.clientX - d.x) < 4) return;
    d.moved = true;
    const tSec = timeAtX(e.clientX);
    if (d.kind === 'edge') {
      const i = chapterList.findIndex((c) => c._k === d.key);
      if (i <= 0) return;
      const lo = chapterList[i - 1].start + MIN_CHAPTER_SECONDS;
      const hi = (i + 1 < chapterList.length ? chapterList[i + 1].start : Math.floor(duration)) - MIN_CHAPTER_SECONDS;
      if (hi < lo) return;
      const start = clamp(Math.round(tSec), lo, hi);
      if (start !== chapterList[i].start) patchChapter(d.key, { start });
      setSelected({ type: 'chapter', key: d.key });
      seek(start);
    } else if (d.kind === 'link') {
      const at = clamp(Math.round(tSec - d.offset), 0, Math.max(0, Math.floor(duration) - 1));
      const l = linkList.find((x) => x._k === d.key);
      if (l && at !== l.at) patchLink(d.key, { at });
      setSelected({ type: 'link', key: d.key });
      seek(at);
    } else {
      seek(tSec);
    }
  };

  const onTrackUp = (e) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    dragRef.current = null;
    try { trackRef.current.releasePointerCapture(e.pointerId); } catch { /* fine */ }
    if (d.moved) return;
    if (d.kind === 'chapter' || d.kind === 'edge') select('chapter', d.key, { scroll: true });
    else if (d.kind === 'link') select('link', d.key, { scroll: true });
  };

  // Arrow keys move a focused edge or marker by a second (Shift: five).
  const onMarkerKey = (type, key) => (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const step = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 5 : 1);
    if (type === 'edge') {
      const i = chapterList.findIndex((c) => c._k === key);
      if (i <= 0) return;
      const lo = chapterList[i - 1].start + MIN_CHAPTER_SECONDS;
      const hi = (i + 1 < chapterList.length ? chapterList[i + 1].start : Math.floor(duration)) - MIN_CHAPTER_SECONDS;
      const start = clamp(chapterList[i].start + step, lo, Math.max(lo, hi));
      patchChapter(key, { start });
      seek(start);
    } else {
      const l = linkList.find((x) => x._k === key);
      if (!l) return;
      const at = clamp(l.at + step, 0, Math.max(0, Math.floor(duration) - 1));
      patchLink(key, { at });
      seek(at);
    }
  };

  // ── derived ──────────────────────────────────────────────────────────────
  const liveChapter = chapterAt(chapterList, currentTime);
  const liveLinks = new Set(activeLinksAt(linkList, currentTime).map((l) => l._k));
  const issues = chapterIssues(chapterList, duration);
  const laned = laneLinks(linkList, duration);
  const laneCount = Math.max(1, ...laned.map((x) => x.lane + 1));
  const pct = (sec) => `${duration > 0 ? clamp((sec / duration) * 100, 0, 100) : 0}%`;
  const selectedLinkIndex = selected?.type === 'link' ? linkList.findIndex((l) => l._k === selected.key) : -1;

  const rowInvalid = (c, i) => (
    !String(c.title || '').trim()
    || (i === 0 && c.start !== 0)
    || (i > 0 && c.start - chapterList[i - 1].start < MIN_CHAPTER_SECONDS)
    || (duration > 0 && c.start >= duration)
  );

  return (
    <div className={`tle${compact ? ' tle--compact' : ''}`}>
      <div className="tle-top">
        {/* Preview: the real file (or the published stream), with the toasters
            drawn by the same component the watch page uses. */}
        <div className="tle-preview">
          <div className="tle-stage">
            {src && !mediaError ? (
              <video
                ref={videoRef}
                src={hls ? undefined : src}
                poster={poster || undefined}
                controls
                playsInline
                preload="metadata"
                controlsList="nofullscreen nodownload noremoteplayback"
                disablePictureInPicture
                onLoadedMetadata={readDuration}
                onDurationChange={readDuration}
                onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime || 0)}
                onSeeked={(e) => setCurrentTime(e.currentTarget.currentTime || 0)}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onError={() => setMediaError(true)}
              />
            ) : (
              <div className="tle-stage__fallback">
                <Film size={28} />
                <p>{src ? t('upload.timeline.previewUnavailable') : t('upload.timeline.noPreview')}</p>
              </div>
            )}
            <TimelineToasters
              links={linkList}
              currentTime={currentTime}
              top={8}
              compact
              resetKey={linkList}
              onSelect={(i) => { const l = linkList[i]; if (l) select('link', l._k, { seekTo: false, scroll: true }); }}
              selectedIndex={selectedLinkIndex >= 0 ? selectedLinkIndex : null}
            />
          </div>
          <div className="tle-now">
            <span className="tle-now__time">
              {formatStamp(currentTime)}{duration > 0 ? ` / ${formatStamp(duration)}` : ''}
            </span>
            {liveChapter && <span className="tle-now__chapter">{liveChapter.title || '…'}</span>}
          </div>
        </div>

        {duration > 0 && (
          <div className="tle-trackwrap">
            <div
              ref={trackRef}
              className={`tle-track${playing ? ' is-playing' : ''}`}
              role="group"
              aria-label={t('upload.timeline.trackLabel')}
              onPointerDown={onTrackDown}
              onPointerMove={onTrackMove}
              onPointerUp={onTrackUp}
              onPointerCancel={onTrackUp}
            >
              <div className="tle-track__chapters">
                {chapterList.map((c, i) => {
                  const end = i + 1 < chapterList.length ? chapterList[i + 1].start : duration;
                  const isSel = selected?.type === 'chapter' && selected.key === c._k;
                  return (
                    <div
                      key={c._k}
                      data-tl="chapter"
                      data-key={c._k}
                      className={`tle-seg${isSel ? ' is-selected' : ''}${liveChapter?._k === c._k ? ' is-live' : ''}${rowInvalid(c, i) ? ' is-invalid' : ''}`}
                      style={{ left: pct(c.start), width: `calc(${pct(Math.max(0, end - c.start))} - 2px)` }}
                      title={`${formatStamp(c.start)} ${c.title || ''}`}
                    >
                      <span className="tle-seg__label">{c.title || formatStamp(c.start)}</span>
                    </div>
                  );
                })}
                {chapterList.map((c, i) => (i === 0 ? null : (
                  <div
                    key={`edge-${c._k}`}
                    data-tl="edge"
                    data-key={c._k}
                    className="tle-edge"
                    style={{ left: pct(c.start) }}
                    tabIndex={0}
                    role="slider"
                    aria-label={t('upload.timeline.moveChapter', { title: c.title || formatStamp(c.start) })}
                    aria-valuemin={0}
                    aria-valuemax={Math.floor(duration)}
                    aria-valuenow={c.start}
                    aria-valuetext={formatStamp(c.start)}
                    onKeyDown={onMarkerKey('edge', c._k)}
                  />
                )))}
              </div>
              <div className="tle-track__links" style={{ height: laneCount * LANE_H }}>
                {laned.map(({ link: l, lane }) => {
                  const isSel = selected?.type === 'link' && selected.key === l._k;
                  return (
                    <div
                      key={l._k}
                      data-tl="link"
                      data-key={l._k}
                      className={`tle-mark tle-mark--${l.kind}${isSel ? ' is-selected' : ''}${liveLinks.has(l._k) ? ' is-live' : ''}`}
                      style={{ left: pct(l.at), width: pct(Math.min(l.dur, Math.max(0, duration - l.at))), top: lane * LANE_H }}
                      tabIndex={0}
                      role="slider"
                      aria-label={t('upload.timeline.moveLink')}
                      aria-valuemin={0}
                      aria-valuemax={Math.floor(duration)}
                      aria-valuenow={l.at}
                      aria-valuetext={formatStamp(l.at)}
                      onKeyDown={onMarkerKey('link', l._k)}
                    >
                      {l.kind === 'video' ? <Film size={11} /> : l.kind === 'profile' ? <span className="tle-mark__at">@</span> : <Link2 size={11} />}
                    </div>
                  );
                })}
              </div>
              <div className="tle-playhead" style={{ left: pct(currentTime) }} />
            </div>
            <div className="tle-ruler">
              <span>0:00</span>
              <span>{formatStamp(duration / 2)}</span>
              <span>{formatStamp(duration)}</span>
            </div>
          </div>
        )}
      </div>

      <div className="tle-lists">
        {/* Chapters */}
        <section className="tle-section">
          <header className="tle-section__head">
            <h3>{t('upload.timeline.chapters.heading')}</h3>
            <button type="button" className="tle-btn tle-btn--primary tle-btn--sm" onClick={addChapter} disabled={chapterList.length >= MAX_CHAPTERS}>
              <Plus size={15} /> {t('upload.timeline.chapters.add', { time: formatStamp(now) })}
            </button>
          </header>
          <p className="tle-hint">{t('upload.timeline.chapters.hintAll')}</p>
          {issues.map((k) => <p key={k} className="tle-issue">{t(`upload.timeline.chapters.${k}`, { seconds: MIN_CHAPTER_SECONDS })}</p>)}
          {chapterList.length >= MAX_CHAPTERS && <p className="tle-hint">{t('upload.timeline.chapters.max', { max: MAX_CHAPTERS })}</p>}
          {!chapterList.length ? (
            <p className="tle-empty">{t('upload.timeline.chapters.empty')}</p>
          ) : (
            <ol className="tle-list">
              {chapterList.map((c, i) => {
                const isSel = selected?.type === 'chapter' && selected.key === c._k;
                return (
                  <li
                    key={c._k}
                    ref={(el) => { if (el) rowRefs.current.set(`chapter:${c._k}`, el); else rowRefs.current.delete(`chapter:${c._k}`); }}
                    className={`tle-row${isSel ? ' is-selected' : ''}${liveChapter?._k === c._k ? ' is-live' : ''}${rowInvalid(c, i) ? ' is-invalid' : ''}`}
                    onClick={(e) => { if (!e.target.closest('input,button')) select('chapter', c._k); }}
                  >
                    <TimeField
                      value={c.start}
                      max={duration}
                      label={t('upload.timeline.chapters.start')}
                      onFocus={() => select('chapter', c._k)}
                      onCommit={(start) => { patchChapter(c._k, { start }); seek(start); }}
                    />
                    <input
                      ref={(el) => { if (el) titleRefs.current.set(c._k, el); else titleRefs.current.delete(c._k); }}
                      type="text"
                      className="tle-input tle-row__title"
                      value={c.title}
                      maxLength={CHAPTER_TITLE_MAX}
                      placeholder={t('upload.timeline.chapters.titlePlaceholder')}
                      aria-label={t('upload.timeline.chapters.titlePlaceholder')}
                      onFocus={() => select('chapter', c._k, { seekTo: !playing })}
                      onChange={(e) => patchChapter(c._k, { title: e.target.value })}
                      // Inside the Edit dialog's <form>: Enter must not submit (save) it.
                      onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
                    />
                    <button
                      type="button"
                      className="tle-icon-btn"
                      title={t('upload.timeline.setNow')}
                      aria-label={t('upload.timeline.setNow')}
                      onClick={() => patchChapter(c._k, { start: now })}
                    >
                      <Clock size={16} />
                    </button>
                    <button
                      type="button"
                      className="tle-icon-btn tle-icon-btn--danger"
                      title={t('common.actions.remove')}
                      aria-label={t('common.actions.remove')}
                      onClick={() => removeChapter(c._k)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {/* Links */}
        <section className="tle-section">
          <header className="tle-section__head">
            <h3>
              {t('upload.timeline.links.heading')}
              <span className="tle-count">{t('upload.timeline.links.count', { n: linkList.length, max: MAX_LINKS })}</span>
            </h3>
            <button
              type="button"
              className="tle-btn tle-btn--primary tle-btn--sm"
              onClick={() => setSheet({ key: null })}
              disabled={linkList.length >= MAX_LINKS}
            >
              <Plus size={15} /> {t('upload.timeline.links.add')}
            </button>
          </header>
          <p className="tle-hint">{t('upload.timeline.links.hint')}</p>
          {linkList.length >= MAX_LINKS && <p className="tle-hint">{t('upload.timeline.links.max', { max: MAX_LINKS })}</p>}
          {!linkList.length ? (
            <p className="tle-empty">{t('upload.timeline.links.empty')}</p>
          ) : (
            <ul className="tle-list">
              {linkList.map((l) => {
                const isSel = selected?.type === 'link' && selected.key === l._k;
                const past = duration > 0 && l.at >= duration;
                return (
                  <li
                    key={l._k}
                    ref={(el) => { if (el) rowRefs.current.set(`link:${l._k}`, el); else rowRefs.current.delete(`link:${l._k}`); }}
                    className={`tle-row tle-row--link${isSel ? ' is-selected' : ''}${liveLinks.has(l._k) ? ' is-live' : ''}${past ? ' is-invalid' : ''}`}
                    onClick={(e) => { if (!e.target.closest('input,button')) select('link', l._k); }}
                  >
                    <span className="tle-row__summary"><LinkSummary link={l} /></span>
                    <span className="tle-row__times">
                      <TimeField
                        value={l.at}
                        max={duration}
                        label={t('upload.timeline.links.showsAt')}
                        onFocus={() => select('link', l._k)}
                        onCommit={(at) => { patchLink(l._k, { at }); seek(at); }}
                      />
                      <span className="tle-unit">{t('upload.timeline.links.forSeconds', { seconds: l.dur })}</span>
                    </span>
                    <span className="tle-row__actions">
                      <button
                        type="button"
                        className="tle-icon-btn"
                        title={t('upload.timeline.setNow')}
                        aria-label={t('upload.timeline.setNow')}
                        onClick={() => { patchLink(l._k, { at: clamp(now, 0, duration > 0 ? Math.max(0, Math.floor(duration) - 1) : now) }); }}
                      >
                        <Clock size={16} />
                      </button>
                      <button
                        type="button"
                        className="tle-icon-btn"
                        title={t('common.actions.edit')}
                        aria-label={t('common.actions.edit')}
                        onClick={() => setSheet({ key: l._k })}
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        type="button"
                        className="tle-icon-btn tle-icon-btn--danger"
                        title={t('common.actions.remove')}
                        aria-label={t('common.actions.remove')}
                        onClick={() => removeLink(l._k)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </span>
                    {past && <span className="tle-issue tle-row__issue">{t('upload.timeline.links.afterEnd')}</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {sheet && (
        <LinkSheet
          initial={sheet.key ? linkList.find((l) => l._k === sheet.key) || null : null}
          defaultAt={duration > 0 ? clamp(now, 0, Math.max(0, Math.floor(duration) - 1)) : now}
          duration={duration}
          onSave={saveLink}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}
