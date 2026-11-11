import { Icon } from '../v2/Icon';
import { Segmented, Chip, Toggle } from '../v2/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../lib/store';
import { toastIn } from '../../utils/toast';
import {
  usePodcastConfig, usePodcastSubscriptions, usePodcastLatest, usePodcastFeed, usePodcastDiscover, useInvalidatePodcasts,
  followFeeds, unfollowFeed, setFeedNotify, followErrorText, fetchOlderEpisodes, searchPodcasts, searchPeople,
  usePodcastTrending, usePodcastCharts, TRENDING_CATEGORIES, CHART_COUNTRIES, feedKey,
  episodeToTrack, liveToTrack, parseOpml, downloadOpml, buildPrivateFeedUrl,
} from '../../lib/podcasts';
import { PODCAST_PRESETS, tipOptions, splitSats, canTipEpisode, hasWebln } from '../../lib/podcastTips';
import PodcastTipModal from './PodcastTipModal';
import PodcastArt from './PodcastArt';
import EpisodeView from './EpisodeView';
import { useDateFormat } from '../../lib/podcastFormat';
import { getLanguage } from '../../i18n';
import { LANGUAGES as UI_LANGUAGES } from '../../i18n/languages';
import { usePodcastProgress, progressOf } from '../../lib/podcastProgress';
import { isDownloaded, useDownloads } from '../../lib/podcastDownloads';
import {
  matchesListenFilter, isInboxEpisode, readMineVisit, markMineVisit, seasonsOf, trailerOf,
  readAutoQueue, setAutoQueue, markAutoQueued, pickAutoQueue, isLiveNow, fmtClock, fmtBytes,
} from '../../lib/podcastLibrary';
import { EpisodeBadges, DownloadButton, PersonsRow, LiveBanner, PrivateBadge } from './PodcastBits';
import DownloadsSection from './DownloadsSection';
import ContinueListening, { useContinueListening } from './ContinueListening';
import useOnline from '../../hooks/useOnline';
import { openEmbedCode } from '../Embed/EmbedCodeModal';
import { EpisodeTile, EpisodeRow } from './EpisodeTile';
import './PodcastsTab.scss';

// ─── Filters: date range and listening state ──────────────────────────────────

const DAY_MS = 24 * 3600 * 1000;
const DATE_FILTERS = [
  { days: 0, labelKey: 'audio.podcasts.filters.allTime' },
  { days: 7, labelKey: 'audio.page.dates.thisWeek' },
  { days: 30, labelKey: 'audio.page.dates.thisMonth' },
  { days: 365, labelKey: 'audio.page.dates.thisYear' },
  { days: 'custom', labelKey: 'audio.podcasts.filters.custom' },
];
// Smart filters (lib/podcastLibrary.js). "New" is the inbox on Mine only.
const LISTEN_FILTERS = [
  { key: 'new', labelKey: 'audio.podcasts.filters.inbox', mineOnly: true },
  { key: 'all', labelKey: 'audio.podcasts.filters.all' },
  { key: 'unplayed', labelKey: 'audio.podcasts.filters.unplayed' },
  { key: 'inProgress', labelKey: 'audio.podcasts.filters.inProgress' },
  { key: 'downloaded', labelKey: 'audio.podcasts.filters.downloaded' },
];

/** The cut-off date for a date filter, stable within a day so queries can cache. */
const sinceFor = (days) => (days ? new Date(Math.floor((Date.now() - days * DAY_MS) / DAY_MS) * DAY_MS).toISOString() : '');

/**
 * { since, until } (ISO, '' = open) for a preset or the custom range. The custom
 * dates are the listener's local days: from the start of "from" to the end of "to".
 */
function rangeFor(days, range) {
  if (days !== 'custom') return { since: sinceFor(days), until: '' };
  const day = (v, end) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? new Date(`${v}T${end ? '23:59:59.999' : '00:00:00'}`).toISOString() : '');
  return { since: day(range.from, false), until: day(range.to, true) };
}

function inRange(ep, { since, until }) {
  const at = ep.published_at ? new Date(ep.published_at).getTime() : 0;
  return (!since || at >= new Date(since).getTime()) && (!until || at <= new Date(until).getTime());
}

const matchesListen = (ep, listen, lastVisit = 0) => matchesListenFilter(ep, listen, { progressOf, isDownloaded, lastVisit });

/** A 3Speak playlist's own RSS feed, followed like an outside show ("On 3Speak" on its cover). */
const isOn3Speak = (url) => /^https?:\/\/([a-z0-9-]+\.)?3speak\.tv\/rss\//i.test(url || '');

/**
 * Listening state on the left, date range on the right, the 3Speak audio filter
 * look. `inbox` (Mine) adds "New" with how many there are.
 */
function EpisodeFilters({ days, onDays, listen, onListen, range, onRange, inbox = null }) {
  const { t } = useTranslation();
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="pod-filters">
      <div className="audio-type-filter pod-filter-listen v2-chips" role="group" aria-label={t('audio.podcasts.filters.listenLabel')}>
        {LISTEN_FILTERS.filter((f) => inbox != null || !f.mineOnly).map((f) => (
          <Chip key={f.key} selected={listen === f.key} onClick={() => onListen(f.key)} count={f.key === 'new' && inbox > 0 ? inbox : undefined}>
            {t(f.labelKey)}
          </Chip>
        ))}
      </div>
      <Segmented
        className="audio-date-presets pod-filter-dates"
        block={false}
        label={t('audio.podcasts.filters.dateLabel')}
        value={days}
        onChange={onDays}
        options={DATE_FILTERS.map((f) => ({ value: f.days, label: t(f.labelKey) }))}
      />
      {days === 'custom' && (
        <div className="pod-filter-range">
          <label>
            <span>{t('audio.podcasts.filters.from')}</span>
            <input className="v2-input h32" type="date" value={range.from} max={range.to || today} onChange={(e) => onRange({ ...range, from: e.target.value })} />
          </label>
          <label>
            <span>{t('audio.podcasts.filters.to')}</span>
            <input className="v2-input h32" type="date" value={range.to} min={range.from || undefined} max={today} onChange={(e) => onRange({ ...range, to: e.target.value })} />
          </label>
        </div>
      )}
    </div>
  );
}

// ─── One episode ──────────────────────────────────────────────────────────────

// ─── Show cards ───────────────────────────────────────────────────────────────

/**
 * A show as a cover card (36c): on its cover the rank of a top list, where it
 * comes from (On 3Speak / External), live and private. `follow` adds the Follow
 * link under it, for a show not on 3Speak yet (trending).
 */
function ShowCard({ feed, onOpen, rank, note, fallbackArt, follow }) {
  const { t } = useTranslation();
  const art = (
    <span className="pod-card-art">
      <PodcastArt art={feed.art} fallback={fallbackArt} px={256} />
      <span className="pod-card-chips">
        {rank && <span className="pod-card-rank">{rank}</span>}
        {feed.url && <span className="pod-card-chip">{isOn3Speak(feed.url) ? t('audio.podcasts.on3speak') : t('audio.podcasts.chip')}</span>}
      </span>
      {isLiveNow(feed) && <span className="pod-card-live">{t('audio.podcasts.live.badge')}</span>}
      {feed.private && <span className="pod-card-lock"><PrivateBadge /></span>}
    </span>
  );
  const text = (
    <>
      <span className="pod-card-title">{feed.title || feed.url || t('audio.podcasts.private.badge')}</span>
      <span className="pod-card-meta">
        {note || (feed.subscribers ? t('audio.podcasts.followers', { count: feed.subscribers }) : feed.author)}
      </span>
    </>
  );
  if (follow) {
    return (
      <div className="pod-card" title={feed.title || undefined}>
        {art}
        {text}
        {follow}
      </div>
    );
  }
  return (
    <button type="button" className={`pod-card${feed.status === 'error' ? ' pod-card--error' : ''}`} onClick={() => onOpen(feed.id)} title={feed.title || feed.url || undefined}>
      {art}
      {text}
    </button>
  );
}

/** A row of covers, five across beside the side column (Discover), the rest a scroll away. */
function ShowRail({ title, feeds, onOpen, ranked = false, noteFor, artFor, tone, five = true }) {
  if (!feeds?.length) return null;
  return (
    <section className="pod-section">
      <h2 className={`pod-app-title${tone ? ` is-${tone}` : ''}`}>{title}</h2>
      <div className={`pod-rail${five ? ' pod-rail--five' : ''}`}>
        {feeds.map((f, i) => <ShowCard key={f.id} feed={f} onOpen={onOpen} rank={ranked ? i + 1 : null} note={noteFor?.(f)} fallbackArt={artFor?.(f)} />)}
      </div>
    </section>
  );
}

// ─── Following from a list (search, trending) ─────────────────────────────────

/**
 * Follow one feed URL or a whole OPML list, with the toasts that go with it.
 * `note` keeps the last outcome for the side cards (36c): an OPML import's
 * count, or why a pasted link could not be followed.
 */
function useFollowFeeds(user, onFollowed) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const follow = async (urls, titles, priv) => {
    if (!user) { toastIn('Podcasts').error(t('audio.podcasts.errors.signIn')); return false; }
    setBusy(true);
    try {
      const res = await followFeeds(user, urls, titles, priv);
      const ok = res.filter((r) => r.ok);
      const failed = res.filter((r) => !r.ok);
      if (urls.length === 1) {
        if (ok.length) {
          toastIn('Podcasts').success(ok[0].already ? t('audio.podcasts.alreadyFollowing') : t('audio.podcasts.followed'));
          setNote(null);
          onFollowed?.(ok[0].feed_id);
        } else {
          const text = followErrorText(failed[0]?.code, failed[0]);
          toastIn('Podcasts').error(text);
          setNote({ tone: 'warn', text });
        }
      } else {
        const text = t('audio.podcasts.opml.imported', { count: ok.length, failed: failed.length });
        toastIn('Podcasts').success(text);
        setNote({ tone: 'info', text });
        onFollowed?.(null);
      }
      return ok.length > 0;
    } catch (err) {
      toastIn('Podcasts').error(err.message || followErrorText());
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, follow, note, setNote };
}

/** Follow (cyan) or Following (a check), for a show from a directory. */
function FollowLink({ url, followed, busy, onFollow }) {
  const { t } = useTranslation();
  return followed.has(feedKey(url))
    ? <span className="pod-following"><Icon name="check" size={14} /> {t('audio.podcasts.following')}</span>
    : <button type="button" className="pod-follow-link" disabled={busy} onClick={() => onFollow([url])}>{t('audio.podcasts.follow')}</button>;
}

/**
 * Shows from Podcast Index / Apple (search, a person search, top charts): not
 * on 3Speak yet, so the action is Follow. Two rows across (36c "Top charts");
 * a chart's rank in the number tile, the first in accent. A person search adds
 * how many of their episodes the show has, and the newest one.
 */
function PiResults({ list, followed, busy, onFollow }) {
  const { t } = useTranslation();
  return (
    <div className="pod-results">
      {list.map((r) => (
        <div key={r.url} className="pod-result">
          {r.rank > 0 && <span className={`pod-result-rank${r.rank === 1 ? ' is-first' : ''}`}>{r.rank}</span>}
          <PodcastArt art={r.art} px={128} className="pod-result-art" />
          <div className="pod-result-body">
            <div className="pod-result-title" title={r.title}>{r.title}</div>
            {r.author && <div className="pod-result-meta">{r.author}</div>}
            {r.matches > 0 ? (
              <>
                <div className="pod-result-meta pod-result-meta--accent">{t('audio.podcasts.search.appearsIn', { count: r.matches })}</div>
                {r.sample && <div className="pod-result-meta" title={r.sample}>{t('audio.podcasts.search.latestMatch', { title: r.sample })}</div>}
              </>
            ) : !(r.rank > 0) && r.episodes > 0 && <div className="pod-result-meta">{t('audio.podcasts.episodes', { count: r.episodes })}</div>}
          </div>
          <FollowLink url={r.url} followed={followed} busy={busy} onFollow={onFollow} />
        </div>
      ))}
    </div>
  );
}

/** The followed shows' feeds, compared the way the checker compares them. */
function useFollowedKeys(subscriptions) {
  // A private feed comes without its link (url '', keys []): it never matches a search result.
  return useMemo(() => new Set((subscriptions || []).flatMap((s) => (s.url ? [feedKey(s.url), ...(s.keys || [])] : []))), [subscriptions]);
}

// ─── Trends: Podcast Index's trending and Apple's charts ──────────────────────

const DISCOVER_KEY = 'pod-discover';
const CHARTS_SHOWN = 10;
const TRENDING_SHOWN = 10;

// A language's usual Apple storefront, when the browser names no country.
const LANG_COUNTRY = {
  en: 'us', es: 'es', pt: 'br', de: 'de', fr: 'fr', it: 'it', pl: 'pl', ru: 'us', tr: 'tr', id: 'id', ko: 'kr',
  ja: 'jp', zh: 'tw', hi: 'in', bn: 'in', vi: 'vn', fil: 'ph', th: 'th', sw: 'ke', uk: 'ua', nl: 'nl',
};

/**
 * What Trends starts with: the listener's last choice, else their country (from
 * the browser's language list, e.g. de-AT) and the page's language.
 */
function discoverPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(DISCOVER_KEY) || 'null');
    if (saved && typeof saved.country === 'string') return { lang: '', cat: '', chartCat: '', ...saved };
  } catch { /* storage off */ }
  const ui = String(getLanguage() || '').split('-')[0];
  const region = (typeof navigator !== 'undefined' ? navigator.languages || [navigator.language] : [])
    .map((l) => String(l || '').split('-')[1]?.toLowerCase())
    .find((c) => c && CHART_COUNTRIES.includes(c));
  return {
    country: region || LANG_COUNTRY[ui] || 'us',
    lang: UI_LANGUAGES.some((l) => l.code === ui) ? ui : '',
    cat: '',
    chartCat: '',
  };
}

/** A select drawn like the board's "English ▾" pills (36 tall, on surface). */
function PodSelect({ value, onChange, label, children }) {
  return (
    <select className="pod-pill-select" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      {children}
    </select>
  );
}

function TrendsSection({ user, subscriptions, onFollowed, config }) {
  const { t } = useTranslation();
  const hasTrending = !!config?.trending;
  const hasCharts = config?.charts !== false;
  const countries = config?.chart_countries?.length ? config.chart_countries : CHART_COUNTRIES;
  const [pick, setPick] = useState(discoverPrefs);
  const [all, setAll] = useState(false);
  const charts = usePodcastCharts(pick.country, pick.chartCat, hasCharts);
  const trending = usePodcastTrending(pick.lang, pick.cat, hasTrending);
  const { busy, follow } = useFollowFeeds(user, onFollowed);
  const followed = useFollowedKeys(subscriptions);
  // Country and language names in the page's own language.
  let regionNames = null;
  let languageNames = null;
  try {
    regionNames = new Intl.DisplayNames([getLanguage()], { type: 'region' });
    languageNames = new Intl.DisplayNames([getLanguage()], { type: 'language' });
  } catch { /* old browser */ }
  const countryName = (c) => regionNames?.of(c.toUpperCase()) || c.toUpperCase();
  const langName = (code) => languageNames?.of(code) || UI_LANGUAGES.find((l) => l.code === code)?.native || code;
  const sortedCountries = [...countries].sort((a, b) => countryName(a).localeCompare(countryName(b)));

  const choose = (next) => {
    const value = { ...pick, ...next };
    setPick(value);
    setAll(false);
    try { localStorage.setItem(DISCOVER_KEY, JSON.stringify(value)); } catch { /* storage off */ }
  };
  const categoryOptions = (
    <>
      <option value="">{t('audio.podcasts.trending.allCategories')}</option>
      {TRENDING_CATEGORIES.map((c) => <option key={c} value={c}>{t(`audio.podcasts.categories.${c.replace(/\s+/g, '')}`)}</option>)}
    </>
  );
  const status = (q, kind) => (
    <>
      {q.isLoading && <p className="pod-empty">{t('common.status.loading')}</p>}
      {q.isError && <p className="pod-empty">{t(`audio.podcasts.${kind}.failed`)}</p>}
      {!q.isLoading && !q.isError && (q.data || []).length === 0 && <p className="pod-empty">{t(`audio.podcasts.${kind}.none`)}</p>}
    </>
  );
  const chartList = charts.data || [];
  const shownCharts = all ? chartList : chartList.slice(0, CHARTS_SHOWN);

  return (
    <>
      {hasTrending && (
        <section className="pod-section">
          <div className="pod-app-head">
            <h2 className="pod-app-title">{t('audio.podcasts.trending.title')}</h2>
            <PodSelect value={pick.lang} onChange={(v) => choose({ lang: v })} label={t('audio.podcasts.trending.language')}>
              <option value="">{t('audio.podcasts.trending.allLanguages')}</option>
              {UI_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{langName(l.code)}</option>)}
            </PodSelect>
            <PodSelect value={pick.cat} onChange={(v) => choose({ cat: v })} label={t('audio.podcasts.trending.category')}>{categoryOptions}</PodSelect>
          </div>
          {status(trending, 'trending')}
          {(trending.data || []).length > 0 && (
            <div className="pod-rail pod-rail--five">
              {trending.data.slice(0, TRENDING_SHOWN).map((r) => (
                <ShowCard
                  key={r.url}
                  feed={{ id: r.url, url: r.url, title: r.title, art: r.art, author: r.author }}
                  note={r.author}
                  follow={<FollowLink url={r.url} followed={followed} busy={busy} onFollow={follow} />}
                />
              ))}
            </div>
          )}
        </section>
      )}
      {hasCharts && (
        <section className="pod-section">
          <div className="pod-app-head">
            <h2 className="pod-app-title">{t('audio.podcasts.charts.title')}</h2>
            <PodSelect value={pick.country} onChange={(v) => choose({ country: v })} label={t('audio.podcasts.charts.country')}>
              {sortedCountries.map((c) => <option key={c} value={c}>{countryName(c)}</option>)}
            </PodSelect>
            <PodSelect value={pick.chartCat} onChange={(v) => choose({ chartCat: v })} label={t('audio.podcasts.trending.category')}>{categoryOptions}</PodSelect>
          </div>
          {status(charts, 'charts')}
          <PiResults list={shownCharts} followed={followed} busy={busy} onFollow={follow} />
          {!all && chartList.length > CHARTS_SHOWN && (
            <button type="button" className="pod-btn pod-more" onClick={() => setAll(true)}>{t('audio.podcasts.more')}</button>
          )}
        </section>
      )}
    </>
  );
}

// ─── Search, add by link, OPML, private feed (36c) ────────────────────────────

const SEARCH_MODES = [
  { key: 'shows', labelKey: 'audio.podcasts.search.modeShows', placeholderKey: 'audio.podcasts.search.placeholder' },
  { key: 'people', labelKey: 'audio.podcasts.search.modePeople', placeholderKey: 'audio.podcasts.search.placeholderPeople' },
];

/** A notice's first sentence in bold, the rest muted (36c "Spotify doesn't share its shows' feeds."). */
function LeadSentence({ text }) {
  const m = String(text || '').match(/^(.+?[.!?])\s+(.+)$/);
  if (!m) return <b>{text}</b>;
  return <><b>{m[1]}</b> <span className="pod-side-muted">{m[2]}</span></>;
}

/**
 * The podcast app around Discover and Trends (36c): find a show (by name, by
 * host, or by pasting its link) over the view's own sections, and on the side
 * your podcasts (OPML in and out), a private feed's login, and why the last
 * pasted link did not work.
 */
function PodcastFinder({ user, searchEnabled, personEnabled, subscriptions, onFollowed, children }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState('shows');
  // Paste a link instead of searching (always, when search is off).
  const [linkMode, setLinkMode] = useState(false);
  // A private feed (a supporters' feed, a paid show): its login goes into the link.
  const [priv, setPriv] = useState({ on: false, username: '', password: '' });
  const { busy, follow, note } = useFollowFeeds(user, onFollowed);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState(null);
  const fileRef = useRef(null);
  const inputRef = useRef(null);
  const followed = useFollowedKeys(subscriptions);
  const asLink = linkMode || !searchEnabled;

  const search = async () => {
    const q = query.trim();
    if (q.length < 2) return;
    setSearching(true);
    try {
      // Apple's results come from the store of the country Trends shows.
      const found = mode === 'people' && personEnabled ? await searchPeople(q) : await searchPodcasts(q, discoverPrefs().country);
      setResults({ q, list: found.results || [] });
    } catch {
      toastIn('Podcasts').error(t('audio.podcasts.search.failed'));
    } finally {
      setSearching(false);
    }
  };

  const addFeed = async () => {
    const url = query.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) { toastIn('Podcasts').error(t('audio.podcasts.errors.badUrl')); return; }
    if (priv.on) {
      if (await follow([buildPrivateFeedUrl(url, priv.username, priv.password)], [], [true])) {
        setQuery('');
        setPriv({ on: false, username: '', password: '' });
      }
      return;
    }
    if (await follow([url])) setQuery('');
  };

  const submit = (e) => {
    e.preventDefault();
    if (asLink) addFeed(); else search();
  };

  const exportOpml = () => {
    const left = downloadOpml(subscriptions, user);
    if (left) toastIn('Podcasts').info(t('audio.podcasts.private.opmlLeftOut', { count: left }));
  };

  const importOpml = async (file) => {
    if (!file) return;
    try {
      const feeds = parseOpml(await file.text());
      if (!feeds.length) { toastIn('Podcasts').error(t('audio.podcasts.opml.empty')); return; }
      await follow(feeds.slice(0, 200).map((f) => f.url), feeds.slice(0, 200).map((f) => f.title));
    } catch (err) {
      toastIn('Podcasts').error(err.message);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const busyNow = asLink ? busy : searching;
  const canSubmit = asLink ? !!query.trim() : query.trim().length >= 2;

  return (
    <div className="pod-app">
      <div className="pod-app-main">
        {user ? (
          <form className="pod-finder" onSubmit={submit}>
            {searchEnabled && personEnabled && !asLink && (
              <Segmented
                className="pod-finder-modes"
                block={false}
                size={36}
                label={t('audio.podcasts.search.label')}
                value={mode}
                onChange={(v) => { setMode(v); setResults(null); }}
                options={SEARCH_MODES.map((m) => ({ value: m.key, label: t(m.labelKey) }))}
              />
            )}
            <label className="pod-finder-field">
              <Icon name={asLink ? 'link' : 'search'} size={18} />
              <input
                ref={inputRef}
                type={asLink ? 'url' : 'search'}
                inputMode={asLink ? 'url' : undefined}
                value={query}
                onChange={(e) => { setQuery(e.target.value); if (!e.target.value) setResults(null); }}
                placeholder={asLink ? t('audio.podcasts.rss.placeholderLink') : t(SEARCH_MODES.find((m) => m.key === mode).placeholderKey)}
                aria-label={asLink ? t('audio.podcasts.rss.labelLink') : t('audio.podcasts.search.label')}
                autoComplete="off"
              />
              {query.trim() && (
                <button
                  type="submit"
                  className="pod-finder-go"
                  disabled={busyNow || !canSubmit}
                  aria-label={asLink ? t('audio.podcasts.follow') : t('audio.podcasts.search.button')}
                  title={asLink ? t('audio.podcasts.follow') : t('audio.podcasts.search.button')}
                >
                  <Icon name={busyNow ? 'progress_activity' : asLink ? 'add' : 'arrow_forward'} size={18} className={busyNow ? 'v2-spin' : undefined} />
                </button>
              )}
            </label>
            {searchEnabled && (
              <button
                type="button"
                className={`pod-finder-link${asLink ? ' is-on' : ''}`}
                aria-pressed={asLink}
                onClick={() => { setLinkMode((v) => !v); setResults(null); inputRef.current?.focus(); }}
              >
                <Icon name="rss_feed" size={18} /> {t('audio.podcasts.rss.labelLink')}
              </button>
            )}
          </form>
        ) : (
          <p className="pod-empty">{t('audio.podcasts.introSignedOut')}</p>
        )}

        {results && (
          <section className="pod-section">
            <div className="pod-app-head">
              <h2 className="pod-app-title">{t('audio.podcasts.search.results', { count: results.list.length })}</h2>
              <button type="button" className="pod-icon-btn" onClick={() => setResults(null)} aria-label={t('common.actions.close')}><Icon name="close" size={18} /></button>
            </div>
            {results.list.length === 0 && <p className="pod-empty">{t('audio.podcasts.search.none')}</p>}
            <PiResults list={results.list} followed={followed} busy={busy} onFollow={follow} />
          </section>
        )}

        {children}
      </div>

      {user && (
        <aside className="pod-app-side">
          <div className="pod-side-card">
            <h2 className="pod-side-title is-barred">{t('audio.podcasts.yourPodcasts', { count: subscriptions?.length || 0 })}</h2>
            <div className="pod-opml">
              <button type="button" className="pod-opml-btn" onClick={() => fileRef.current?.click()} disabled={busy}>
                {t('audio.podcasts.opml.import')}<Icon name="upload_file" size={18} />
              </button>
              <button type="button" className="pod-opml-btn" onClick={exportOpml} disabled={!subscriptions?.length}>
                {t('audio.podcasts.opml.export')}<Icon name="download" size={18} />
              </button>
              <input ref={fileRef} type="file" accept=".opml,.xml,text/xml,text/x-opml,application/xml" hidden onChange={(e) => importOpml(e.target.files?.[0])} />
            </div>
            {note?.tone === 'info' && <p className="pod-side-info" role="status">{note.text}</p>}
          </div>

          <div className="pod-side-card">
            <h2 className="pod-side-title">{t('audio.podcasts.private.title')}</h2>
            <div className="pod-side-switch">
              <Toggle
                checked={priv.on}
                label={t('audio.podcasts.private.toggle')}
                onChange={(on) => { setPriv((p) => ({ ...p, on })); if (on) { setLinkMode(true); setResults(null); } }}
              />
              <span>{t('audio.podcasts.private.toggle')}</span>
            </div>
            {priv.on && (
              <div className="pod-private-fields" id="pod-private-fields">
                <input className="pod-input" type="text" autoComplete="off" placeholder={t('audio.podcasts.private.username')} aria-label={t('audio.podcasts.private.username')} value={priv.username} onChange={(e) => setPriv((p) => ({ ...p, username: e.target.value }))} />
                <input className="pod-input" type="password" autoComplete="new-password" placeholder={t('audio.podcasts.private.password')} aria-label={t('audio.podcasts.private.password')} value={priv.password} onChange={(e) => setPriv((p) => ({ ...p, password: e.target.value }))} />
              </div>
            )}
            <p className="pod-private-hint">{t('audio.podcasts.private.hint')}</p>
          </div>

          {note?.tone === 'warn' && (
            <div className="pod-side-alert" role="alert"><LeadSentence text={note.text} /></div>
          )}
        </aside>
      )}
    </div>
  );
}

// ─── One show ─────────────────────────────────────────────────────────────────

/** `value`, once it has stopped changing for `ms`. */
function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

const COMPACT = (n) => (n >= 1000 ? `${Number((n / 1000).toFixed(1))}K` : String(n));

/** A show as something to tip (the feed's value block, Hive account or funding links). */
const showTrack = (feed) => ({
  _id: `show:${feed.id}`,
  title: feed.title || '',
  show: feed.title || '',
  value: feed.value || null,
  funding: feed.funding || [],
  feed_url: feed.url || '',
  link: feed.link || '',
});

/**
 * "Support <show>" on the show page (36d): the amount, how the feed splits it,
 * then the tip window (PodcastTipModal) with that amount, which pays it.
 */
function SupportCard({ feed }) {
  const { t } = useTranslation();
  const track = useMemo(() => showTrack(feed), [feed]);
  const { recipients, payable } = useMemo(() => tipOptions(feed.value), [feed.value]);
  const [sats, setSats] = useState(PODCAST_PRESETS[1]);
  const [open, setOpen] = useState(false);
  if (!canTipEpisode(track)) return null;
  // Each recipient's share in percent, the way the tip window splits the sats.
  const shares = payable
    ? splitSats(recipients, 10000).map((r) => ({ name: r.name || r.address, pct: Math.round(r.sats / 100) })).sort((a, b) => b.pct - a.pct)
    : [];
  return (
    <div className="pod-side-card pod-support">
      <h2 className="pod-side-title">{t('audio.podcasts.tip.heading', { show: feed.title || '' })}</h2>
      {payable && (
        <div className="pod-support-amounts" role="radiogroup" aria-label={t('engagement.tip.lightning.amountLabel')}>
          {PODCAST_PRESETS.map((p) => (
            <button key={p} type="button" role="radio" aria-checked={sats === p} className={`pod-support-amount${sats === p ? ' is-on' : ''}`} onClick={() => setSats(p)}>
              {COMPACT(p)}
            </button>
          ))}
        </div>
      )}
      {shares.length > 1 && (
        <>
          <div className="pod-side-eyebrow">{t('audio.podcasts.tip.splitLabel').replace(/:\s*$/, '')}</div>
          <ul className="pod-support-split">
            {shares.map((r, i) => <li key={i}><span>{r.name}</span><b className="num">{r.pct}%</b></li>)}
          </ul>
        </>
      )}
      <button type="button" className="pod-support-send" onClick={() => setOpen(true)}>
        {payable && hasWebln() ? t('audio.podcasts.tip.sendWebln') : t('audio.podcasts.tip.button')}
        <Icon name="bolt" size={20} />
      </button>
      {open && <PodcastTipModal track={track} initialSats={sats} onClose={() => setOpen(false)} />}
    </div>
  );
}

function ShowView({ feedId, user, subscription, onBack, onOpenEpisode, onOpenDownloads }) {
  const { t } = useTranslation();
  const [days, setDays] = useState(0);
  const [range, setRange] = useState({ from: '', to: '' });
  const [listen, setListen] = useState('all');
  const [season, setSeason] = useState(0);
  const [search, setSearch] = useState('');
  // The episode search runs on the checker (?q=), once typing stops.
  const q = useDebounced(search.trim().length >= 2 ? search.trim() : '', 400);
  const bounds = useMemo(() => rangeFor(days, range), [days, range]);
  const { since, until } = bounds;
  const { data, isLoading, error } = usePodcastFeed(feedId, since, until, q, user);
  usePodcastProgress(user, { feedId });
  const { items: savedItems, usedBytes, estimate } = useDownloads();
  const online = useOnline();
  const audioPlayQueued = useAppStore((s) => s.audioPlayQueued);
  const audioPlay = useAppStore((s) => s.audioPlay);
  const audioPlayAt = useAppStore((s) => s.audioPlayAt);
  const audioCurrent = useAppStore((s) => s.audioCurrent);
  const audioIsPlaying = useAppStore((s) => s.audioIsPlaying);
  const audioRequestToggle = useAppStore((s) => s.audioRequestToggle);
  const invalidate = useInvalidatePodcasts();
  const [older, setOlder] = useState([]);
  const [olderState, setOlderState] = useState({ loading: false, done: false });
  const [busy, setBusy] = useState(false);
  const [autoQueue, setAutoQueueState] = useState(() => !!(user && readAutoQueue(user).feeds[feedId]));
  const feed = data?.feed;
  const episodes = useMemo(() => [...(data?.episodes || []), ...older], [data, older]);
  const list = () => episodes.map((e) => episodeToTrack(e, feed));

  const resetOlder = () => {
    setOlder([]);
    setOlderState({ loading: false, done: false });
  };
  const changeDays = (d) => { setDays(d); resetOlder(); };
  const changeRange = (r) => { setRange(r); resetOlder(); };
  // A new search is a new list: the older pages of the last one go.
  const [lastQ, setLastQ] = useState(q);
  if (lastQ !== q) { setLastQ(q); resetOlder(); }

  const loadOlder = async () => {
    setOlderState({ loading: true, done: false });
    try {
      const r = await fetchOlderEpisodes(feedId, episodes.length, since, until, q, user);
      setOlder((o) => [...o, ...r.episodes]);
      setOlderState({ loading: false, done: r.next_offset >= r.total || !r.episodes.length });
    } catch {
      toastIn('Podcasts').error(t('audio.podcasts.olderFailed'));
      setOlderState({ loading: false, done: false });
    }
  };

  const run = async (fn, okMsg) => {
    setBusy(true);
    try {
      await fn();
      if (okMsg) toastIn('Podcasts').success(okMsg);
      invalidate();
    } catch (err) {
      toastIn('Podcasts').error(err.message || followErrorText());
    } finally {
      setBusy(false);
    }
  };

  const toggleAutoQueue = () => {
    const on = !autoQueue;
    setAutoQueue(user, feedId, on);
    setAutoQueueState(on);
    toastIn('Podcasts').success(on ? t('audio.podcasts.autoQueue.onDone') : t('audio.podcasts.autoQueue.offDone'));
  };

  if (isLoading) return <div className="pod-empty">{t('common.status.loading')}</div>;
  if (error || !feed) {
    return (
      <div className="pod-show">
        <button type="button" className="pod-back" onClick={onBack}><Icon name="arrow_back" size={18} /> {t('common.actions.back')}</button>
        <p className="pod-empty">{t('audio.podcasts.showMissing')}</p>
      </div>
    );
  }

  const olderAvailable = (data.total || 0) > episodes.length && !olderState.done;
  const seasons = seasonsOf(episodes);
  // The trailer, pinned on top as "Start here" while the list is not narrowed down.
  const trailer = !q && !season && listen === 'all' && !since && !until ? trailerOf(episodes) : null;
  // The range is also applied here, so the page is right whatever the server did with it.
  const shown = episodes.filter((ep) => ep !== trailer
    && inRange(ep, bounds)
    && matchesListen(ep, listen)
    && (!season || Number(ep.season) === season));
  const episodeArt = episodes.find((e) => e.art)?.art;
  const playLatest = () => {
    const tracks = list();
    if (tracks.length) audioPlayQueued(tracks[0]);
  };
  // Live now: the big button plays the stream (36d "Listen live").
  const liveNow = (feed.live || []).find((l) => l?.url && l.status === 'live');
  const liveTrack = liveNow ? liveToTrack(liveNow, feed) : null;
  const liveCurrent = liveTrack && audioCurrent?._id === liveTrack._id;
  const following = !!(user && subscription);
  // The highlights (podcast:soundbite) of the loaded episodes, newest first.
  const highlights = episodes.flatMap((ep) => (ep.soundbites || []).filter((b) => b.duration > 0).map((b) => ({ ep, b }))).slice(0, 3);
  const playHighlight = ({ ep, b }) => audioPlayAt(episodeToTrack(ep, feed), b.start, b.start + b.duration);
  const meta = [
    feed.author,
    feed.item_count > 0 ? t('audio.podcasts.episodes', { count: feed.item_count }) : null,
    t('audio.podcasts.followers', { count: feed.subscribers || 0 }),
  ].filter(Boolean).join(' · ');
  const listenFilters = [...LISTEN_FILTERS.filter((f) => !f.mineOnly && f.key !== 'all'), LISTEN_FILTERS.find((f) => f.key === 'all')];
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="pod-show pod-show--app">
      <button type="button" className="pod-back" onClick={onBack}><Icon name="arrow_back" size={18} /> {t('audio.podcasts.allPodcasts')}</button>
      <div className="pod-app">
        <div className="pod-app-main">
          <header className="pod-showhead">
            <PodcastArt art={feed.art} fallback={episodeArt} px={512} className="pod-showhead-art" />
            <div className="pod-showhead-info">
              <div className="pod-showhead-badges">
                <span className="pod-badge">{isOn3Speak(feed.url) ? t('audio.podcasts.on3speak') : t('audio.podcasts.chip')}</span>
                {liveNow && <span className="pod-badge pod-badge--live">● {t('audio.podcasts.live.now')}</span>}
                {feed.private && <PrivateBadge withText />}
                {feed.categories?.slice(0, 2).map((c) => <span key={c} className="pod-badge">{c}</span>)}
              </div>
              <h2 className="pod-showhead-title">{feed.title || feed.url}</h2>
              <div className="pod-showhead-meta">{meta}</div>
              {feed.description && <p className="pod-showhead-desc">{feed.description}</p>}
              {feed.status === 'error' && <p className="pod-show-error">{t('audio.podcasts.feedError', { reason: followErrorText(feed.error) })}</p>}
              <div className="pod-showhead-actions">
                {liveTrack ? (
                  <button type="button" className="pod-show-play" onClick={() => (liveCurrent ? audioRequestToggle() : audioPlay(liveTrack))}>
                    {liveCurrent && audioIsPlaying ? t('audio.podcasts.pause') : t('audio.podcasts.live.listen')}
                    <Icon name={liveCurrent && audioIsPlaying ? 'pause' : 'sensors'} size={20} fill={liveCurrent && audioIsPlaying} />
                  </button>
                ) : episodes.length > 0 && (
                  <button type="button" className="pod-show-play" onClick={playLatest}>
                    {t('audio.podcasts.playLatest')}<Icon name="play_arrow" size={20} fill />
                  </button>
                )}
                {user && (following ? (
                  <button
                    type="button"
                    className={`pod-show-tile${subscription.notify ? ' is-on' : ''}`}
                    disabled={busy}
                    aria-pressed={!!subscription.notify}
                    onClick={() => run(() => setFeedNotify(user, feed.id, !subscription.notify), subscription.notify ? t('audio.podcasts.notifyOffDone') : t('audio.podcasts.notifyOnDone'))}
                    title={subscription.notify ? t('audio.podcasts.notifyOn') : t('audio.podcasts.notifyOff')}
                    aria-label={t('audio.podcasts.notifyHint')}
                  >
                    <Icon name={subscription.notify ? 'notifications_active' : 'notifications_off'} size={24} />
                  </button>
                ) : feed.url && (
                  <button type="button" className="pod-show-follow" disabled={busy} onClick={() => run(async () => {
                    const [r] = await followFeeds(user, [feed.url]);
                    if (!r?.ok) throw new Error(followErrorText(r?.code, r));
                  }, t('audio.podcasts.followed'))}>
                    <Icon name="add" size={20} /> {t('audio.podcasts.follow')}
                  </button>
                ))}
                {feed.link && (
                  <a className="pod-show-tile" href={feed.link} target="_blank" rel="noopener noreferrer nofollow" title={t('audio.podcasts.website')} aria-label={t('audio.podcasts.website')}>
                    <Icon name="open_in_new" size={24} />
                  </a>
                )}
                {/* A private feed's link is never handed out (it carries the login). */}
                {feed.url && !feed.private && (
                  <a className="pod-show-tile" href={feed.url} target="_blank" rel="noopener noreferrer nofollow" title="RSS" aria-label="RSS">
                    <Icon name="rss_feed" size={24} />
                  </a>
                )}
                {/* The show in one player on another site; an embed is anonymous, so never a private feed */}
                {!feed.private && episodes.length > 0 && (
                  <button
                    type="button"
                    className="pod-show-tile"
                    onClick={() => openEmbedCode({ kind: 'podcast', id: feed.id, title: feed.title })}
                    title={t('chat.share.embedOnWebsite')}
                    aria-label={t('misc.embed.embed')}
                  >
                    <Icon name="code" size={24} />
                  </button>
                )}
                {following && (
                  <button type="button" className="pod-show-tile" disabled={busy} onClick={() => run(() => unfollowFeed(user, feed.id), t('audio.podcasts.unfollowed'))} title={t('audio.podcasts.unfollow')} aria-label={t('audio.podcasts.unfollow')}>
                    <Icon name="person_remove" size={24} />
                  </button>
                )}
              </div>
            </div>
          </header>

          <LiveBanner feed={feed} upcomingOnly={!!liveTrack} />

          <div className="pod-show-filters">
            {seasons.length > 0 && (
              <select className="pod-show-select" value={season} onChange={(e) => setSeason(Number(e.target.value))} aria-label={t('audio.podcasts.seasons.label')}>
                <option value={0}>{t('audio.podcasts.seasons.all')}</option>
                {seasons.map((n) => <option key={n} value={n}>{t('audio.podcasts.seasons.season', { n })}</option>)}
              </select>
            )}
            <Segmented
              className="pod-show-listen"
              block={false}
              size={28}
              scroll
              label={t('audio.podcasts.filters.listenLabel')}
              value={listen}
              onChange={setListen}
              options={listenFilters.map((f) => ({ value: f.key, label: t(f.labelKey) }))}
            />
            <select
              className="pod-show-select"
              value={String(days)}
              onChange={(e) => changeDays(e.target.value === 'custom' ? 'custom' : Number(e.target.value))}
              aria-label={t('audio.podcasts.filters.dateLabel')}
            >
              {DATE_FILTERS.map((f) => <option key={String(f.days)} value={String(f.days)}>{t(f.labelKey)}</option>)}
            </select>
            <label className="pod-show-search">
              <Icon name="search" size={16} />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('audio.podcasts.episodeSearch.label')}
                aria-label={t('audio.podcasts.episodeSearch.label')}
                autoComplete="off"
              />
            </label>
          </div>
          {days === 'custom' && (
            <div className="pod-filter-range pod-show-range">
              <label>
                <span>{t('audio.podcasts.filters.from')}</span>
                <input className="v2-input h32" type="date" value={range.from} max={range.to || today} onChange={(e) => changeRange({ ...range, from: e.target.value })} />
              </label>
              <label>
                <span>{t('audio.podcasts.filters.to')}</span>
                <input className="v2-input h32" type="date" value={range.to} min={range.from || undefined} max={today} onChange={(e) => changeRange({ ...range, to: e.target.value })} />
              </label>
            </div>
          )}

          <ul className="pod-rows">
            {trailer && <EpisodeRow ep={trailer} feed={feed} onOpenEpisode={onOpenEpisode} pinned />}
            {shown.map((ep) => <EpisodeRow key={ep.id} ep={ep} feed={feed} onOpenEpisode={onOpenEpisode} />)}
          </ul>
          {episodes.length === 0 && (
            <p className="pod-empty">
              {q ? t('audio.podcasts.episodeSearch.none', { q }) : since || until ? t('audio.podcasts.filters.none') : t('audio.podcasts.noEpisodes')}
            </p>
          )}
          {episodes.length > 0 && shown.length === 0 && !trailer && <p className="pod-empty">{t('audio.podcasts.filters.none')}</p>}
          {olderAvailable && (
            <button type="button" className="pod-btn pod-more" onClick={loadOlder} disabled={olderState.loading}>
              {olderState.loading ? t('common.status.loading') : t('audio.podcasts.loadOlder')}
            </button>
          )}
        </div>

        <aside className="pod-app-side">
          <PersonsRow persons={feed.persons} card />
          {(following || highlights.length > 0) && (
            <div className="pod-side-card">
              {following && (
                <>
                  <div className="pod-side-toggle">
                    <Icon name="notifications" size={20} />
                    <div><b>{t('audio.podcasts.notifyLabel')}</b><span>{t('audio.podcasts.notifyHint')}</span></div>
                    <Toggle
                      checked={!!subscription.notify}
                      disabled={busy}
                      label={t('audio.podcasts.notifyHint')}
                      onChange={(on) => run(() => setFeedNotify(user, feed.id, on), on ? t('audio.podcasts.notifyOnDone') : t('audio.podcasts.notifyOffDone'))}
                    />
                  </div>
                  <div className="pod-side-toggle">
                    <Icon name="queue_music" size={20} />
                    <div><b>{t('audio.podcasts.autoQueue.label')}</b><span>{t('audio.podcasts.autoQueue.hint')}</span></div>
                    <Toggle checked={autoQueue} label={t('audio.podcasts.autoQueue.label')} onChange={toggleAutoQueue} />
                  </div>
                </>
              )}
              {highlights.length > 0 && (
                <>
                  <div className="pod-side-eyebrow">{t('audio.podcasts.highlights.title')}</div>
                  {highlights.map((h) => (
                    <button key={`${h.ep.id}-${h.b.start}`} type="button" className="pod-side-highlight" onClick={() => playHighlight(h)} title={t('audio.podcasts.highlights.play')}>
                      <Icon name="play_circle" size={18} fill />
                      <b>{h.b.title || t('audio.podcasts.highlights.untitled', { time: fmtClock(h.b.start) })}</b>
                      <span className="num">{fmtClock(h.b.start)}</span>
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
          <SupportCard feed={feed} />
          {savedItems.length > 0 && (
            <div className="pod-side-note">
              <Icon name="sd_storage" size={20} />
              <span>
                {t('audio.podcasts.downloads.total', { size: fmtBytes(usedBytes) })}
                {estimate?.quota > 0 && ` · ${t('audio.podcasts.downloads.storage', { used: fmtBytes(estimate.usage), quota: fmtBytes(estimate.quota) })}`}
              </span>
            </div>
          )}
          {!online && (
            <div className="pod-side-note is-offline">
              <Icon name="wifi_off" size={20} />
              <span>{savedItems.length ? t('audio.offline.notice') : t('audio.offline.noticeNoDownloads')}</span>
              {savedItems.length > 0 && <button type="button" onClick={onOpenDownloads}>{t('audio.offline.open')}</button>}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

// ─── The tab ──────────────────────────────────────────────────────────────────

// Mine | Discover | Trends, in the URL (?view=) so Back returns to it. Without one:
// the last one picked, else Mine for someone signed in and Discover for a guest.
// The audio page uses the same views as its own navigation (page/Audio.jsx) and
// then tells this tab which one to show.
export const VIEWS = ['mine', 'discover', 'trends'];
export const VIEW_KEY = 'pod-view';
function viewOf(param, user) {
  if (VIEWS.includes(param)) return param;
  try {
    const saved = localStorage.getItem(VIEW_KEY);
    if (VIEWS.includes(saved)) return saved;
  } catch { /* storage off */ }
  return user ? 'mine' : 'discover';
}

/**
 * When Mine was opened before this visit (for the "New" inbox), read once each
 * time Mine is opened; opening it records the new visit.
 */
function useMineVisit(user, active) {
  const key = active ? user || '~anon' : null;
  const [visit, setVisit] = useState(null);
  // Read while rendering, before the effect below records this visit.
  if ((visit?.key ?? null) !== key) setVisit(key ? { key, at: readMineVisit(user) } : null);
  useEffect(() => { if (active) markMineVisit(user); }, [user, active]);
  return visit ? visit.at : readMineVisit(user);
}

/**
 * Shows with "Auto-add new episodes to the queue" on: when the latest episodes
 * load, the new unplayed ones go to the end of the queue, each once
 * (lib/podcastLibrary.js pickAutoQueue). Runs while the podcasts page is open.
 */
function useAutoQueue(user, episodes, feedsById) {
  const { t } = useTranslation();
  const audioAddToQueue = useAppStore((s) => s.audioAddToQueue);
  const key = episodes.map((e) => e.id).join(',');
  useEffect(() => {
    if (!user || !episodes.length) return;
    const settings = readAutoQueue(user);
    if (!Object.keys(settings.feeds).length) return;
    const { audioQueue, audioCurrent } = useAppStore.getState();
    const picked = pickAutoQueue(episodes, settings, {
      progressOf,
      queuedIds: new Set(audioQueue.map((i) => i._id)),
      currentId: audioCurrent?._id,
    });
    if (!picked.length) return;
    picked.forEach((ep) => audioAddToQueue(episodeToTrack(ep, feedsById[ep.feed_id])));
    markAutoQueued(user, picked.map((ep) => ep.id));
    toastIn('Podcasts').success(t('audio.podcasts.autoQueue.added', { count: picked.length }));
    // The ids stand for the list; feedsById comes with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, key]);
}

/**
 * `view`: which view to show when the page around it picks it (the audio page's
 * Mine | Discover | Trends); `hideNav`: that page draws the navigation itself.
 */
export default function PodcastsTab({ view: viewProp, hideNav = false }) {
  const { t } = useTranslation();
  const fmtDate = useDateFormat();
  const [params, setParams] = useSearchParams();
  const authenticated = useAppStore((s) => s.authenticated);
  const user = useAppStore((s) => s.user);
  const me = authenticated ? user : null;
  const { data: config } = usePodcastConfig();
  const { data: subscriptions = [], isSuccess: subsLoaded } = usePodcastSubscriptions(me);
  const { data: continueItems = [] } = useContinueListening(me);
  const view = VIEWS.includes(viewProp) ? viewProp : viewOf(params.get('view'), me);
  const online = useOnline();
  const { data: discover } = usePodcastDiscover();
  const latest = usePodcastLatest(me);
  const invalidate = useInvalidatePodcasts();
  const [latestDays, setLatestDays] = useState(0);
  const [latestRange, setLatestRange] = useState({ from: '', to: '' });
  const [latestListen, setLatestListen] = useState('all');
  const latestBounds = useMemo(() => rangeFor(latestDays, latestRange), [latestDays, latestRange]);
  const lastVisit = useMineVisit(me, view === 'mine' && !params.get('podcast') && !params.get('episode'));
  useDownloads();
  const latestIds = useMemo(
    () => (latest.data?.pages || []).flatMap((p) => (p.episodes || []).map((e) => e.id)).slice(0, 150),
    [latest.data],
  );
  usePodcastProgress(me, { ids: latestIds });
  const feedId = params.get('podcast');
  const episodeParam = params.get('episode');
  const pages = latest.data?.pages || [];
  const feedsById = Object.assign({}, ...pages.map((p) => p.feeds || {}));
  const episodes = pages.flatMap((p) => p.episodes || []);
  useAutoQueue(me, episodes, feedsById);

  const openShow = (id) => {
    const next = new URLSearchParams(params);
    next.set('type', 'external');
    next.delete('episode');
    // A shared timestamp belongs to the episode it came with.
    next.delete('t');
    next.delete('end');
    if (id) next.set('podcast', id); else next.delete('podcast');
    setParams(next);
    window.scrollTo({ top: 0 });
  };

  const openEpisode = (id) => {
    const next = new URLSearchParams(params);
    next.set('type', 'external');
    next.delete('podcast');
    next.delete('t');
    next.delete('end');
    next.set('episode', id);
    setParams(next);
    window.scrollTo({ top: 0 });
  };

  const showView = (v) => {
    const next = new URLSearchParams(params);
    for (const k of ['podcast', 'episode', 't', 'end']) next.delete(k);
    next.set('type', 'external');
    next.set('view', v);
    setParams(next);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* storage off */ }
  };

  const subsById = useMemo(() => new Map(subscriptions.map((s) => [s.id, s])), [subscriptions]);

  // One episode (a tile's title or description, the player, the bell, a push).
  if (episodeParam) {
    return <EpisodeView key={episodeParam} episodeId={episodeParam} user={me} onOpenShow={openShow} />;
  }

  if (feedId) {
    // Keyed by show, so "load older" starts over for each one.
    return <ShowView key={feedId} feedId={feedId} user={me} subscription={subsById.get(feedId)} onBack={() => openShow(null)} onOpenEpisode={openEpisode} onOpenDownloads={() => showView('mine')} />;
  }

  if (config && config.enabled === false) {
    return <p className="pod-empty">{t('audio.podcasts.errors.disabled')}</p>;
  }

  const latestShown = episodes.filter((e) => inRange(e, latestBounds) && matchesListen(e, latestListen, lastVisit));
  const inboxCount = episodes.filter((e) => isInboxEpisode(e, progressOf(e.id), lastVisit)).length;
  // A show without a cover of its own borrows its newest loaded episode's art.
  const episodeArt = {};
  for (const e of episodes) if (e.art && !episodeArt[e.feed_id]) episodeArt[e.feed_id] = e.art;
  const artFor = (f) => episodeArt[f.id];
  // The shows you followed last come first.
  const mine = [...subscriptions].sort((a, b) => new Date(b.added_at) - new Date(a.added_at));

  const followed = (id) => { invalidate(); if (id) openShow(id); };
  const views = [
    { key: 'mine', label: t('audio.podcasts.views.mine') },
    { key: 'discover', label: t('audio.podcasts.views.discover') },
    { key: 'trends', label: t('audio.podcasts.views.trends') },
  ];

  return (
    <div className="pod-tab">
      {!hideNav && (
        <Segmented
          className="pod-views"
          block={false}
          label={t('audio.podcasts.kicker')}
          value={view}
          onChange={showView}
          options={views.map((v) => ({ value: v.key, label: v.label }))}
        />
      )}

      {view === 'mine' && (
        <>
          {!me && <p className="pod-empty pod-empty--center">{t('audio.podcasts.introSignedOut')}</p>}
          {!me && <DownloadsSection onOpenEpisode={openEpisode} />}
          {/* Half-heard episodes and tracks first: the quickest way back in. */}
          {me && online && <ContinueListening user={me} />}
          {me && subsLoaded && subscriptions.length === 0 && !continueItems.length && (
            <div className="pod-mine-empty">
              <Icon name="podcasts" size={40} />
              <p>{t('audio.podcasts.views.mineEmpty')}</p>
              <div className="pod-mine-empty-actions">
                <button type="button" className="pod-btn pod-btn--primary" onClick={() => showView('discover')}><Icon name="explore" size={16} /> {t('audio.podcasts.views.discover')}</button>
                <button type="button" className="pod-btn" onClick={() => showView('trends')}><Icon name="local_fire_department" size={16} /> {t('audio.podcasts.views.trends')}</button>
              </div>
            </div>
          )}
          {/* Offline only the saved episodes play: they come first. */}
          {me && !online && <DownloadsSection onOpenEpisode={openEpisode} />}
          <ShowRail
            tone="eyebrow"
            five={false}
            title={t('audio.podcasts.yourPodcasts', { count: subscriptions.length })}
            feeds={mine}
            onOpen={openShow}
            artFor={artFor}
            noteFor={(f) => (f.status === 'pending' ? t('audio.podcasts.pending') : f.status === 'error' ? t('audio.podcasts.cantRead') : f.author)}
          />
          {/* What is saved in this browser, before the long list of the latest (24b). */}
          {me && online && <DownloadsSection onOpenEpisode={openEpisode} />}

          {episodes.length > 0 && (
            <section className="pod-section">
              <div className="pod-section-head pod-section-head--filters">
                <h2 className="pod-app-title is-eyebrow">{t('audio.podcasts.latest')}</h2>
                <EpisodeFilters
                  days={latestDays}
                  onDays={setLatestDays}
                  listen={latestListen}
                  onListen={setLatestListen}
                  range={latestRange}
                  onRange={setLatestRange}
                  inbox={inboxCount}
                />
              </div>
              <ul className="pod-tile-grid">
                {latestShown.map((ep) => (
                  <EpisodeTile key={ep.id} ep={ep} feed={feedsById[ep.feed_id]} onOpenShow={openShow} onOpenEpisode={openEpisode} />
                ))}
              </ul>
              {latestShown.length === 0 && (
                <p className="pod-empty">{latestListen === 'new' ? t('audio.podcasts.filters.inboxEmpty') : t('audio.podcasts.filters.none')}</p>
              )}
              {latest.hasNextPage && (
                <button type="button" className="pod-btn pod-more" onClick={() => latest.fetchNextPage()} disabled={latest.isFetchingNextPage}>
                  {latest.isFetchingNextPage ? t('common.status.loading') : t('audio.podcasts.more')}
                </button>
              )}
            </section>
          )}
        </>
      )}

      {(view === 'discover' || view === 'trends') && (
        <PodcastFinder
          user={me}
          searchEnabled={!!config?.search}
          personEnabled={!!config?.person || (config?.person === undefined && !!config?.search)}
          subscriptions={subscriptions}
          onFollowed={followed}
        >
          {view === 'discover' && (
            <>
              <ShowRail title={t('audio.podcasts.topTitle')} feeds={discover?.top} onOpen={openShow} ranked artFor={artFor} />
              <ShowRail
                title={t('audio.podcasts.recentTitle')}
                feeds={discover?.recent}
                onOpen={openShow}
                artFor={artFor}
                noteFor={(f) => (f.last_followed_at ? t('audio.podcasts.followedOn', { date: fmtDate(f.last_followed_at) }) : f.author)}
              />
            </>
          )}
          {view === 'trends' && (config?.charts || config?.trending) && (
            <TrendsSection user={me} config={config} subscriptions={subscriptions} onFollowed={followed} />
          )}
        </PodcastFinder>
      )}
    </div>
  );
}
